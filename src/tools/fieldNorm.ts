import type { NormInterface } from '../types'

// Word separators: the common ASCII whitespace (tab 9, LF 10, VT 11, FF 12,
// CR 13, space 32) plus NBSP (160). This is deliberately narrower than the
// full Unicode whitespace set (\s); it skips rarer separators like the
// ideographic space and en/em spaces, which the field-norm heuristic is too
// coarse to benefit from distinguishing. All but the space are mapped to a
// space first (only when present).
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
      // Count words by tallying word-starts (transitions from separator/start
      // to non-separator). This avoids allocating a regex match array and
      // correctly handles leading and trailing separators.
      //
      // A separator here is common ASCII whitespace (space, tab, newline, CR,
      // vertical tab, form feed) plus NBSP, not the full Unicode set.
      if (RARE_SEPARATORS.test(value)) {
        value = value.replace(/[\t-\r\xa0]/g, ' ')
      }
      // A word starts at index 0 or right after a space; indexOf scans
      // natively, far faster than a per-char loop.
      const len = value.length
      let numTokens = len && value.charCodeAt(0) !== 32 ? 1 : 0
      for (let p = value.indexOf(' '); p >= 0; p = value.indexOf(' ', p + 1)) {
        if (p + 1 < len && value.charCodeAt(p + 1) !== 32) numTokens++
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
