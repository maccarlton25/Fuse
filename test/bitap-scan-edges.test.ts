// Generation 3 changes to the Myers pass (src/search/bitap/canMatch.ts):
//  - an integer edit bound (kmax) is tested before calcScore,
//  - the exact-copy shortcut applies to windows longer than 32 positions
//    (was 256) and needs no slice when the window reaches the end of the text,
//  - callers that only test the result for truth may stop at the first
//    passing start with ignoreLocation (`any`).
// Two differential checks: the loop against the generation 2 loop kept here as
// a reference (same answer wherever the result is used), and whole searches
// against the frozen baseline with near-misses planted at the window edges.
// Iteration counts can be raised with SCAN_EDGE_ITERS / SCAN_REF_ITERS.
import BitapSearch from '../src/search/bitap'
import canMatch from '../src/search/bitap/canMatch'
import { calcScore, type BitapChunk } from '../src/search/bitap/search'
// @ts-ignore - untyped frozen baseline bundle
import BaselineFuse from '../bench/baseline-fuse.mjs'

function createRng(seed: number) {
  let a = seed >>> 0
  return () => {
    let t = (a += 0x6d2b79f5)
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const rng = createRng(Number(process.env.SCAN_EDGE_SEED) || 4242)
const pick = <T>(xs: T[]): T => xs[Math.floor(rng() * xs.length)]
const int = (n: number) => Math.floor(rng() * n)
const ALPHABETS = [
  'abcde'.split(''),
  'ab'.split(''),
  'abcdeéëxyz '.split(''),
  'αβγδεabc'.split(''),
  '中文字日本ab'.split('')
]
const randStr = (n: number, al: string[]) =>
  Array.from({ length: n }, () => pick(al)).join('')

function mutate(s: string, edits: number, al: string[]): string {
  let out = s
  for (let k = 0; k < edits; k++) {
    const i = int(out.length + 1)
    const op = int(3)
    if (op === 0) out = out.slice(0, i) + pick(al) + out.slice(i)
    else if (op === 1) out = out.slice(0, i) + out.slice(i + 1)
    else out = out.slice(0, i) + pick(al) + out.slice(i + 1)
  }
  return out
}

const THRESHOLDS = [
  -1,
  -0.5,
  -0,
  0,
  0.001,
  0.1,
  0.25,
  0.3,
  0.5,
  0.6,
  0.6,
  0.75,
  0.9,
  1,
  1.5,
  NaN,
  Infinity,
  -Infinity
]
const DISTANCES = [
  -100,
  -1,
  -0,
  0,
  0.5,
  1,
  2.5,
  10,
  100,
  100,
  1000,
  1e4,
  1e6,
  1e12,
  NaN,
  Infinity,
  -Infinity
]
const LENGTHS = [1, 2, 3, 7, 31, 32, 33, 40, 64, 65, 100]

// Generation 2 canMatch loop (one calcScore per position, full minimum with
// ignoreLocation) as the reference.
function refCanMatch(
  text: string,
  { pattern, alphabet, table, startIndex }: BitapChunk,
  { location, distance, threshold, ignoreLocation }: any
): number {
  const n = text.length
  const m = pattern.length
  const expected = Math.max(0, Math.min(location + startIndex, n))
  const w = ignoreLocation || distance < 0 ? n : threshold * distance + 1 || n
  let j = Math.min(n, expected + w + 2 * m) | 0
  const stop = expected > w ? expected - w : 0
  const last = 1 << (m - 1)
  let pv = -1
  let mv = 0
  let score = m
  let best = m
  // The shortcut as it now stands (guard 32, no slice at the text end), so
  // that this compares the walk alone.
  if (
    j - stop > 32 &&
    threshold >= 0 &&
    (j < n
      ? text.slice(stop, j).includes(pattern)
      : text.includes(pattern, stop))
  )
    return ~0
  while (j-- > stop) {
    const c = text.charCodeAt(j)
    const eq = table[c] ?? alphabet[c] | 0
    const xv = eq | mv
    const xh = (((eq & pv) + pv) ^ pv) | eq
    let ph = mv | ~(xh | pv)
    let mh = pv & xh
    if (ph & last) score++
    else if (mh & last) score--
    ph <<= 1
    mh <<= 1
    pv = mh | ~(xv | ph)
    mv = ph & xv
    if (ignoreLocation) {
      if (score < best) best = score
    } else if (
      calcScore(score, j, m, expected, distance, ignoreLocation) <= threshold
    ) {
      return 1
    }
  }
  return best < m && best / m <= threshold ? ~best : 0
}

// Window half-width as the filter computes it, for planting near-misses.
const halfWidth = (threshold: number, distance: number, n: number) => {
  const w = distance < 0 ? n : threshold * distance + 1 || n
  return Number.isFinite(w) ? Math.max(0, Math.min(n, Math.floor(w))) : n
}

function plantedText(pattern: string, al: string[], options: any) {
  const len = pick([0, 5, 40, 200, 300, 1000, 5000, 20000].slice(0, 2 + int(7)))
  let text = randStr(len, al)
  const m = pattern.length
  const e = Math.max(0, Math.min(Number(options.location) || 0, len))
  const T = halfWidth(options.threshold, options.distance, len)
  const copies = 1 + int(3)
  for (let q = 0; q < copies; q++) {
    // Within 2m of either window edge (e ± T), or an exact copy at e.
    const edge = pick([e - T, e + T, e, e - T - m, e + T + m])
    const pos = Math.max(0, Math.min(len, edge + int(4 * m + 1) - 2 * m))
    const copy =
      rng() < 0.3 ? pattern : mutate(pattern, 1 + int(Math.max(1, m >> 1)), al)
    text = text.slice(0, pos) + copy + text.slice(pos + copy.length)
  }
  return text.slice(0, 20000)
}

function randomOptions(len: number) {
  return {
    threshold: pick(THRESHOLDS),
    distance: pick(DISTANCES),
    location: pick([0, 0, 0.5, 3, int(len + 1), len, len + 7, -5, 1e12, NaN]),
    ignoreLocation: rng() < 0.35,
    findAllMatches: rng() < 0.25,
    includeMatches: rng() < 0.4,
    minMatchCharLength: pick([1, 1, 1, 2, 3]),
    isCaseSensitive: true,
    ignoreDiacritics: false
  }
}

describe('Myers pass: same answers as the generation 2 loop', () => {
  test('location-aware truth, ignoreLocation exact minimum and `any` truth', () => {
    const N = Number(process.env.SCAN_REF_ITERS) || 6000
    let passed = 0
    for (let n = 0; n < N; n++) {
      const al = pick(ALPHABETS)
      const pattern = randStr(pick(LENGTHS), al)
      const options = randomOptions(1000)
      const text = plantedText(pattern, al, options)
      // Thresholds placed on an edit boundary k / m half of the time.
      if (rng() < 0.5)
        options.threshold =
          int(Math.min(pattern.length, 32) + 1) / Math.min(pattern.length, 32)
      for (const chunk of new BitapSearch(pattern, options).chunks) {
        const ref = refCanMatch(text, chunk, options)
        const exact = canMatch(text, chunk, options)
        const any = canMatch(text, chunk, options, true)
        if (ref) passed++
        if (options.ignoreLocation) {
          // The shortcut and the walk both give ~0 for an exact copy.
          expect(exact).toBe(ref)
        } else {
          expect(!!exact).toBe(!!ref)
        }
        expect(!!any).toBe(!!ref)
      }
    }
    expect(passed).toBeGreaterThan(N / 10)
  }, 600000)
})

// floor(threshold * m) is off by one from the float test k / m <= threshold
// for some m and k (e.g. m = 22, k = 15 needs the upward fix-up, m = 6, k = 5
// one ulp below 5 / 6 the downward one). Every m up to 32, every k, the
// boundary and one ulp either side, texts exactly k - 1, k and k + 1 edits away.
describe('Myers pass: edit bound on every k / m boundary', () => {
  const ulp = (x: number, dir: 1 | -1) => {
    const f = new Float64Array([x])
    const u = new BigInt64Array(f.buffer)
    if (x === 0) return dir * Number.MIN_VALUE
    u[0] += x > 0 === dir > 0 ? 1n : -1n
    return f[0]
  }
  test('same answers as the reference at and around each boundary', () => {
    for (let m = 1; m <= 32; m++) {
      const pattern = randStr(m, 'abcde'.split(''))
      for (let k = 0; k <= m; k++) {
        for (const threshold of [k / m, ulp(k / m, 1), ulp(k / m, -1)]) {
          for (let d = Math.max(0, k - 1); d <= Math.min(m, k + 1); d++) {
            const chars = pattern.split('')
            for (let q = 0; q < d; q++) chars[q] = 'z'
            const text = 'zzz' + chars.join('') + 'zzzz'
            for (const options of [
              { threshold, distance: 1e9, location: 3, ignoreLocation: false },
              { threshold, distance: 100, location: 0, ignoreLocation: false },
              { threshold, distance: 0, location: 3, ignoreLocation: false },
              { threshold, distance: -5, location: 0, ignoreLocation: false },
              { threshold, distance: 100, location: 0, ignoreLocation: true }
            ]) {
              const [chunk] = new BitapSearch(pattern, options).chunks
              const ref = refCanMatch(text, chunk, options)
              const got = canMatch(text, chunk, options)
              if (options.ignoreLocation) expect(got).toBe(ref)
              else expect(!!got).toBe(!!ref)
              expect(!!canMatch(text, chunk, options, true)).toBe(!!ref)
            }
          }
        }
      }
    }
  })
})

describe('Myers pass: near-misses at the window edges against the baseline', () => {
  test('texts up to 20,000 characters agree byte for byte', () => {
    const N = Number(process.env.SCAN_EDGE_ITERS) || 3000
    let matched = 0
    for (let n = 0; n < N; n++) {
      const al = pick(ALPHABETS)
      const pattern = randStr(pick(LENGTHS), al)
      const options = randomOptions(1000)
      let text = plantedText(pattern, al, options)
      options.isCaseSensitive = rng() < 0.5
      if (rng() < 0.2) text = text.toUpperCase()
      let expected: string
      try {
        expected = JSON.stringify(BaselineFuse.match(pattern, text, options))
      } catch (e) {
        // The baseline sizes an array from a NaN or fractional location.
        continue
      }
      const got = JSON.stringify(
        new BitapSearch(pattern, options).searchIn(text)
      )
      if (got !== expected) {
        throw new Error(
          `mismatch: ${JSON.stringify({ pattern, textLen: text.length, options: String(Object.entries(options)) })} base=${expected} got=${got}`
        )
      }
      if (expected.includes('"isMatch":true')) matched++
    }
    expect(matched).toBeGreaterThan(N / 20)
  }, 600000)

  test('a lone exact copy in a short window is found without the walk', () => {
    // 40 to 300 characters, the copy at or near the expected location.
    for (const len of [33, 40, 60, 90, 200, 300]) {
      for (const off of [0, 1, 3, 20]) {
        const text = (
          'x'.repeat(off) +
          ' zyzzyva ' +
          'lorem ipsum '.repeat(30)
        ).slice(0, len)
        for (const options of [
          { distance: 100000 },
          {},
          { distance: 100000, includeMatches: true },
          { ignoreLocation: true }
        ]) {
          expect(
            JSON.stringify(new BitapSearch('zyzzyva', options).searchIn(text))
          ).toBe(JSON.stringify(BaselineFuse.match('zyzzyva', text, options)))
        }
      }
    }
  })
})
