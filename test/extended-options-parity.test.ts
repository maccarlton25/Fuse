import Fuse from '../dist/fuse.mjs'
import FuseMin from '../dist/fuse.min.mjs'
// @ts-ignore untyped oracle
import Baseline from '../bench/baseline-fuse.mjs'

// Extended search resolves its options against Config with `??`; null,
// undefined and non-boolean values must behave exactly as in the baseline.
const docs = [
  { title: "Old Man's War", author: 'John Scalzi', tags: ['sci-fi', 'War'] },
  { title: 'The Lock Artist', author: 'Steve Hamilton', tags: ['crime'] },
  { title: 'HTML5', author: 'Rémi Sharp', tags: ['web', 'Html'] },
  { title: 'Crème Brûlée', author: 'Jørn Łukasz', tags: [] },
  { title: 'the war of the worlds', author: 'H. G. Wells', tags: ['WAR'] }
]
const keys = ['title', 'author', 'tags']
const values = [undefined, null, 0, 1, '', 'x', true, false]
const queries: any[] = [
  'war',
  '=HTML5',
  "'War !lock",
  '^the | ^old',
  '!^cr ûlée$',
  '"man\'s war" !worlds',
  'brulee',
  { title: { $contains: 'War' } },
  { $or: [{ author: { $startsWith: 'Ré' } }, { title: { $fuzzy: 'creme' } }] },
  { title: { $not: { $endsWith: 'WORLDS' } } },
  {
    tags: {
      $or: [{ $eq: 'war' }, { $and: [{ $contains: 'h' }, { $fuzzy: 'html' }] }]
    }
  }
]
const optionNames = [
  'isCaseSensitive',
  'ignoreDiacritics',
  'includeMatches',
  'findAllMatches',
  'ignoreLocation',
  'minMatchCharLength',
  'location',
  'threshold',
  'distance'
]

const run = (F: any, opts: any) => {
  const fuse = new F(docs, {
    keys,
    useExtendedSearch: true,
    includeScore: true,
    ...opts
  })
  return queries.map((q) => {
    try {
      return fuse.search(q)
    } catch (e: any) {
      return 'throw: ' + e.message
    }
  })
}

// Accepted, recorded divergence: for a NaN/fractional `location` the baseline
// throws `RangeError: Invalid array length` on some texts; the candidate may
// return instead. Mask those cells only.
const RANGE_ERROR = 'throw: Invalid array length'
const mask = (got: any[], expected: any[]) =>
  got.map((g, i) => (expected[i] === RANGE_ERROR ? RANGE_ERROR : g))

const matchOrThrow = (F: any, q: string, opts: any) => {
  try {
    return F.match(q, 'The War of the Worlds', opts)
  } catch (e: any) {
    return 'throw: ' + e.message
  }
}

describe('extended search option defaulting matches the baseline', () => {
  for (const name of optionNames) {
    test(name, () => {
      for (const v of values) {
        const opts = {
          [name]: v,
          includeMatches: name === 'includeMatches' ? v : true
        }
        const expected = run(Baseline, opts)
        expect(mask(run(Fuse, opts), expected)).toEqual(expected)
        expect(mask(run(FuseMin, opts), expected)).toEqual(expected)
      }
    })
  }

  test('Fuse.match with extended options', () => {
    for (const name of optionNames) {
      for (const v of values) {
        const opts = {
          [name]: v,
          useExtendedSearch: true,
          includeMatches: true
        }
        for (const q of ['war', "'War !lock", '^the$']) {
          const expected = [matchOrThrow(Baseline, q, opts)]
          expect(mask([matchOrThrow(Fuse, q, opts)], expected)).toEqual(
            expected
          )
          expect(mask([matchOrThrow(FuseMin, q, opts)], expected)).toEqual(
            expected
          )
        }
      }
    }
  })
})
