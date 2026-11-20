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
