import Fuse from '../dist/fuse.mjs'
import BaselineFuse from '../bench/baseline-fuse.mjs'

// A hand-built index passed to Fuse.parseIndex may have holes in `records`
// (and in the SubRecord arrays inside them). The baseline iterated with
// `forEach`, which skips holes; the candidate must return the same results
// instead of throwing.
function run(F, docs, options, json, query, searchOpts) {
  const fuse = new F(docs, options, F.parseIndex(json))
  return JSON.stringify(fuse.search(query, searchOpts))
}

function sparseCopy(records, holes) {
  const out = []
  records.forEach((r, i) => {
    if (!holes.includes(i)) out[i] = r
  })
  out.length = records.length
  return out
}

const searchVariants = [undefined, { limit: 1 }, { limit: 5 }]

describe('sparse records via parseIndex match the baseline', () => {
  test('string list', () => {
    const docs = ['apple', 'apricot', 'application', 'banana', 'grape']
    const options = { includeScore: true, includeMatches: true }
    const base = BaselineFuse.createIndex([], docs).toJSON()
    const json = { keys: base.keys, records: sparseCopy(base.records, [1, 3]) }
    expect(1 in json.records).toBe(false)

    for (const searchOpts of searchVariants) {
      const expected = run(BaselineFuse, docs, options, json, 'app', searchOpts)
      expect(run(Fuse, docs, options, json, 'app', searchOpts)).toBe(expected)
      expect(JSON.parse(expected).length).toBeGreaterThan(0)
    }
  })

  test('object list', () => {
    const docs = [
      { title: 'apple pie', tags: ['fruit', 'apple'] },
      { title: 'banana bread', tags: ['fruit'] },
      { title: 'apple tart', tags: ['dessert', 'apple'] },
      { title: 'grape juice', tags: ['drink'] }
    ]
    const keys = ['title', 'tags']
    const options = { keys, includeScore: true, includeMatches: true }
    const base = BaselineFuse.createIndex(keys, docs).toJSON()
    const records = sparseCopy(base.records, [1])
    // A hole inside a SubRecord array too.
    const r2 = JSON.parse(JSON.stringify(records[2]))
    const arr = []
    arr[1] = r2.$[1][1]
    arr.length = 2
    r2.$[1] = arr
    records[2] = r2
    const json = { keys: base.keys, records }

    for (const searchOpts of searchVariants) {
      const expected = run(BaselineFuse, docs, options, json, 'app', searchOpts)
      expect(run(Fuse, docs, options, json, 'app', searchOpts)).toBe(expected)
      expect(JSON.parse(expected).length).toBeGreaterThan(0)
    }

    // Logical search reaches the same SubRecord-array scan.
    for (const query of [
      { tags: 'app' },
      { $or: [{ title: 'app' }, { tags: 'app' }] }
    ]) {
      const expected = run(BaselineFuse, docs, options, json, query)
      expect(run(Fuse, docs, options, json, query)).toBe(expected)
    }
  })
})
