import { describe, expect, test } from 'vitest'
import BaselineFuse from '../bench/baseline-fuse.mjs'
import Fuse from '../dist/fuse.mjs'

// The record scans (_searchStringList / _searchObjectList) collect results
// either into a top-k heap (sorted search with a positive limit) or into a
// plain array (everything else). Both branches must return exactly the
// baseline's results, including on sparse record arrays.
const words = ['apple', 'apply', 'ample', 'maple', 'pale', 'applet', 'Äpple']
const strings = []
const objects = []
for (let i = 0; i < 60; i += 1) {
  const s = `${words[i % words.length]} ${words[(i * 3) % words.length]} ${i}`
  strings.push(s)
  objects.push({ title: s, tags: [words[(i * 5) % words.length]] })
}

const sparse = (list) => {
  const out = list.slice()
  delete out[3]
  delete out[17]
  out.length += 2
  return out
}

const limits = [undefined, -1, 0, 1, 3, 10, 59, 60, 1000]
const optionSets = [
  {},
  { includeMatches: true, includeScore: true },
  { shouldSort: false, includeScore: true },
  { useExtendedSearch: true, includeScore: true },
  { useTokenSearch: true, tokenMatch: 'all', includeScore: true },
  { ignoreFieldNorm: true, threshold: 0.3, includeScore: true }
]
const queries = ['appl', 'ple 1', "'ap !maple", 'zzzz']

describe('record scans: heap and array paths match the baseline', () => {
  for (const [name, docs, keys] of [
    ['string list', strings, undefined],
    ['object list', objects, ['title', 'tags']],
    ['sparse string list', sparse(strings), undefined],
    ['sparse object list', sparse(objects), ['title', 'tags']]
  ]) {
    test(name, () => {
      const diffs = []
      for (const opts of optionSets) {
        const o = keys ? { ...opts, keys } : opts
        const base = new BaselineFuse(docs, o)
        const cand = new Fuse(docs, o)
        for (const q of queries) {
          for (const limit of limits) {
            const lo = limit === undefined ? undefined : { limit }
            const run = (f) => {
              try {
                return JSON.stringify(f.search(q, lo))
              } catch (e) {
                return `${e.constructor.name}: ${e.message}`
              }
            }
            const b = run(base)
            const c = run(cand)
            if (b !== c) diffs.push({ opts, q, limit, b, c })
          }
        }
      }
      expect(diffs).toEqual([])
    })
  }
})
