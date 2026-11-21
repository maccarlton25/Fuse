// Characters that survive NFD normalization unchanged and need explicit mapping
const NON_DECOMPOSABLE_MAP: Record<string, string> = {
  '\u0142': 'l', // ł
  '\u0141': 'L', // Ł
  '\u0111': 'd', // đ
  '\u0110': 'D', // Đ
  '\u00F8': 'o', // ø
  '\u00D8': 'O', // Ø
  '\u0127': 'h', // ħ
  '\u0126': 'H', // Ħ
  '\u0167': 't', // ŧ
  '\u0166': 'T', // Ŧ
  '\u0131': 'i', // ı
  '\u00DF': 'ss' // ß
}

const NON_DECOMPOSABLE_RE = new RegExp(
  '[' + Object.keys(NON_DECOMPOSABLE_MAP).join('') + ']',
  'g'
)

// Combining marks removed after NFD decomposition: the BMP code-unit ranges
// U+0300-U+036F, U+0483-U+0489, ..., U+FE20-U+FE2F. Stored compactly as
// base-36 pairs (gap from the previous range's end, range length) and expanded
// once at load into an equivalent character class; this saves about 600 B gzip
// over the literal `\uXXXX` class (603 B of dist/fuse.min.mjs when measured).
// test/diacritics-marks.test.ts checks the expanded set against the original
// literal for every UTF-16 code unit.
const MARK_RANGES =
  'lc 33 7o 6 7c 18 2 0 2 1 2 1 2 0 21 a 1d k h 0 2u 6 3 5 3 1 2 3 10 0 v q 2k a 1n 8 a 0 p 3 2 8 2 2 2 4 18 2 3c e 2 w 1j 2 2 h 2 6 b 1 u 2 1l 0 2 6 3 1 3 2 a 0 b 1 r 0 3 2 1l 0 2 4 5 1 3 2 4 0 v 1 4 0 c 2 1l 0 2 7 2 2 2 2 l 1 n 5 2 2 1l 0 2 6 3 1 3 2 9 1 b 1 v 0 1o 4 4 2 2 3 a 0 15 4 1m 6 2 2 2 3 8 1 c 1 u 2 1l 0 2 6 2 2 2 3 8 1 c 1 t 3 1k 1 2 6 2 2 2 3 a 0 b 1 v 1 1z 0 5 5 2 0 2 7 j 1 1q 0 3 6 d 7 2r 0 3 5 2 1 c 5 23 1 s 0 2 0 2 0 5 1 1e j 2 1 6 a 2 z a 0 2t j o 3 5 2 2 2 3 6 4 3 e b 2 0 b 3 jk 2 qb 2 u 2 u 1 v 1 1t v a 0 1a 2 3c 1 z 0 3b b 5 b 64 4 1m 9 2 s 3 0 1d e 1u 4 1c g 13 8 d 2 v c 1l d 1d j 49 2 2 k 5 0 5 2 3 2 5j 1l 2 4 k1 w 2db 2 3y 0 2p v ff 5 2y 1 n9x 3 2 9 x 1 29 1 7l 0 4 0 5 0 o 4 2h 1 1f h r h e 0 13 7 q c 19 3 1c d 11 0 1w d d 0 9 1 1a 2 1f 0 2 2 3 1 6 1 2 0 16 4 6 1 6l 7 2 1 fn5 0 ki f h f'.split(
    ' '
  )

let markClass = ''
for (let i = 0, code = 0; i < MARK_RANGES.length;) {
  markClass +=
    String.fromCharCode((code += parseInt(MARK_RANGES[i++], 36))) +
    '-' +
    String.fromCharCode((code += parseInt(MARK_RANGES[i++], 36)))
}

const COMBINING_MARKS_RE = new RegExp('[' + markClass + ']', 'g')

// String.prototype.normalize is ES2015 and the build targets ES2020, so the
// former `typeof normalize === 'function'` fallback was unreachable.
export const stripDiacritics = (str: string): string =>
  str
    .normalize('NFD')
    .replace(COMBINING_MARKS_RE, '')
    .replace(NON_DECOMPOSABLE_RE, (ch) => NON_DECOMPOSABLE_MAP[ch])
