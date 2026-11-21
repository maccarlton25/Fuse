import type { RangeTuple } from '../../types'

export default function convertMaskToIndices(
  matchmask: ArrayLike<number>,
  minMatchCharLength: number
): RangeTuple[] {
  const indices: RangeTuple[] = []
  let start = -1

  // Runs past the end read as undefined (falsy), which closes the last run.
  for (let i = 0, len = matchmask.length; i <= len; i += 1) {
    if (matchmask[i]) {
      if (start < 0) start = i
    } else if (start >= 0) {
      if (i - start >= minMatchCharLength) {
        indices.push([start, i - 1])
      }
      start = -1
    }
  }

  return indices
}
