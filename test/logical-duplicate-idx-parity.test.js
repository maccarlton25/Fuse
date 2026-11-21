import { describe, expect, test } from 'vitest'
import BaselineFuse from '../bench/baseline-fuse.mjs'
import Fuse from '../dist/fuse.mjs'

// _searchLogical merges the matches of records that share an `i` into one
// result (the `existing.matches.push(...)` branch). An earlier review called
// that branch unreachable because indexes built by Fuse have unique `i`, but a
// hand-built or parsed index can repeat one, and the baseline merges them, so
// the branch must stay. This pins the merged result to the baseline's.
const docs = [
  { t: 'apple', u: 'maple' },
  { t: 'apply', u: 'ample' },
  { t: 'zz', u: 'apple' }
]
const keys = ['t', 'u']

const withDuplicates = (F) => {
  const json = F.createIndex(keys, docs).toJSON()
  const [r0, r1, r2] = json.records
  // idx 0 appears three times (once carrying record 1's values), idx 1 twice.
  json.records = [r0, { ...r1, i: 0 }, r1, { ...r2, i: 0 }, { ...r0, i: 1 }, r2]
  return F.parseIndex(JSON.parse(JSON.stringify(json)))
}

const queries = [
  { t: 'appl' },
  { $or: [{ t: 'appl' }, { u: 'ampl' }] },
  { $and: [{ t: 'appl' }, { u: 'ple' }] },
  { $path: 'u', $val: 'apple' },
  { t: { $contains: 'pp' } },
  { $or: [{ t: "'pp" }, { u: '!maple' }] }
]

const optionSets = [
  { includeMatches: true, includeScore: true },
  { includeMatches: true, includeScore: true, useExtendedSearch: true },
  { includeScore: true, shouldSort: false, useExtendedSearch: true },
  { includeMatches: true, limit: 1, useExtendedSearch: true }
]

describe('logical search: duplicate record indexes merge like the baseline', () => {
  test('parsed index with repeated `i`', () => {
    const diffs = []
    let merged = 0
    for (const o of optionSets) {
      const { limit, ...opts } = o
      const base = new BaselineFuse(
        docs,
        { ...opts, keys },
        withDuplicates(BaselineFuse)
      )
      const cand = new Fuse(docs, { ...opts, keys }, withDuplicates(Fuse))
      for (const q of queries) {
        const run = (f) => {
          try {
            return f.search(q, limit ? { limit } : undefined)
          } catch (e) {
            return `${e.constructor.name}: ${e.message}`
          }
        }
        const b = run(base)
        const c = run(cand)
        if (
          Array.isArray(b) &&
          b.some((r) => r.matches && r.matches.length > 2)
        )
          merged += 1
        if (JSON.stringify(b) !== JSON.stringify(c)) diffs.push({ o, q, b, c })
      }
    }
    expect(diffs).toEqual([])
    // The fixture really exercises the merge (more matches than keys).
    expect(merged).toBeGreaterThan(0)
  })
})
