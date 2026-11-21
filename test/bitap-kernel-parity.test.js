import Fuse from '../dist/fuse.mjs'
import BaselineFuse from '../bench/baseline-fuse.mjs'

// Differential checks of the bitap kernel against the locked baseline oracle,
// focused on the edges of the typed-array rewrite: 31/32/33+ character
// patterns (sign bit, multi-chunk), stale scratch buffers between calls,
// raised scan starts below the first level's window, text-end padding,
// non-Latin-1 and astral code units, and every location/distance branch.

const words = [
  'algorithm',
  'architecture',
  'authentication',
  'benchmark',
  'café',
  'naïve',
  'résumé',
  'हिन्दी',
  '😀 emoji',
  'e\u0301clair',
  'a\u0000b',
  'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  'abababababababababababababababab'
]

function makeRng(seed) {
  let a = seed >>> 0
  return () => {
    let t = (a += 0x6d2b79f5)
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const rng = makeRng(42)
const pick = (arr) => arr[Math.floor(rng() * arr.length)]
const sentence = (n) =>
  Array.from({ length: n }, () => pick(words)).join(rng() < 0.5 ? ' ' : '')

const docs = Array.from({ length: 60 }, () =>
  sentence(1 + Math.floor(rng() * 8))
)

const queries = [
  'a',
  'b',
  'aa',
  'algoritm',
  'architecure',
  'cafe',
  'हिन',
  '😀',
  'e\u0301',
  '\u0000',
  'a'.repeat(31),
  'a'.repeat(32),
  'a'.repeat(33),
  'ab'.repeat(16),
  'ab'.repeat(16) + 'x',
  'algorithm architecture benchmar',
  'algorithm architecture benchmark',
  'algorithm architecture benchmarks',
  'authentication benchmark algorithm architecture café naïve résumé'
]

const optionSets = [
  {},
  { includeMatches: true, includeScore: true },
  { location: 20, distance: 10, threshold: 0.4, includeMatches: true },
  { location: 500, includeScore: true },
  { distance: 0, includeScore: true, includeMatches: true },
  { ignoreLocation: true, includeScore: true, includeMatches: true },
  { findAllMatches: true, includeMatches: true, threshold: 0.8 },
  { minMatchCharLength: 3, includeMatches: true, threshold: 0.7 },
  { location: 7, distance: 3, threshold: 0.2, isCaseSensitive: true },
  { ignoreDiacritics: true, includeMatches: true, threshold: 1 }
]

describe('bitap kernel parity with baseline', () => {
  for (const opts of optionSets) {
    test(`options ${JSON.stringify(opts)}`, () => {
      const options = { includeScore: true, ...opts }
      const candidate = new Fuse(docs, options)
      const baseline = new BaselineFuse(docs, options)
      // Interleave queries of different lengths so scratch buffers are reused.
      for (const q of [...queries, ...queries.slice().reverse()]) {
        expect(JSON.stringify(candidate.search(q))).toBe(
          JSON.stringify(baseline.search(q))
        )
      }
    })
  }
})
