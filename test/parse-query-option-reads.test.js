import { describe, expect, test } from 'vitest'
import BaselineFuse from '../bench/baseline-fuse.mjs'
import FuseMjs from '../dist/fuse.mjs'
import { createRequire } from 'node:module'

// The baseline's ExtendedSearch resolves the caller's options once and hands
// the resolved copy on to the parser, so each option key is read once per
// parse. A build that re-reads the caller's object per token sees a different
// value from a getter (or Proxy) that changes between reads, and builds a
// different searcher. These tests pin the baseline's read pattern and the
// resulting leaf searchers.
const require = createRequire(import.meta.url)
const FuseCjs = require('../dist/fuse.cjs')

const builds = [
  ['dist/fuse.mjs', FuseMjs],
  ['dist/fuse.cjs', FuseCjs]
]

const queries = [
  'abd',
  'Ab',
  "'ab !x ^a c$ =abc !^q !z$ | abd fz",
  'Ábd DÉF | ghi',
  { title: 'abd' },
  { title: 'x' },
  { title: 'Ab', author: "'cd" },
  {
    $and: [
      { title: 'abd' },
      { $or: [{ author: 'Éb' }, { $path: ['x', 'y'], $val: '^a' }] }
    ]
  },
  { $or: [{ title: '^x' }, { $path: 'author', $val: '=y' }, { title: 'abd' }] },
  { title: { $contains: 'Ab' } },
  { title: { $prefix: 'a', $suffix: 'c', $not: { $contains: 'zz' } } },
  {
    title: {
      $or: [
        { $eq: 'abc' },
        { $and: [{ $fuzzy: 'abd' }, { $not: { $prefix: 'q' } }] }
      ]
    }
  },
  { $and: [{ title: { $fuzzy: 'Éa' } }, { author: 'x' }] }
]

const texts = [
  'abc',
  'abd',
  'ÁBD',
  'xxxxxxxxxxxxxxxxxxxxabd',
  'Abd and some more text then abd again',
  'q fz c'
]

// [key, first read, later reads]
const flips = [
  ['threshold', 0.6, 0],
  ['threshold', 0, 0.6],
  ['location', 0, 30],
  ['location', 30, 0],
  ['distance', 100, 1],
  ['distance', 1, 100],
  ['minMatchCharLength', 1, 4],
  ['minMatchCharLength', 4, 1],
  ['findAllMatches', false, true],
  ['findAllMatches', true, false],
  ['ignoreLocation', false, true],
  ['ignoreLocation', true, false],
  ['includeMatches', false, true],
  ['includeMatches', true, false],
  ['isCaseSensitive', false, true],
  ['isCaseSensitive', true, false],
  ['ignoreDiacritics', false, true],
  ['ignoreDiacritics', true, false]
]

const flipOptions = (key, first, later) => {
  let n = 0
  return Object.defineProperty({ useExtendedSearch: true }, key, {
    enumerable: true,
    configurable: true,
    get: () => (n++ === 0 ? first : later)
  })
}

const leafSearchers = (node, out = []) => {
  if (node && typeof node === 'object') {
    if (node.searcher) out.push(node.searcher)
    for (const k of Object.keys(node)) {
      if (k !== 'searcher') leafSearchers(node[k], out)
    }
  }
  return out
}

const attempt = (fn) => {
  try {
    return JSON.stringify(fn())
  } catch (e) {
    return `${e.constructor.name}: ${e.message}`
  }
}

const searchResults = (Fuse, q, options) => {
  let tree
  try {
    tree = Fuse.parseQuery(q, options)
  } catch (e) {
    return `${e.constructor.name}: ${e.message}`
  }
  return leafSearchers(tree).map((s) =>
    texts.map((t) => attempt(() => s.searchIn(t)))
  )
}

const qLabel = (q) => (typeof q === 'string' ? q : JSON.stringify(q))

describe('Fuse.parseQuery with options whose getters change after the first read', () => {
  for (const [buildName, Fuse] of builds) {
    for (const [key, first, later] of flips) {
      test(`${buildName}: ${key} ${first} -> ${later}`, () => {
        const diffs = []
        for (const q of queries) {
          const base = searchResults(BaselineFuse, q, flipOptions(key, first, later))
          const cand = searchResults(Fuse, q, flipOptions(key, first, later))
          if (JSON.stringify(base) !== JSON.stringify(cand)) {
            diffs.push({ q: qLabel(q), base, cand })
          }
        }
        expect(diffs).toEqual([])
      })
    }
  }
})

const optionBases = [
  { useExtendedSearch: true },
  { useExtendedSearch: true, isCaseSensitive: true, ignoreDiacritics: true },
  {
    useExtendedSearch: true,
    includeMatches: true,
    threshold: 0.3,
    location: 5,
    distance: 7,
    findAllMatches: true,
    ignoreLocation: true,
    minMatchCharLength: 2
  }
]

const readLog = (Fuse, q, target) => {
  const log = []
  const proxy = new Proxy(
    { ...target },
    {
      get(t, k, r) {
        log.push(String(k))
        return Reflect.get(t, k, r)
      }
    }
  )
  let outcome = 'ok'
  try {
    Fuse.parseQuery(q, proxy)
  } catch (e) {
    outcome = `${e.constructor.name}: ${e.message}`
  }
  return { outcome, count: log.length, log }
}

// Known, out-of-scope difference: a `$fuzzy` operator leaf is compiled by
// the object compiler, which resolves the nine options once in resolveOptions
// order, whereas the baseline's BitapSearch destructures them in its own order
// (location, threshold, distance, includeMatches, findAllMatches,
// minMatchCharLength, isCaseSensitive, ignoreDiacritics, ignoreLocation).
// Each key is still read the same number of times, so for these queries the
// count and the multiset of keys are pinned, not the order.
const orderOnly = (q) => JSON.stringify(q).includes('"$fuzzy"')
const unordered = ({ outcome, count, log }) => ({
  outcome,
  count,
  log: [...log].sort()
})

describe('Fuse.parseQuery reads the options object exactly as the baseline does', () => {
  for (const [buildName, Fuse] of builds) {
    for (const q of queries) {
      test(`${buildName}: ${qLabel(q)}`, () => {
        for (const o of optionBases) {
          const cand = readLog(Fuse, q, o)
          const base = readLog(BaselineFuse, q, o)
          if (orderOnly(q)) expect(unordered(cand)).toEqual(unordered(base))
          else expect(cand).toEqual(base)
        }
      })
    }
  }
})
