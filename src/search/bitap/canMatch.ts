// Sound reject filter for the bitap kernel. Myers' bit-vector algorithm, run
// right to left with the chunk's alphabet as Peq, yields the exact minimum edit
// count D(p) for an occurrence starting at each text position p. Bitap only
// accepts a hit at level i >= D(p) scoring <= threshold (positions past the
// text end only cost edits), so when no p passes with D(p) the kernel cannot
// match. Returns false only in that case; true is always a safe answer.
export default function canMatch(
  text: string,
  {
    pattern,
    alphabet,
    startIndex
  }: { pattern: string; alphabet: Record<string, number>; startIndex: number },
  {
    location,
    distance,
    threshold,
    ignoreLocation
  }: {
    location: number
    distance: number
    threshold: number
    ignoreLocation: boolean
  }
): boolean {
  let j = text.length
  const m = pattern.length
  const expected = Math.max(0, Math.min(location + startIndex, j))
  const last = 1 << (m - 1)
  let pv = -1
  let mv = 0
  let score = m
  while (j--) {
    const eq = alphabet[text[j]] | 0
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
    // Same formula as the kernel's calcScore.
    const proximity = Math.abs(expected - j)
    const accuracy = score / m
    if (
      (ignoreLocation
        ? accuracy
        : !distance
          ? proximity
            ? 1
            : accuracy
          : accuracy + proximity / distance) <= threshold
    ) {
      return true
    }
  }
  return false
}
