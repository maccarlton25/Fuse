// Bitmask of the pattern positions holding each UTF-16 code unit, keyed by
// char code (integer keys keep lookups on the fast elements path).
export default function createPatternAlphabet(
  pattern: string
): Record<number, number> {
  const mask: Record<number, number> = {}

  for (let i = 0, len = pattern.length; i < len; i += 1) {
    const code = pattern.charCodeAt(i)
    mask[code] = (mask[code] || 0) | (1 << (len - i - 1))
  }

  return mask
}
