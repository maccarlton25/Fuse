// Soundness of the bitap reject filter (src/search/bitap/canMatch.ts): every
// (pattern, text, options) triple the filter rejects must be a non-match in the
// frozen baseline build, and BitapSearch must agree with the baseline exactly.
import BitapSearch from '../src/search/bitap'
import canMatch from '../src/search/bitap/canMatch'
import { stripDiacritics } from '../src/helpers/diacritics'
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

const rng = createRng(Number(process.env.PREFILTER_SEED) || 1234)
const pick = <T>(xs: T[]): T => xs[Math.floor(rng() * xs.length)]
const int = (n: number) => Math.floor(rng() * n)
const CHARS = 'abcdeABé ëxyz'.split('')
const randStr = (n: number) =>
  Array.from({ length: n }, () => pick(CHARS)).join('')

function mutate(s: string, edits: number): string {
  let out = s
  for (let k = 0; k < edits; k++) {
    const i = int(out.length + 1)
    const op = int(3)
    if (op === 0) out = out.slice(0, i) + pick(CHARS) + out.slice(i)
    else if (op === 1) out = out.slice(0, i) + out.slice(i + 1)
    else out = out.slice(0, i) + pick(CHARS) + out.slice(i + 1)
  }
  return out
}

function randomOptions() {
  return {
    threshold: pick([0, 0.1, 0.3, 0.6, 0.6, 0.8, 1, 1.5]),
    distance: pick([0, 1, 10, 100, 100, 1000]),
    location: pick([0, 0, 3, 20, 500, 100000]),
    ignoreLocation: rng() < 0.3,
    findAllMatches: rng() < 0.3,
    includeMatches: rng() < 0.4,
    minMatchCharLength: pick([1, 1, 2, 4]),
    isCaseSensitive: rng() < 0.3,
    ignoreDiacritics: rng() < 0.3
  }
}

function filterRejects(pattern: string, text: string, options: any): boolean {
  const searcher = new BitapSearch(pattern, options)
  let t = options.isCaseSensitive ? text : text.toLowerCase()
  t = options.ignoreDiacritics ? stripDiacritics(t) : t
  if (searcher.pattern === t) return false
  return (
    options.threshold < 1 &&
    searcher.chunks.every((c) => !canMatch(t, c, options))
  )
}

describe('bitap reject filter', () => {
  test('never rejects a text the baseline matches', () => {
    let rejected = 0
    const N = Number(process.env.PREFILTER_ITERS) || 20000
    for (let n = 0; n < N; n++) {
      const pattern = randStr(pick([1, 2, 3, 5, 8, 12, 31, 32, 33, 40, 64, 70]))
      const options = randomOptions()
      let text: string
      const r = rng()
      if (r < 0.1) text = ''
      else if (r < 0.6) {
        const pre = randStr(int(options.location < 50 ? 30 : 120))
        text =
          pre +
          mutate(pattern, int(Math.ceil(pattern.length / 2) + 1)) +
          randStr(int(30))
      } else text = randStr(int(150))

      const expected = BaselineFuse.match(pattern, text, options)
      if (filterRejects(pattern, text, options)) {
        rejected++
        if (expected.isMatch) {
          throw new Error(
            `unsound rejection: ${JSON.stringify({ pattern, text, options })}`
          )
        }
      }
      expect(
        JSON.stringify(new BitapSearch(pattern, options).searchIn(text))
      ).toBe(JSON.stringify(expected))
    }
    // The filter must actually do something on this mix.
    expect(rejected).toBeGreaterThan(N / 10)
  }, 600000)
})

// The filter scans only the kernel's location window when ignoreLocation is
// false. Long texts with matches placed just inside and just outside that
// window (|p - expected| ~ threshold * distance), every location regime and
// distances from 0 to 1e12 must still agree with the baseline byte for byte.
describe('bitap reject filter: location window on long texts', () => {
  const FILLER = 'qwrtuvz'.split('')
  const filler = (n: number) =>
    Array.from({ length: n }, () => pick(FILLER)).join('')

  const check = (pattern: string, text: string, options: any) => {
    const expected = JSON.stringify(BaselineFuse.match(pattern, text, options))
    expect(
      JSON.stringify(new BitapSearch(pattern, options).searchIn(text))
    ).toBe(expected)
  }

  test('matches just inside and just outside the window agree with the baseline', () => {
    const N = Number(process.env.PREFILTER_WINDOW_ITERS) || 4000
    for (let n = 0; n < N; n++) {
      const len = 500 + int(4501)
      const pattern = randStr(pick([1, 2, 4, 7, 12, 31, 32, 33, 40, 64]))
      const threshold = pick([0, 0.1, 0.3, 0.6, 0.6, 0.8, 1, 1.5])
      const distance = pick([
        0, 0, 1, 3, 10, 100, 100, 1000, 4999, 1e6, 1e9, 1e12
      ])
      const location = pick([
        0,
        int(len),
        int(len),
        len - 1,
        len,
        len + 1 + int(100),
        len * 3,
        -1 - int(50),
        1e12
      ])
      const expected = Math.max(0, Math.min(location, len))
      // Offset from the expected location to the edge of the window, then a
      // few characters either side of it, on either side of `expected`.
      const edge = Math.min(len, Math.floor(threshold * distance))
      const offset = (rng() < 0.5 ? -1 : 1) * (edge + int(7) - 3)
      const edits = int(Math.ceil(pattern.length * threshold) + 2)
      const needle = mutate(pattern, edits)
      const at = Math.max(0, Math.min(len, expected + offset))
      let text = filler(len)
      text = text.slice(0, at) + needle + text.slice(at)
      if (rng() < 0.3) {
        // A second copy deep in the text, usually far outside the window.
        const at2 = int(text.length)
        text = text.slice(0, at2) + mutate(pattern, int(2)) + text.slice(at2)
      }
      check(pattern, text, {
        threshold,
        distance,
        location,
        ignoreLocation: rng() < 0.15,
        findAllMatches: rng() < 0.3,
        includeMatches: rng() < 0.4,
        minMatchCharLength: pick([1, 1, 2, 4]),
        isCaseSensitive: rng() < 0.5,
        ignoreDiacritics: rng() < 0.2
      })
    }
  }, 600000)

  test('deterministic window edges', () => {
    const base = filler(3000)
    for (const pattern of [
      'tempor',
      'ab',
      'abcdefghijklmnopqrstuvwxyzABCDEFGHIJ'
    ]) {
      for (const distance of [0, 1, 100, 1000, 1e12]) {
        for (const threshold of [0, 0.3, 0.6, 0.99]) {
          for (const location of [0, 1500, 2999, 3000, 5000]) {
            const expected = Math.min(location, base.length)
            const edge = Math.floor(threshold * distance)
            for (const d of [-2, -1, 0, 1, 2]) {
              for (const side of [-1, 1]) {
                const at = Math.max(
                  0,
                  Math.min(base.length, expected + side * (edge + d))
                )
                for (const needle of [pattern, mutate(pattern, 1)]) {
                  const text = base.slice(0, at) + needle + base.slice(at)
                  check(pattern, text, { threshold, distance, location })
                  check(pattern, text, {
                    threshold,
                    distance,
                    location,
                    includeMatches: true
                  })
                  check(pattern, text, {
                    threshold,
                    distance,
                    location,
                    findAllMatches: true
                  })
                }
              }
            }
          }
        }
      }
    }
  }, 600000)

  test('unbounded windows: negative, infinite and NaN distance', () => {
    const base = filler(2000)
    for (const distance of [-1, -100, Infinity, NaN, 5e-324]) {
      for (const threshold of [0, -0, 0.6, -0.5]) {
        for (const location of [0, 1000, 2000]) {
          for (const at of [0, 37, 1000, 1990]) {
            for (const needle of ['tempor', 'tmpor']) {
              const text = base.slice(0, at) + needle + base.slice(at)
              check('tempor', text, { threshold, distance, location })
              check('tempor', text, {
                threshold,
                distance,
                location,
                includeMatches: true
              })
            }
          }
        }
      }
    }
  })

  test('invalid location never throws where the baseline returns, never differs', () => {
    const text = filler(800) + 'tempor' + filler(800)
    for (const location of [NaN, 2.5, 799.5, -0.5, Infinity, -Infinity]) {
      for (const findAllMatches of [false, true]) {
        for (const pattern of ['tempor', 'zzzzzzzz', 'tmpor']) {
          const options = { location, findAllMatches, threshold: 0.6 }
          let expected: string | undefined
          try {
            expected = JSON.stringify(
              BaselineFuse.match(pattern, text, options)
            )
          } catch {
            // The baseline throws (e.g. Array(NaN)); any result is acceptable.
            continue
          }
          expect(
            JSON.stringify(new BitapSearch(pattern, options).searchIn(text))
          ).toBe(expected)
        }
      }
    }
  })
})
