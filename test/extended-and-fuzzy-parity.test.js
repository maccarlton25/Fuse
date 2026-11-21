import Fuse from '../dist/fuse.mjs'
import BaselineFuse from '../bench/baseline-fuse.mjs'
import BitapSearch from '../src/search/bitap/index.ts'
import search from '../src/search/bitap/search.ts'
import ExtendedSearch from '../src/search/extended/index.ts'

// climb/gen1-extended made ExtendedSearch.searchIn keep every matcher's
// result object until its AND group has finished, and only then read the
// scores and indices. That is only correct while BitapSearch.searchIn and the
// bitap kernel (climb/gen1-bitap) return a fresh result object, and fresh
// index arrays, per call. These tests pin both halves: object identity at the
// source level, and byte-exact parity with the baseline oracle for AND groups
// holding two (or more) fuzzy terms.

const docs = [
  'the quick brown fox jumps over the lazy dog',
  'quick brown dogs and lazy foxes',
  'a brown fox is quick',
  'lazy dog sleeping in the sun',
  'quack brawn fax',
  'brown',
  'quick',
  'jumping over quickly, the browner fox',
  'an extraordinarily long sentence about a quick brown fox that keeps going and going',
  'café naïve résumé quick brown'
]

const objDocs = docs.map((title, i) => ({
  title,
  tags: [docs[(i + 3) % docs.length], docs[(i + 7) % docs.length]]
}))

const patterns = [
  'quick brown',
  'quik brwn',
  'brown quick',
  'qick fox lazy',
  'fox fox',
  'brown brown',
  'quick | lazy dog',
  'quik brwn | lzy dg',
  "quick 'fox",
  'quick ^the',
  'brwn !lazy',
  '"quick brown" fox',
  'extraordinarily sentence',
  'extraordinarilylongsentencequick brown',
  'abcdefghijklmnopqrstuvwxyzabcdefghij brown'
]

const optionSets = [
  { includeMatches: false },
  { includeMatches: true },
  { includeMatches: true, includeScore: true },
  { includeMatches: true, findAllMatches: true },
  { includeMatches: true, ignoreLocation: true },
  { includeMatches: true, minMatchCharLength: 3 },
  { includeMatches: false, threshold: 0.8 },
  { includeMatches: true, ignoreDiacritics: true }
]

const json = (v) => JSON.stringify(v)

describe('extended AND groups with several fuzzy terms match the baseline', () => {
  for (const opts of optionSets) {
    const options = { useExtendedSearch: true, includeScore: true, ...opts }

    test(`string list ${json(opts)}`, () => {
      const cand = new Fuse(docs, options)
      const base = new BaselineFuse(docs, options)
      for (const p of patterns) {
        expect(json(cand.search(p))).toBe(json(base.search(p)))
      }
    })

    test(`object list ${json(opts)}`, () => {
      const o = { ...options, keys: ['title', 'tags'] }
      const cand = new Fuse(objDocs, o)
      const base = new BaselineFuse(objDocs, o)
      for (const p of patterns) {
        expect(json(cand.search(p))).toBe(json(base.search(p)))
        expect(json(cand.search(p, { limit: 3 }))).toBe(
          json(base.search(p, { limit: 3 }))
        )
      }
    })

    test(`Fuse.match ${json(opts)}`, () => {
      for (const p of patterns) {
        for (const t of docs) {
          expect(json(Fuse.match(p, t, options))).toBe(
            json(BaselineFuse.match(p, t, options))
          )
        }
      }
    })
  }

  test('earlier results are not mutated by later searches', () => {
    const options = { useExtendedSearch: true, includeMatches: true }
    const cand = new Fuse(docs, options)
    const base = new BaselineFuse(docs, options)
    const first = cand.search('quik brwn')
    const snapshot = json(first)
    cand.search('lazy dog')
    cand.search('quick brown fox jumps')
    expect(json(first)).toBe(snapshot)
    expect(snapshot).toBe(json(base.search('quik brwn')))
  })
})

describe('bitap returns a fresh result object per call', () => {
  for (const includeMatches of [false, true]) {
    test(`BitapSearch.searchIn includeMatches=${includeMatches}`, () => {
      const short = new BitapSearch('brwn', { includeMatches })
      const long = new BitapSearch(
        'abcdefghijklmnopqrstuvwxyzabcdefghij brown',
        { includeMatches }
      )
      const exact = new BitapSearch('brown', { includeMatches })
      for (const s of [short, long, exact]) {
        const a = s.searchIn('the quick brown fox')
        const b = s.searchIn('brown')
        const c = s.searchIn('the quick brown fox')
        expect(a).not.toBe(b)
        expect(a).not.toBe(c)
        expect(b).not.toBe(c)
        if (includeMatches && a.indices && c.indices) {
          expect(a.indices).not.toBe(c.indices)
          expect(a.indices).toEqual(c.indices)
        }
      }
    })

    test(`kernel includeMatches=${includeMatches}`, () => {
      const chunk = new BitapSearch('quick').chunks[0]
      const kopts = {
        location: 0,
        distance: 100,
        threshold: 0.6,
        findAllMatches: false,
        minMatchCharLength: 1,
        includeMatches,
        ignoreLocation: false
      }
      const a = search('the quick brown fox', chunk, 0, kopts)
      const b = search('a quack', chunk, 0, kopts)
      const c = search('the quick brown fox', chunk, 0, kopts)
      expect(a).not.toBe(b)
      expect(a).not.toBe(c)
      expect(a).toEqual(c)
      if (includeMatches) expect(a.indices).not.toBe(c.indices)
    })
  }

  test('ExtendedSearch keeps each fuzzy result of an AND group intact', () => {
    for (const includeMatches of [false, true]) {
      const ext = new ExtendedSearch('quik brwn', { includeMatches })
      const res = ext.searchIn('the quick brown fox')
      const q = BaselineFuse.match('quik brwn', 'the quick brown fox', {
        useExtendedSearch: true,
        includeMatches
      })
      expect(json(res)).toBe(json(q))
    }
  })
})
