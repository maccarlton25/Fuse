import type { NormInterface } from '../types'

// Word separators: the common ASCII whitespace (tab 9, LF 10, VT 11, FF 12,
// CR 13, space 32) plus NBSP (160). This is deliberately narrower than the
// full Unicode whitespace set (\s); it skips rarer separators like the
// ideographic space and en/em spaces, which the field-norm heuristic is too
// coarse to benefit from distinguishing.
const RARE_SEPARATORS = /[\t-\r\xa0]/

// Field-length norm: the shorter the field, the higher the weight.
// Set to 3 decimals to reduce index size.
export default function norm(
  weight: number = 1,
  mantissa: number = 3
): NormInterface {
  const cache = new Map<number, number>()
  const m = Math.pow(10, mantissa)

  return {
    get(value: string): number {
      // Count words by tallying word-starts (a non-separator at index 0 or
      // right after a separator), without allocating. When the only
      // separator present is the space, jump from each word-start straight
      // to the next space with indexOf, which scans natively; otherwise walk
      // every char.
      const rare = RARE_SEPARATORS.test(value)
      let numTokens = 0
      for (let i = 0, inWord = false, len = value.length; i < len; i++) {
        const c = value.charCodeAt(i)
        if (c > 32 ? c === 160 : c === 32 || (c > 8 && c < 14)) {
          inWord = false
        } else if (!inWord) {
          numTokens++
          inWord = rare
          if (!rare && (i = value.indexOf(' ', i)) < 0) break
        }
      }
      // Empty strings and all-whitespace strings have no real words; treat
      // them as a single token so the formula never divides by zero.
      if (numTokens === 0) numTokens = 1

      if (cache.has(numTokens)) {
        return cache.get(numTokens)!
      }

      // Default function is 1/sqrt(x), weight makes that variable
      const n = Math.round(m / Math.pow(numTokens, 0.5 * weight)) / m

      cache.set(numTokens, n)

      return n
    },
    clear() {
      cache.clear()
    }
  }
}
