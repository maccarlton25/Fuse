import { describe, expect, test } from 'vitest'
import BaselineFuse from '../bench/baseline-fuse.mjs'
import FuseMjs from '../dist/fuse.mjs'
import { createRequire } from 'node:module'

// The development build exposes Fuse.parseQuery; the parsed tree (including
// each leaf's searcher and its resolved `options`) must serialize exactly as
// the baseline's does.
//
// One known, out-of-scope difference is masked: a BitapSearch searcher's
// `chunks` (the pattern alphabet is keyed by char code and carries a lookup
// `table` since generation 1's kernel work, owned by src/search/bitap/). Its
// `options` and `pattern` are still compared.
const require = createRequire(import.meta.url)
const FuseCjs = require('../dist/fuse.cjs')

const builds = [
  ['dist/fuse.mjs', FuseMjs],
  ['dist/fuse.cjs', FuseCjs]
]

const queries = [
  'abc',
  "'abc !x ^p q$ =e !^np !nq$ | fz",
  'Ábc DÉF | ghi',
  { title: 'abc' },
  { title: 'Ab', author: "'cd" },
  {
    $and: [
      { title: 'a' },
      { $or: [{ author: 'b' }, { $path: ['x', 'y'], $val: 'z' }] }
    ]
  },
  { $or: [{ title: '^x' }, { $path: 'author', $val: '=y' }] },
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

const optionSets = [
  {},
  { useExtendedSearch: true },
  { useExtendedSearch: true, isCaseSensitive: true },
  { useExtendedSearch: true, ignoreDiacritics: true },
  { useExtendedSearch: true, includeMatches: true, minMatchCharLength: 2 },
  {
    useExtendedSearch: true,
    threshold: 0.3,
    location: 5,
    distance: 7,
    findAllMatches: true,
    ignoreLocation: true
  },
  { useExtendedSearch: true, isCaseSensitive: null, threshold: null },
  { useExtendedSearch: false, isCaseSensitive: true, threshold: 0.2 }
]

const maskChunks = (key, value) =>
  key === 'chunks' && Array.isArray(value) ? '<chunks>' : value

const serialize = (F, q, o) => {
  try {
    return JSON.stringify(F.parseQuery(q, o), maskChunks)
  } catch (e) {
    return `${e.constructor.name}: ${e.message}`
  }
}

describe('Fuse.parseQuery tree matches the baseline', () => {
  test('parseQuery is exposed on both sides', () => {
    expect(typeof BaselineFuse.parseQuery).toBe('function')
    expect(typeof FuseMjs.parseQuery).toBe('function')
    expect(typeof FuseCjs.parseQuery).toBe('function')
  })

  for (const [buildName, Fuse] of builds) {
    for (const [withConfig, label] of [
      [true, 'Config-merged options'],
      [false, 'raw options']
    ]) {
      test(`${buildName}: ${label}`, () => {
        const diffs = []
        for (const q of queries) {
          for (const raw of optionSets) {
            const bo = withConfig ? { ...BaselineFuse.config, ...raw } : raw
            const co = withConfig ? { ...Fuse.config, ...raw } : raw
            const base = serialize(BaselineFuse, q, bo)
            const cand = serialize(Fuse, q, co)
            if (base !== cand) diffs.push({ q, raw, base, cand })
          }
        }
        expect(diffs).toEqual([])
      })
    }
  }
})
