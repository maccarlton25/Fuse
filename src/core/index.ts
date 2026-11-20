import { isArray, isDefined, isString, isNumber } from '../helpers/typeGuards'
import KeyStore from '../tools/KeyStore'
import FuseIndex, { createIndex } from '../tools/FuseIndex'
import {
  LogicalOperator,
  parse,
  type ParsedNode,
  type ParsedLeaf,
  type ParsedOperator
} from './queryParser'
import { createSearcher } from './register'
import Config from './config'
import computeScore, { computeScoreSingle } from './computeScore'
import MaxHeap, { type Comparator } from '../tools/MaxHeap'
import format from './format'
import * as ErrorMsg from './errorMessages'
import { createAnalyzer } from '../search/token/analyzer'
import { MAX_MASK_TERMS } from '../search/token'
import {
  buildInvertedIndex,
  addToInvertedIndex,
  removeAndShiftInvertedIndex
} from '../search/token/InvertedIndex'
import type { InvertedIndexData } from '../search/token/InvertedIndex'
import type {
  Searcher,
  SearchResult,
  InternalResult,
  MatchScore,
  IFuseOptions,
  FuseSearchOptions,
  FuseResult,
  Expression,
  KeyObject,
  SubRecord
} from '../types'

interface HeapSearchOptions {
  heap?: MaxHeap
  ignoreFieldNorm?: boolean
}

// Appends the matches of one key's value (a single SubRecord or an array of
// them, in element order) to `out`. Module-level so the minifier can mangle it.
function pushMatches(
  out: MatchScore[],
  key: KeyObject | null,
  value: SubRecord | SubRecord[] | undefined,
  searcher: Searcher
): void {
  if (isArray(value)) {
    for (const sub of value) {
      if (isDefined(sub.v)) {
        pushMatch(out, key, sub, true, searcher)
      }
    }
  } else if (isDefined(value)) {
    pushMatch(out, key, value, false, searcher)
  }
}

function pushMatch(
  out: MatchScore[],
  key: KeyObject | null,
  sub: SubRecord,
  inArray: boolean,
  searcher: Searcher
): void {
  const text = sub.v
  const searchResult = searcher.searchIn(text)

  if (searchResult.isMatch) {
    const match: MatchScore = inArray
      ? {
          score: searchResult.score,
          key,
          value: text,
          idx: sub.i,
          norm: sub.n,
          indices: searchResult.indices,
          hasInverse: searchResult.hasInverse
        }
      : {
          score: searchResult.score,
          key,
          value: text,
          norm: sub.n,
          indices: searchResult.indices,
          hasInverse: searchResult.hasInverse
        }
    // Carry token-search AND coverage only when present, so the default
    // (non-token / 'any') MatchScore keeps its original object shape.
    if (searchResult.termCount !== undefined) {
      match.matchedMask = searchResult.matchedMask
      match.matchedTerms = searchResult.matchedTerms
      match.termCount = searchResult.termCount
    }
    out.push(match)
  }
}

export default class Fuse<T> {
  options: Required<IFuseOptions<T>>
  _keyStore: KeyStore
  _docs: T[]
  _myIndex: FuseIndex<T>
  _invertedIndex: InvertedIndexData | null
  _lastQuery: string | null
  _lastSearcher: Searcher | null

  // Statics are assigned in entry.ts
  static version: string
  static createIndex: typeof createIndex
  static parseIndex: typeof import('../tools/FuseIndex').parseIndex
  static config: typeof Config
  static parseQuery: typeof parse
  static use: (...plugins: any[]) => void
  static match: (
    pattern: string,
    text: string,
    options?: IFuseOptions<any>
  ) => SearchResult

  constructor(
    docs: ReadonlyArray<T>,
    options?: IFuseOptions<T>,
    index?: FuseIndex<T>
  ) {
    this.options = { ...Config, ...options } as Required<IFuseOptions<T>>

    if (
      this.options.useExtendedSearch &&
      !process.env.EXTENDED_SEARCH_ENABLED
    ) {
      throw new Error(ErrorMsg.EXTENDED_SEARCH_UNAVAILABLE)
    }

    if (this.options.useTokenSearch && !process.env.TOKEN_SEARCH_ENABLED) {
      throw new Error(ErrorMsg.TOKEN_SEARCH_UNAVAILABLE)
    }

    this._keyStore = new KeyStore(this.options.keys)

    this._docs = docs as T[]
    this._myIndex = null as any
    this._invertedIndex = null

    this.setCollection(docs, index)

    this._lastQuery = null
    this._lastSearcher = null
  }

  _getSearcher(query: string): Searcher {
    if (this._lastQuery === query) {
      return this._lastSearcher!
    }
    const opts = this._invertedIndex
      ? { ...this.options, _invertedIndex: this._invertedIndex }
      : this.options
    const searcher = createSearcher(query, opts)
    this._lastQuery = query
    this._lastSearcher = searcher
    return searcher
  }

  setCollection(docs: ReadonlyArray<T>, index?: FuseIndex<T>): void {
    this._docs = docs as T[]

    if (index && !(index instanceof FuseIndex)) {
      throw new Error(ErrorMsg.INCORRECT_INDEX_TYPE)
    }

    this._myIndex =
      index ||
      createIndex(this.options.keys, this._docs, {
        getFn: this.options.getFn,
        fieldNormWeight: this.options.fieldNormWeight
      })

    if (this.options.useTokenSearch) {
      const analyzer = createAnalyzer({
        isCaseSensitive: this.options.isCaseSensitive,
        ignoreDiacritics: this.options.ignoreDiacritics,
        tokenize: this.options.tokenize
      })
      this._invertedIndex = buildInvertedIndex(
        this._myIndex.records,
        this._myIndex.keys.length,
        analyzer
      )
    }

    this._invalidateSearcherCache()
  }

  add(doc: T): void {
    if (!isDefined(doc)) {
      return
    }

    this._docs.push(doc)
    const record = this._myIndex.add(doc, this._docs.length - 1)

    // Skip inverted-index bookkeeping when no record was appended (blank
    // strings produce null). The previous code read `records[records.length-1]`
    // unconditionally, which would re-ingest the previous doc on `add("")`.
    if (this._invertedIndex && record) {
      const analyzer = createAnalyzer({
        isCaseSensitive: this.options.isCaseSensitive,
        ignoreDiacritics: this.options.ignoreDiacritics,
        tokenize: this.options.tokenize
      })
      addToInvertedIndex(
        this._invertedIndex,
        record,
        this._myIndex.keys.length,
        analyzer
      )
    }

    this._invalidateSearcherCache()
  }

  remove(predicate: (doc: T, idx: number) => boolean = () => false): T[] {
    const results: T[] = []
    const indicesToRemove: number[] = []

    for (let i = 0, len = this._docs.length; i < len; i += 1) {
      if (predicate(this._docs[i], i)) {
        results.push(this._docs[i])
        indicesToRemove.push(i)
      }
    }

    if (indicesToRemove.length) {
      if (this._invertedIndex) {
        removeAndShiftInvertedIndex(this._invertedIndex, indicesToRemove)
      }

      // Filter docs in a single pass instead of reverse-splicing
      const toRemove = new Set(indicesToRemove)
      this._docs = this._docs.filter((_, i) => !toRemove.has(i))
      this._myIndex.removeAll(indicesToRemove)

      this._invalidateSearcherCache()
    }

    return results
  }

  removeAt(idx: number): T {
    // Validate before any mutation. The previous code spliced `_docs` first
    // and let FuseIndex.removeAt throw afterward — partial-state on invalid
    // input. Atomic now.
    if (!Number.isInteger(idx) || idx < 0 || idx >= this._docs.length) {
      throw new Error(ErrorMsg.INVALID_DOC_INDEX)
    }

    if (this._invertedIndex) {
      removeAndShiftInvertedIndex(this._invertedIndex, [idx])
    }
    const doc = this._docs.splice(idx, 1)[0]
    this._myIndex.removeAt(idx)
    this._invalidateSearcherCache()
    return doc
  }

  _invalidateSearcherCache(): void {
    this._lastQuery = null
    this._lastSearcher = null
  }

  getIndex(): FuseIndex<T> {
    return this._myIndex
  }

  // FuseIndex.keys carries raw user weights; only KeyStore normalises them to
  // sum to 1. Scoring off the raw weights underflows for large values and
  // diverges from the keyed logical path. Resolve each key to its normalised
  // counterpart by id (kept aligned to item[keyIndex]), once per search.
  _normalizedKeys(): KeyObject[] {
    return this._myIndex.keys.map((key) => this._keyStore.get(key.id) || key)
  }

  search(
    query: string | Expression,
    options?: FuseSearchOptions
  ): FuseResult<T>[] {
    const { limit = -1 } = options || {}
    const {
      includeMatches,
      includeScore,
      shouldSort,
      sortFn,
      ignoreFieldNorm
    } = this.options

    // Empty string query returns all docs (useful for search UIs)
    if (isString(query) && !query.trim()) {
      let docs: FuseResult<T>[] = this._docs.map((item, idx) => ({
        item,
        refIndex: idx
      }))
      if (isNumber(limit) && limit > -1) {
        docs = docs.slice(0, limit)
      }
      return docs
    }

    // The heap selects a sorted top-N, so it only applies when sorting is on.
    // With `shouldSort: false` we must keep the collection-order-then-slice path
    // so `search(query, { limit })` still equals `search(query).slice(0, limit)`.
    const useHeap =
      shouldSort && isNumber(limit) && limit > 0 && isString(query)

    // sortFn is typed for the public FuseSortFunctionArg shape, but at sort and
    // heap time we operate on InternalResult; one assertion bridges the two.
    const comparator = sortFn as unknown as Comparator

    // Canonical tie-break for string/object search: break comparator ties by
    // item index so heap selection and the full sort agree. Both then equal a
    // full sort under this idx tie-break, sliced to the limit. This only bites
    // when a custom sortFn returns 0 for distinct results (the default sortFn
    // and any total-order comparator decide every pair). Applying it to the
    // unlimited sort too keeps the contract even when an index's records are not
    // in idx order (e.g. via Fuse.parseIndex), where a raw stable sort would
    // instead preserve scan order. Logical search has no heap path, so it keeps
    // the raw comparator.
    const stable: Comparator = (a, b) => comparator(a, b) || a.idx - b.idx

    let results: InternalResult[]

    if (useHeap) {
      const heap = new MaxHeap(limit, stable)
      if (isString(this._docs[0])) {
        this._searchStringList(query as string, { heap, ignoreFieldNorm })
      } else {
        this._searchObjectList(query as string, { heap, ignoreFieldNorm })
      }
      results = heap.extractSorted()
    } else {
      results = isString(query)
        ? isString(this._docs[0])
          ? this._searchStringList(query)!
          : this._searchObjectList(query)!
        : this._searchLogical(query as Expression)

      computeScore(results, { ignoreFieldNorm })

      if (shouldSort) {
        results.sort(isString(query) ? stable : comparator)
      }

      if (isNumber(limit) && limit > -1) {
        results = results.slice(0, limit)
      }
    }

    return format(results, this._docs, {
      includeMatches,
      includeScore
    })
  }

  _searchStringList(
    query: string,
    opts: HeapSearchOptions = {}
  ): InternalResult[] | null {
    const heap = opts.heap
    const searcher = this._getSearcher(query)
    const requireAllTokens =
      this.options.useTokenSearch && this.options.tokenMatch === 'all'
    const records = this._myIndex.records
    const results: InternalResult[] | null = heap ? null : []

    // Iterate over every string in the index
    for (const record of records) {
      const text = record.v
      if (!isDefined(text)) {
        continue
      }

      const searchResult = searcher.searchIn(text)

      if (searchResult.isMatch) {
        const match: MatchScore = {
          score: searchResult.score,
          value: text,
          norm: record.n!,
          indices: searchResult.indices
        }
        if (requireAllTokens) {
          match.matchedMask = searchResult.matchedMask
          match.matchedTerms = searchResult.matchedTerms
          match.termCount = searchResult.termCount
        }
        const matches = [match]

        // Record-level AND gate (token search `tokenMatch: 'all'`), applied
        // before heap insertion so `limit` returns the same top-N as unlimited.
        if (!requireAllTokens || this._coversAllTokens(matches)) {
          const result: InternalResult = { item: text, idx: record.i, matches }

          if (heap) {
            result.score = computeScoreSingle(matches, opts)
            heap.insert(result)
          } else {
            results!.push(result)
          }
        }
      }
    }

    return results
  }

  _searchLogical(query: Expression): InternalResult[] {
    if (!process.env.LOGICAL_SEARCH_ENABLED) {
      throw new Error(ErrorMsg.LOGICAL_SEARCH_UNAVAILABLE)
    }

    const expression = parse(query, this.options)

    // Keyless leaves fan out across all keys; normalised weights keep their
    // scores consistent with string and keyed queries.
    const keys = this._normalizedKeys()

    // Appends the node's matches to `out`; the node matched iff `out` grew.
    // A failing AND rolls `out` back to where it started, discarding the
    // matches of the children that did match, exactly like dropping their
    // result arrays did.
    const evaluate = (node: ParsedNode, item: any, out: MatchScore[]) => {
      if (!('children' in node)) {
        const { keyId, searcher } = node as ParsedLeaf

        if (keyId === null) {
          // Keyless entry: search across all keys
          for (let k = 0; k < keys.length; k += 1) {
            const m = this._findMatches({
              key: keys[k],
              value: item[k],
              searcher: searcher!
            })
            for (let j = 0; j < m.length; j += 1) out.push(m[j])
          }
        } else {
          const m = this._findMatches({
            key: this._keyStore.get(keyId),
            value: this._myIndex.getValueForItemAtKeyId(item, keyId),
            searcher: searcher!
          })
          for (let j = 0; j < m.length; j += 1) out.push(m[j])
        }
        return
      }

      const { children, operator } = node as ParsedOperator
      const start = out.length
      for (let i = 0, len = children.length; i < len; i += 1) {
        const before = out.length
        evaluate(children[i], item, out)
        if (out.length === before && operator === LogicalOperator.AND) {
          out.length = start
          return
        }
      }
    }

    const records = this._myIndex.records
    const resultMap = new Map<number, InternalResult>()
    const results: InternalResult[] = []

    records.forEach(({ $: item, i: idx }) => {
      if (isDefined(item)) {
        const matches: MatchScore[] = []
        evaluate(expression, item, matches)

        if (matches.length) {
          // Dedupe when adding
          const existing = resultMap.get(idx)
          if (existing) {
            existing.matches.push(...matches)
          } else {
            const result = { idx, item, matches }
            resultMap.set(idx, result)
            results.push(result)
          }
        }
      }
    })

    return results
  }

  // When a search involves inverse patterns (e.g. !Syrup), the aggregation
  // across keys switches from "ANY key matches" to "ALL keys must match."
  // This is signaled by hasInverse on the SearchResult from ExtendedSearch.
  //
  // For mixed patterns like "^hello !Syrup", a key failure is ambiguous —
  // it could be the positive or inverse term that failed. In that case we
  // conservatively exclude the item, which is strictly better than the old
  // behavior of including it. See: https://github.com/krisk/Fuse/issues/712
  _searchObjectList(
    query: string,
    opts: HeapSearchOptions = {}
  ): InternalResult[] | null {
    const heap = opts.heap
    const searcher = this._getSearcher(query)
    const requireAllTokens =
      this.options.useTokenSearch && this.options.tokenMatch === 'all'
    const records = this._myIndex.records
    const keys = this._normalizedKeys()
    const results: InternalResult[] | null = heap ? null : []
    // One matches array per record, reused until a record actually matches,
    // instead of a fresh array per key per record.
    let matches: MatchScore[] = []

    // List is Array<Object>
    for (const record of records) {
      const item = record.$
      if (!isDefined(item)) {
        continue
      }

      let anyKeyFailed = false
      let hasInverse = false

      // Iterate over every key (i.e, path), and fetch the value at that key
      for (let k = 0; k < keys.length; k += 1) {
        const start = matches.length
        pushMatches(matches, keys[k], item[k], searcher)

        if (matches.length > start) {
          if (matches[start].hasInverse) {
            hasInverse = true
          }
        } else {
          anyKeyFailed = true
        }
      }

      // If the search involves inverse patterns, ALL keys must match.
      // Record-level AND gate (token search `tokenMatch: 'all'`): every query
      // term must be covered across the record's field/array-element matches.
      // Applied before heap insertion so `limit` returns the same top-N.
      if (
        matches.length &&
        !(hasInverse && anyKeyFailed) &&
        (!requireAllTokens || this._coversAllTokens(matches))
      ) {
        const result: InternalResult = { idx: record.i, item, matches }

        if (heap) {
          result.score = computeScoreSingle(matches, opts)
          heap.insert(result)
        } else {
          results!.push(result)
        }
        matches = []
      } else {
        matches.length = 0
      }
    }

    return results
  }

  _findMatches({
    key,
    value,
    searcher
  }: {
    key: KeyObject | null
    value: SubRecord | SubRecord[] | undefined
    searcher: Searcher
  }): MatchScore[] {
    const matches: MatchScore[] = []
    pushMatches(matches, key, value, searcher)
    return matches
  }

  // Record-level AND gate for token search (`tokenMatch: 'all'`). Returns true
  // unless the matched terms across ALL of a record's field/array-element
  // matches fail to cover every query term. `termCount` is only set by
  // TokenSearch in 'all' mode, so non-token / 'any' searches always pass.
  _coversAllTokens(matches: MatchScore[]): boolean {
    const termCount = matches.length ? matches[0].termCount : undefined
    if (termCount === undefined) {
      return true
    }

    if (termCount <= MAX_MASK_TERMS) {
      let coverage = 0
      for (let i = 0; i < matches.length; i++) {
        coverage |= matches[i].matchedMask || 0
      }
      return coverage === 2 ** termCount - 1
    }

    const coverage = new Set<number>()
    for (let i = 0; i < matches.length; i++) {
      const terms = matches[i].matchedTerms
      if (terms) {
        for (const t of terms) {
          coverage.add(t)
        }
      }
    }
    return coverage.size === termCount
  }
}
