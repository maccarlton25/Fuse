import search, { type BitapChunk } from './search'
import canMatch from './canMatch'
import createPatternAlphabet from './createPatternAlphabet'
import { MAX_BITS } from './constants'
import { mergeIndices } from '../../helpers/mergeIndices'
import Config from '../../core/config'
import { stripDiacritics } from '../../helpers/diacritics'
import type { SearchResult, RangeTuple } from '../../types'

interface BitapOptions {
  location: number
  threshold: number
  distance: number
  includeMatches: boolean
  findAllMatches: boolean
  minMatchCharLength: number
  isCaseSensitive: boolean
  ignoreDiacritics: boolean
  ignoreLocation: boolean
}

export default class BitapSearch {
  options: BitapOptions
  pattern: string
  chunks: BitapChunk[]

  constructor(
    pattern: string,
    {
      location = Config.location,
      threshold = Config.threshold,
      distance = Config.distance,
      includeMatches = Config.includeMatches,
      findAllMatches = Config.findAllMatches,
      minMatchCharLength = Config.minMatchCharLength,
      isCaseSensitive = Config.isCaseSensitive,
      ignoreDiacritics = Config.ignoreDiacritics,
      ignoreLocation = Config.ignoreLocation
    } = {}
  ) {
    this.options = {
      location,
      threshold,
      distance,
      includeMatches,
      findAllMatches,
      minMatchCharLength,
      isCaseSensitive,
      ignoreDiacritics,
      ignoreLocation
    }

    pattern = isCaseSensitive ? pattern : pattern.toLowerCase()
    pattern = ignoreDiacritics ? stripDiacritics(pattern) : pattern
    this.pattern = pattern

    this.chunks = []

    // Chunks of MAX_BITS characters; a shorter tail chunk is taken as the last
    // MAX_BITS characters instead (overlapping the previous chunk).
    for (let i = 0, len = pattern.length; i < len; i += MAX_BITS) {
      const startIndex = Math.max(0, Math.min(i, len - MAX_BITS))
      const chunk = pattern.substr(startIndex, MAX_BITS)
      const alphabet = createPatternAlphabet(chunk)
      this.chunks.push({
        pattern: chunk,
        alphabet,
        // Masks of char codes below 256 (0 if absent) for the kernel.
        table: new Int32Array(256).map((_, code) => alphabet[code]),
        startIndex
      })
    }
  }

  searchIn(text: string): SearchResult {
    const {
      isCaseSensitive,
      ignoreDiacritics,
      includeMatches,
      location,
      ignoreLocation,
      minMatchCharLength
    } = this.options

    text = isCaseSensitive ? text : text.toLowerCase()
    text = ignoreDiacritics ? stripDiacritics(text) : text

    // Exact match
    if (this.pattern === text) {
      // The whole string is the match, so enforce minMatchCharLength here too,
      // mirroring convertMaskToIndices on the fuzzy path.
      return text.length < minMatchCharLength
        ? { isMatch: false, score: 1 }
        : includeMatches
          ? { isMatch: true, score: 0, indices: [[0, text.length - 1]] }
          : { isMatch: true, score: 0 }
    }

    // Otherwise, use Bitap algorithm

    // One Myers pass per chunk (./canMatch.ts). No chunk can match: skip the
    // kernel. With ignoreLocation and no indices needed (computeMatches false
    // in the kernel), the pass also yields each chunk's exact kernel score,
    // summed in chunk order like the kernel loop below.
    const direct =
      ignoreLocation && !includeMatches && !(minMatchCharLength > 1)
    let hasMatches = false
    let totalScore = 0
    for (const chunk of this.chunks) {
      const r = canMatch(text, chunk, this.options, !direct)
      if (r) {
        hasMatches = true
        if (!direct) break
      }
      totalScore += r ? Math.max(0.001, ~r / chunk.pattern.length) : 1
    }

    const allIndices: RangeTuple[] = []

    if (hasMatches && !direct) {
      hasMatches = false
      totalScore = 0
      for (const chunk of this.chunks) {
        const { isMatch, score, indices } = search(
          text,
          chunk,
          location + chunk.startIndex,
          this.options
        )

        if (isMatch) {
          hasMatches = true
        }

        totalScore += score

        if (isMatch && indices) {
          allIndices.push(...indices)
        }
      }
    }

    const result: SearchResult = {
      isMatch: hasMatches,
      score: hasMatches ? totalScore / this.chunks.length : 1
    }

    if (hasMatches && includeMatches) {
      result.indices = mergeIndices(allIndices)
    }

    return result
  }
}
