import convertMaskToIndices from './convertMaskToIndices'
import type { SearchResult } from '../../types'

export interface BitapChunk {
  pattern: string
  alphabet: Record<number, number>
  table: Int32Array
  startIndex: number
}

export interface KernelOptions {
  distance: number
  threshold: number
  findAllMatches: boolean
  minMatchCharLength: number
  includeMatches: boolean
  ignoreLocation: boolean
}

// Scratch buffers reused across calls and grown on demand: two bit arrays
// swapped per error level, and the alphabet mask of each scanned position.
let bufA = new Int32Array(256)
let bufB = new Int32Array(256)
let charBuf = new Int32Array(256)

// Score of a match with `errors` errors at `loc` (see ./computeScore.ts).
// A top-level function keeps the kernel's locals out of a closure context.
const calcScore = (
  errors: number,
  loc: number,
  patternLen: number,
  expectedLocation: number,
  distance: number,
  ignoreLocation: boolean
): number => {
  const accuracy = errors / patternLen
  if (ignoreLocation) return accuracy
  const proximity = Math.abs(expectedLocation - loc)
  if (!distance) return proximity ? 1.0 : accuracy
  return accuracy + proximity / distance
}

export default function search(
  text: string,
  { pattern, alphabet: patternAlphabet, table }: BitapChunk,
  location: number,
  {
    distance,
    threshold,
    findAllMatches,
    minMatchCharLength,
    includeMatches,
    ignoreLocation
  }: KernelOptions
): SearchResult {
  const patternLen = pattern.length
  // Set starting location at beginning text and initialize the alphabet.
  const textLen = text.length
  // Handle the case when location > text.length
  const expectedLocation = Math.max(0, Math.min(location, textLen))
  // Highest score beyond which we give up.
  let currentThreshold = threshold
  // Is there a nearby exact match? (speedup)
  let bestLocation = expectedLocation

  // Performance: only computer matches when the minMatchCharLength > 1
  // OR if `includeMatches` is true.
  const computeMatches = minMatchCharLength > 1 || includeMatches
  // A mask of the matches, used for building the indices
  const matchMask = new Uint8Array(computeMatches ? textLen : 0)

  let index: number

  // Get all exact matches, here for speed up
  while ((index = text.indexOf(pattern, bestLocation)) > -1) {
    const score = calcScore(
      0,
      index,
      patternLen,
      expectedLocation,
      distance,
      ignoreLocation
    )

    currentThreshold = Math.min(score, currentThreshold)
    bestLocation = index + patternLen

    if (computeMatches) {
      matchMask.fill(1, index, bestLocation)
    }
  }

  // Reset the best location
  bestLocation = -1

  let bitArr = bufA
  let lastBitArr = bufB
  let cm = charBuf
  let low = 1
  let finalScore = 1
  let bestErrors = 0
  let binMax = patternLen + textLen

  const mask = 1 << (patternLen - 1)

  for (let i = 0; i < patternLen; i += 1) {
    // Scan for the best match; each iteration allows for one more error.
    // Run a binary search to determine how far from the match location we can stray
    // at this error level.
    let binMin = 0
    let binMid = binMax

    while (binMin < binMid) {
      const score = calcScore(
        i,
        expectedLocation + binMid,
        patternLen,
        expectedLocation,
        distance,
        ignoreLocation
      )

      if (score <= currentThreshold) {
        binMin = binMid
      } else {
        binMax = binMid
      }

      binMid = Math.floor((binMax - binMin) / 2 + binMin)
    }

    // Use the result from this iteration as the maximum for the next.
    binMax = binMid

    let start = Math.max(1, expectedLocation - binMid + 1)
    const finish = findAllMatches
      ? textLen
      : Math.min(expectedLocation + binMid, textLen) + patternLen

    if (!i) {
      // Level 0 has the widest window. `start` may later drop to
      // 2 * expectedLocation - bestLocation with bestLocation < finish, so no
      // level scans below `low`. Resolve the alphabet mask of every position
      // in [low, finish] once (text[k] is undefined, so 0, past the end).
      low = Math.max(1, Math.min(start, 2 * expectedLocation - finish + 1))
      if (bitArr.length < finish + 2) {
        bitArr = bufA = new Int32Array(finish * 2 + 4)
        lastBitArr = bufB = new Int32Array(finish * 2 + 4)
        cm = charBuf = new Int32Array(finish * 2 + 4)
      }
      for (let k = low; k <= finish; k += 1) {
        cm[k] =
          k > textLen
            ? 0
            : (table[text.charCodeAt(k - 1)] ??
              patternAlphabet[text.charCodeAt(k - 1)] | 0)
      }
    }

    // Initialize the bit array
    bitArr[finish + 1] = (1 << i) - 1

    let j = finish
    for (; j >= start; j -= 1) {
      // First pass: exact match
      let bits = ((bitArr[j + 1] << 1) | 1) & cm[j]

      // Subsequent passes: fuzzy match
      if (i) {
        bits |=
          ((lastBitArr[j + 1] | lastBitArr[j]) << 1) | 1 | lastBitArr[j + 1]
      }

      bitArr[j] = bits

      if (bits & mask) {
        finalScore = calcScore(
          i,
          j - 1,
          patternLen,
          expectedLocation,
          distance,
          ignoreLocation
        )

        // This match will almost certainly be better than any existing match.
        // But check anyway.
        if (finalScore <= currentThreshold) {
          // Indeed it is
          currentThreshold = finalScore
          bestLocation = j - 1
          bestErrors = i

          // Already passed `loc`, downhill from here on in.
          if (bestLocation <= expectedLocation) {
            j -= 1
            break
          }

          // When passing `bestLocation`, don't exceed our current distance from `expectedLocation`.
          start = Math.max(1, 2 * expectedLocation - bestLocation)
        }
      }
    }

    // No hope for a (better) match at greater error levels. This is
    // calcScore(i + 1, expectedLocation): proximity is 0, so it is the accuracy.
    if ((i + 1) / patternLen > currentThreshold) {
      break
    }

    // [low, j] was not written at this level and must read as 0 at the next.
    bitArr.fill(0, low, j + 1)

    const tmp = lastBitArr
    lastBitArr = bitArr
    bitArr = tmp
  }

  // Fill matchMask across the matched window only. Bitap anchors a match at
  // bestLocation (the start), spanning patternLen characters plus up to
  // bestErrors extra characters when errors are text-side insertions. Marking
  // alphabet positions in that window keeps the highlight indices honest about
  // what actually matched, instead of every pattern-alphabet character the
  // scan happened to visit.
  if (computeMatches && bestLocation >= 0) {
    const matchEnd = Math.min(
      textLen - 1,
      bestLocation + patternLen - 1 + bestErrors
    )
    for (let k = bestLocation; k <= matchEnd; k += 1) {
      if (patternAlphabet[text.charCodeAt(k)]) {
        matchMask[k] = 1
      }
    }
  }

  const result: SearchResult = {
    isMatch: bestLocation >= 0,
    // Count exact matches (those with a score of 0) to be "almost" exact
    score: Math.max(0.001, finalScore)
  }

  if (computeMatches) {
    const indices = convertMaskToIndices(matchMask, minMatchCharLength)
    if (!indices.length) {
      result.isMatch = false
    } else if (includeMatches) {
      result.indices = indices
    }
  }

  return result
}
