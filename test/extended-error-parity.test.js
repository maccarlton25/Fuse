import { describe, expect, test } from 'vitest'
import BaselineFuse from '../bench/baseline-fuse.mjs'
import FuseMjs from '../dist/fuse.mjs'
import { createRequire } from 'node:module'

// Non-string patterns and values must throw exactly what the baseline throws
// (same class, same message) in the non-minified builds, for every path that
// reaches the extended-search normalizer: string-syntax search, logical
// queries ($and/$or/$path/$val and implicit keys), object leaves, and
// Fuse.match.
const require = createRequire(import.meta.url)
const FuseCjs = require('../dist/fuse.cjs')

const builds = [
  ['dist/fuse.mjs', FuseMjs],
  ['dist/fuse.cjs', FuseCjs]
]

const values = [
  ['number', 5],
  ['zero', 0],
  ['NaN', NaN],
  ['null', null],
  ['undefined', undefined],
  ['object', { a: 1 }],
  ['empty object', {}],
  ['array', ['abc']],
  ['empty array', []],
  ['Symbol', Symbol('s')],
  ['true', true],
  ['false', false],
  ['bigint', 5n],
  ['function', () => 'abc'],
  ['empty string', ''],
  ['string', 'abc']
]

const optionSets = []
for (const isCaseSensitive of [undefined, false, true])
  for (const ignoreDiacritics of [undefined, false, true])
    for (const includeMatches of [false, true])
      optionSets.push({ isCaseSensitive, ignoreDiacritics, includeMatches })

const list = [
  { title: 'abc', author: 'Ábc déf' },
  { title: 'xyz', author: 'abc' }
]
const strings = ['abc', 'Ábc déf', 'xyz']

const outcome = (fn) => {
  try {
    return { ok: JSON.stringify(fn()) }
  } catch (e) {
    return { name: e?.constructor?.name, message: String(e?.message) }
  }
}

const queriesFor = (x) => [
  ['string-list search', (F, o) => new F(strings, o).search(x)],
  ['keyed search', (F, o) => new F(list, { ...o, keys: ['title'] }).search(x)],
  [
    'implicit key',
    (F, o) => new F(list, { ...o, keys: ['title'] }).search({ title: x })
  ],
  [
    '$and',
    (F, o) =>
      new F(list, { ...o, keys: ['title', 'author'] }).search({
        $and: [{ title: x }, { author: 'abc' }]
      })
  ],
  [
    '$or',
    (F, o) =>
      new F(list, { ...o, keys: ['title', 'author'] }).search({
        $or: [{ author: 'zzz' }, { title: x }]
      })
  ],
  [
    '$path/$val',
    (F, o) =>
      new F(list, { ...o, keys: ['title'] }).search({
        $path: 'title',
        $val: x
      })
  ],
  [
    'object leaf',
    (F, o) =>
      new F(list, { ...o, keys: ['title'] }).search({ title: { $contains: x } })
  ],
  [
    'object leaf $not',
    (F, o) =>
      new F(list, { ...o, keys: ['title'] }).search({
        title: { $not: { $prefix: x } }
      })
  ],
  [
    'object leaf $or',
    (F, o) =>
      new F(list, { ...o, keys: ['title'] }).search({
        title: { $or: [{ $suffix: x }, { $and: [{ $eq: x }] }] }
      })
  ],
  ['Fuse.match', (F, o) => F.match(x, 'abc', o)]
]

// Out of scope here (owned by the bitap kernel, src/search/bitap/): a
// non-string *text* in Fuse.match, and a non-string pattern in Fuse.match
// without useExtendedSearch, reach BitapSearch directly.
const bitapOnly = (qName, o) => qName === 'Fuse.match' && !o.useExtendedSearch

describe('extended search: thrown errors match the baseline', () => {
  for (const [buildName, Fuse] of builds) {
    for (const [valueName, x] of values) {
      test(`${buildName}: ${valueName}`, () => {
        const diffs = []
        for (const opts of optionSets) {
          for (const useExtendedSearch of [true, false]) {
            const o = { ...opts, useExtendedSearch }
            for (const [qName, run] of queriesFor(x)) {
              if (bitapOnly(qName, o)) continue
              const base = outcome(() => run(BaselineFuse, o))
              const cand = outcome(() => run(Fuse, o))
              if (JSON.stringify(base) !== JSON.stringify(cand)) {
                diffs.push({ qName, o, base, cand })
              }
            }
          }
        }
        expect(diffs).toEqual([])
      })
    }
  }
})
