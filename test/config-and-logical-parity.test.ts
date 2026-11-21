import Fuse from '../dist/fuse.mjs'
import FuseMin from '../dist/fuse.min.mjs'
// @ts-ignore untyped oracle
import Baseline from '../bench/baseline-fuse.mjs'

const builds: [string, any][] = [
  ['dist/fuse.mjs', Fuse],
  ['dist/fuse.min.mjs', FuseMin]
]

describe('Fuse.config matches the baseline', () => {
  test.each(builds)('%s', (_, F) => {
    const B = Baseline.config
    const C = F.config
    expect(Object.keys(C)).toEqual(Object.keys(B))
    expect(Object.isFrozen(C)).toBe(true)
    for (const k of Object.keys(B)) {
      if (typeof B[k] !== 'function') expect(C[k]).toEqual(B[k])
    }
    const a = { score: 0.5, idx: 2 }
    const b = { score: 0.5, idx: 1 }
    const c = { score: 0.1, idx: 9 }
    for (const [x, y] of [
      [a, b],
      [b, a],
      [a, c],
      [c, a],
      [a, a]
    ]) {
      expect(C.sortFn(x, y)).toBe(B.sortFn(x, y))
    }
  })
})

// Logical queries over unusual records: a user-supplied index whose records
// repeat an `i` (the result for that doc merges both records' matches), a
// sparse records array (holes are skipped), and holes inside the query arrays.
describe('logical search on unusual records matches the baseline', () => {
  const docs = [
    { a: 'apple pie', b: 'banana' },
    { a: 'cherry', b: 'apple' },
    { a: 'date', b: 'elder' }
  ]
  const keys = ['a', 'b']
  const opts = { keys, includeMatches: true, includeScore: true }
  const indexJson = (F: any) => F.createIndex(keys, docs).toJSON()
  const setups: Record<string, (F: any) => any> = {
    plain: (F) => new F(docs, opts),
    duplicateRecordIndex: (F) => {
      const j = indexJson(F)
      j.records = [j.records[0], { ...j.records[1], i: 0 }, j.records[2]]
      return new F(docs, opts, F.parseIndex(j))
    },
    sparseRecords: (F) => {
      const j = indexJson(F)
      // eslint-disable-next-line no-sparse-arrays
      j.records = [j.records[0], , j.records[2]]
      return new F(docs, opts, F.parseIndex(j))
    }
  }
  /* eslint-disable no-sparse-arrays */
  const queries: any[] = [
    { $or: [{ a: 'apple' }, { b: 'apple' }] },
    { $and: [{ a: 'apple' }, , { b: 'banana' }] },
    { $or: [, { a: 'cherry' }] },
    { $and: [] },
    { a: 'apple', b: 'ban' },
    { $or: [{ $and: [{ a: 'date' }, { b: 'elder' }] }, 'apple'] }
  ]
  /* eslint-enable no-sparse-arrays */
  const run = (F: any, setup: (F: any) => any, q: any) => {
    try {
      return setup(F).search(q)
    } catch (e: any) {
      return 'throw: ' + e.message
    }
  }
  for (const [name, setup] of Object.entries(setups)) {
    test.each(builds)(`${name} (%s)`, (_, F) => {
      for (const q of queries) {
        expect(run(F, setup, q)).toEqual(run(Baseline, setup, q))
      }
    })
  }

  test('duplicate record index merges matches, as in the baseline', () => {
    const r = setups.duplicateRecordIndex(FuseMin).search({
      $or: [{ a: 'apple' }, { b: 'apple' }]
    })
    expect(r.length).toBe(1)
    expect(r[0].matches.map((m: any) => m.value)).toEqual([
      'apple pie',
      'apple'
    ])
  })
})
