#!/usr/bin/env node
/**
 * Differential parity fuzzer for the hill-climb swarm.
 *
 * Compares the candidate build (dist/fuse.mjs) against the locked baseline
 * oracle (bench/baseline-fuse.mjs) over randomized corpora, options, queries
 * and mutations, requiring BYTE-EXACT equality of the JSON-serialized results
 * (items, refIndex, scores, match indices, ordering) and of the serialized
 * index. This is deliberately stricter than bench/hillclimb.mjs, which
 * tolerates 1e-11 score drift and tie reordering.
 *
 * Usage:
 *   npm run build && node bench/parity-fuzz.mjs
 *   node bench/parity-fuzz.mjs --iters 400 --seed 7
 *   node bench/parity-fuzz.mjs --candidate ./some/other/fuse.mjs
 *   node bench/parity-fuzz.mjs --no-sparse-records
 *
 * Exit code 0 = all cases identical, 1 = first mismatch (printed with a
 * minimal repro: seed, options, query).
 *
 * Revision 2 (after generation 1): adds sparse `docs`, sparse arrays inside
 * documents, sparse `records` through Fuse.parseIndex, and out-of-range
 * `distance` / `threshold` values. Two generation 1 branches passed revision 1
 * and were then caught by reviewers on sparse arrays. Seeds do not reproduce
 * the same cases across revisions.
 */

import path from 'node:path'
import { pathToFileURL } from 'node:url'
import BaselineFuse from './baseline-fuse.mjs'

const args = process.argv.slice(2)
const flag = (name, dflt) => {
  const i = args.indexOf(name)
  return i >= 0 && args[i + 1] ? args[i + 1] : dflt
}
const ITERS = Number(flag('--iters', 150))
const SEED = Number(flag('--seed', 1))
// --no-sparse-records keeps every other generator (and the same cases per
// seed) but leaves parsed index `records` dense. For branches forked from a
// tree with a known sparse-records divergence that another branch is fixing.
const SPARSE_RECORDS = !args.includes('--no-sparse-records')
const candidatePath = flag('--candidate', '../dist/fuse.mjs')
const candidateUrl = candidatePath.startsWith('.')
  ? new URL(candidatePath, import.meta.url).href
  : pathToFileURL(path.resolve(candidatePath)).href
const CandidateFuse = (await import(candidateUrl)).default

function createRng(seed) {
  let a = seed >>> 0
  return function rng() {
    let t = (a += 0x6d2b79f5)
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const WORDS = [
  'algorithm', 'architecture', 'async', 'authentication', 'benchmark', 'bitap',
  'browser', 'cache', 'café', 'compiler', 'concurrency', 'configuration',
  'database', 'diacritics', 'distributed', 'edge', 'encryption', 'framework',
  'fuzzy', 'gateway', 'graph', 'heap', 'indexing', 'javascript', 'kernel',
  'latency', 'matching', 'memory', 'microvm', 'naïve', 'network',
  'normalization', 'optimization', 'orchestration', 'parallel', 'parser',
  'performance', 'pipeline', 'query', 'queue', 'ranking', 'résumé', 'runtime',
  'sandbox', 'scoring', 'security', 'serialization', 'streaming', 'substring',
  'threshold', 'tokenizer', 'typescript', 'validation', 'vector', 'worker',
  'a', 'ab', 'aa', 'aaa', 'abab', 'Łódź', 'straße', 'ÀÉÎõü', 'x', 'to', 'of',
  'JavaScript', 'TYPESCRIPT', 'Edge', '42', '3.14', 'c++', 'node.js', 'hello',
  'world', 'hello-world', 'foo_bar', '日本語', 'हिन्दी', '😀', 'old', 'man', 'war'
]
const SEPARATORS = [' ', ' ', ' ', ' ', '  ', '\t', '\n', '-', ', ', '. ', '\u00a0']
const ALPHA = 'abcdefghijklmnopqrstuvwxyz'

function makeGen(rng) {
  const int = (n) => Math.floor(rng() * n)
  const pick = (arr) => arr[int(arr.length)]
  const chance = (p) => rng() < p
  const word = () => pick(WORDS)
  const sentence = (min, max) => {
    const len = min + int(max - min + 1)
    let out = ''
    for (let i = 0; i < len; i++) {
      if (i > 0) out += pick(SEPARATORS)
      out += word()
    }
    return out
  }
  const typo = (w) => {
    if (w.length < 2) return w
    const chars = Array.from(w)
    const edits = 1 + int(Math.min(3, chars.length - 1))
    for (let e = 0; e < edits; e++) {
      const pos = int(chars.length)
      const kind = int(4)
      if (kind === 0) chars.splice(pos, 1)
      else if (kind === 1) chars.splice(pos, 0, pick(ALPHA))
      else if (kind === 2) chars[pos] = pick(ALPHA)
      else if (pos + 1 < chars.length) {
        const tmp = chars[pos]
        chars[pos] = chars[pos + 1]
        chars[pos + 1] = tmp
      }
    }
    return chars.join('')
  }
  const text = () => {
    const r = rng()
    if (r < 0.03) return ''
    if (r < 0.05) return '   '
    if (r < 0.1) return sentence(30, 60) // long: exercises distance / >32 chunks
    if (r < 0.14) return pick(ALPHA).repeat(1 + int(40))
    if (r < 0.2) return ' ' + sentence(1, 3) + ' '
    return sentence(1, 12)
  }
  return { int, pick, chance, word, sentence, typo, text }
}

function makeDocs(g, kind, count) {
  const docs = []
  for (let i = 0; i < count; i++) {
    if (kind === 'strings') {
      docs.push(g.text())
      continue
    }
    const doc = {
      id: `doc_${i}`,
      title: g.text(),
      body: g.chance(0.1) ? undefined : g.sentence(4, 25),
      author: g.chance(0.08)
        ? null
        : { name: `${g.word()} ${g.word()}`, tags: [{ value: g.word() }, { value: g.text() }] },
      tags: g.chance(0.1)
        ? []
        : Array.from({ length: 1 + g.int(4) }, () =>
            g.chance(0.05) ? '' : g.sentence(1, 3)
          ),
      year: g.chance(0.5) ? 1990 + g.int(40) : undefined,
      flag: g.chance(0.3) ? g.chance(0.5) : undefined
    }
    // Sparse array inside a document: forEach/filter/map skip holes, index
    // loops and for...of do not.
    if (Array.isArray(doc.tags) && doc.tags.length > 1 && g.chance(0.04)) {
      delete doc.tags[g.int(doc.tags.length)]
    }
    docs.push(doc)
  }
  // Sparse docs array (holes, not undefined entries).
  if (count > 3 && g.chance(0.06)) {
    const holes = 1 + g.int(3)
    for (let h = 0; h < holes; h++) delete docs[1 + g.int(count - 1)]
  }
  return docs
}

const KEY_SETS = [
  ['title'],
  ['title', 'body'],
  [
    { name: 'title', weight: 2 },
    { name: 'body', weight: 1 },
    { name: 'author.name', weight: 1.5 },
    { name: 'tags', weight: 1.2 }
  ],
  [{ name: 'title', weight: 0.7 }, 'author.tags.value', 'tags', 'year', 'flag'],
  [['author', 'name'], { name: 'tags', weight: 3 }],
  [{ name: 'title', getFn: (d) => d.title }, { name: 'tg', getFn: (d) => d.tags }]
]

function makeOptions(g, kind) {
  const o = {}
  if (kind === 'objects') o.keys = g.pick(KEY_SETS)
  if (g.chance(0.8)) o.includeScore = true
  if (g.chance(0.45)) o.includeMatches = true
  if (g.chance(0.2)) o.isCaseSensitive = true
  if (g.chance(0.3)) o.ignoreDiacritics = true
  if (g.chance(0.25)) o.ignoreLocation = true
  if (g.chance(0.2)) o.findAllMatches = true
  if (g.chance(0.25)) o.minMatchCharLength = 1 + g.int(4)
  if (g.chance(0.4)) o.threshold = g.pick([0, 0.1, 0.2, 0.3, 0.45, 0.6, 0.8, 1, 1.5, -0.1])
  if (g.chance(0.3)) o.distance = g.pick([0, 1, 10, 50, 100, 500, 1000, 1e12, -5])
  if (g.chance(0.3)) o.location = g.pick([0, 1, 5, 20, 80, 300])
  if (g.chance(0.15)) o.ignoreFieldNorm = true
  if (g.chance(0.15)) o.fieldNormWeight = g.pick([0, 0.5, 2])
  if (g.chance(0.1)) o.shouldSort = false
  // Custom comparators that return 0 on ties exercise the idx tie-break in
  // both the full-sort and the top-k heap paths.
  if (g.chance(0.15)) {
    o.sortFn = g.chance(0.7)
      ? (a, b) => a.score - b.score
      : (a, b) => b.score - a.score
  }
  const mode = g.int(10)
  if (mode < 3) o.useExtendedSearch = true
  else if (mode < 6) {
    o.useTokenSearch = true
    if (g.chance(0.4)) o.tokenMatch = 'all'
  }
  return o
}

function makeQuery(g, opts, kind) {
  const base = () => {
    const r = g.int(10)
    if (r < 4) return g.word()
    if (r < 7) return g.typo(g.word())
    if (r < 8) return g.word().slice(0, 1 + g.int(4))
    if (r < 9) return g.sentence(2, 4)
    return g.sentence(5, 9) // > 32 chars: multi-chunk bitap
  }
  if (opts.useExtendedSearch) {
    const term = () => {
      const w = g.chance(0.7) ? g.word() : g.typo(g.word())
      const r = g.int(11)
      if (r === 0) return `=${w}`
      if (r === 1) return `'${w}`
      if (r === 2) return `^${w.slice(0, 1 + g.int(4))}`
      if (r === 3) return `!${w}`
      if (r === 4) return `${w.slice(-(1 + g.int(4)))}$`
      if (r === 5) return `!^${w.slice(0, 2)}`
      if (r === 6) return `!${w.slice(-2)}$`
      if (r === 7) return `="${g.sentence(1, 2)}"`
      if (r === 8) return `'"${g.sentence(1, 2)}"`
      return w
    }
    const group = () => Array.from({ length: 1 + g.int(3) }, term).join(' ')
    const str = () =>
      Array.from({ length: 1 + g.int(3) }, group).join(' | ')
    if (kind === 'objects' && g.chance(0.45)) {
      const names = ['title', 'body', 'author.name', 'tags']
      const usable = names.filter((n) =>
        (opts.keys || []).some((k) => {
          const name = typeof k === 'string' ? k : Array.isArray(k) ? k.join('.') : k.name
          return (Array.isArray(name) ? name.join('.') : name) === n
        })
      )
      if (usable.length) {
        const leaf = () => {
          const key = g.pick(usable)
          if (g.chance(0.3)) {
            const w = g.word()
            const op = g.pick([
              { $fuzzy: w },
              { $eq: w },
              { $contains: w.slice(0, 3) },
              { $startsWith: w.slice(0, 2) },
              { $endsWith: w.slice(-2) },
              { $not: { $contains: w } },
              { $or: [{ $startsWith: w.slice(0, 2) }, { $fuzzy: g.word() }] }
            ])
            return { [key]: op }
          }
          return g.chance(0.2) ? { $path: key.split('.'), $val: group() } : { [key]: group() }
        }
        const node = (depth) => {
          if (depth > 1 || g.chance(0.4)) return leaf()
          const op = g.chance(0.5) ? '$and' : '$or'
          return { [op]: Array.from({ length: 1 + g.int(3) }, () => node(depth + 1)) }
        }
        return g.chance(0.2) ? leaf() : node(0)
      }
    }
    return str()
  }
  if (opts.useTokenSearch) {
    return Array.from({ length: 1 + g.int(4) }, () =>
      g.chance(0.6) ? g.word() : g.typo(g.word())
    ).join(' ')
  }
  return base()
}

const replacer = (key, value) => {
  if (typeof value === 'number' && Object.is(value, -0)) return '-0'
  if (typeof value === 'function') return '[fn]'
  return value
}
const ser = (v) => JSON.stringify(v, replacer) ?? 'undefined'

function run(Fuse, plan) {
  const out = []
  const record = (label, fn) => {
    try {
      out.push([label, ser(fn())])
    } catch (err) {
      out.push([label, `THROW:${err && err.message}`])
    }
  }
  let fuse
  record('construct', () => {
    fuse = new Fuse(plan.docs.slice(), plan.opts)
    return 'ok'
  })
  if (!fuse) return out
  for (const step of plan.steps) {
    if (step.type === 'search') {
      record(`search ${ser(step.query)} ${ser(step.searchOpts)}`, () =>
        fuse.search(step.query, step.searchOpts)
      )
    } else if (step.type === 'add') {
      record('add', () => fuse.add(step.doc))
    } else if (step.type === 'removeAt') {
      record(`removeAt ${step.idx}`, () => fuse.removeAt(step.idx))
    } else if (step.type === 'remove') {
      record(`remove %${step.mod}`, () => fuse.remove((_, i) => i % step.mod === step.rem))
    } else if (step.type === 'index') {
      record('index', () => fuse.getIndex().toJSON())
    } else if (step.type === 'parseIndex') {
      record('parseIndex', () => {
        const json = JSON.parse(JSON.stringify(fuse.getIndex().toJSON()))
        // Hand-built indexes may have holes in `records`.
        if (SPARSE_RECORDS) {
          for (const k of step.holes) if (k < json.records.length) delete json.records[k]
        }
        const parsed = Fuse.parseIndex(json)
        const f2 = new Fuse(fuse._docs.slice(), plan.opts, parsed)
        return f2.search(step.query, step.searchOpts)
      })
    } else if (step.type === 'match') {
      record(`match ${ser(step.query)}`, () => Fuse.match(step.query, step.text, plan.matchOpts))
    }
  }
  return out
}

let cases = 0
let comparisons = 0
for (let iter = 0; iter < ITERS; iter++) {
  const caseSeed = (SEED * 1000003 + iter * 7919) >>> 0
  const g = makeGen(createRng(caseSeed))
  const kind = g.chance(0.3) ? 'strings' : 'objects'
  const docs = makeDocs(g, kind, 5 + g.int(g.chance(0.2) ? 400 : 60))
  const opts = makeOptions(g, kind)
  const { keys: _k, ...matchOpts } = opts
  const steps = []
  const nSteps = 6 + g.int(10)
  for (let s = 0; s < nSteps; s++) {
    const r = g.int(20)
    const searchOpts = g.chance(0.4) ? { limit: g.pick([0, 1, 2, 3, 5, 10, 50]) } : undefined
    if (r < 13) {
      const query = g.chance(0.03) ? '' : makeQuery(g, opts, kind)
      steps.push({ type: 'search', query, searchOpts })
      // Repeat the same query sometimes: exercises searcher / memo caches.
      if (g.chance(0.25)) steps.push({ type: 'search', query, searchOpts })
    } else if (r < 14) {
      steps.push({ type: 'add', doc: makeDocs(g, kind, 1)[0] })
    } else if (r < 15) {
      steps.push({ type: 'removeAt', idx: g.int(8) })
    } else if (r < 16) {
      steps.push({ type: 'remove', mod: 2 + g.int(9), rem: g.int(2) })
    } else if (r < 17) {
      steps.push({ type: 'index' })
    } else if (r < 18) {
      steps.push({
        type: 'parseIndex',
        query: makeQuery(g, opts, kind),
        searchOpts,
        holes: g.chance(0.3) ? [1 + g.int(4), 3 + g.int(6)] : []
      })
    } else if (!opts.useTokenSearch) {
      const q = makeQuery(g, opts, 'strings')
      if (typeof q === 'string') steps.push({ type: 'match', query: q, text: g.text() })
    }
  }
  steps.push({ type: 'index' })
  const plan = { docs, opts, matchOpts, steps }

  const a = run(BaselineFuse, plan)
  const b = run(CandidateFuse, plan)
  cases++
  const n = Math.max(a.length, b.length)
  for (let i = 0; i < n; i++) {
    comparisons++
    const [la, va] = a[i] || ['<missing>', '']
    const [lb, vb] = b[i] || ['<missing>', '']
    if (la !== lb || va !== vb) {
      console.error(`PARITY_FUZZ_FAIL at case ${iter} (seed=${SEED}, caseSeed=${caseSeed}) step ${i}: ${la}`)
      console.error(`  options: ${ser(opts)}`)
      console.error(`  docs: ${docs.length} ${kind}`)
      let d = 0
      while (d < va.length && va[d] === vb[d]) d++
      console.error(`  baseline : …${va.slice(Math.max(0, d - 120), d + 200)}`)
      console.error(`  candidate: …${vb.slice(Math.max(0, d - 120), d + 200)}`)
      process.exit(1)
    }
  }
}

console.log(
  `PARITY_FUZZ_OK rev=2 cases=${cases} comparisons=${comparisons} seed=${SEED} candidate=${candidatePath}${SPARSE_RECORDS ? '' : ' (sparse records off)'}`
)
