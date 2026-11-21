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

    if (!this.pattern.length) {
      return
    }

    const addChunk = (pattern: string, startIndex: number): void => {
      const alphabet = createPatternAlphabet(pattern)
      this.chunks.push({
        pattern,
        alphabet,
        // Masks of char codes below 256 (0 if absent) for the kernel.
        table: new Int32Array(256).map((_, code) => alphabet[code]),
        startIndex
      })
    }

    const len = this.pattern.length

    if (len > MAX_BITS) {
      let i = 0
      const remainder = len % MAX_BITS
      const end = len - remainder

      while (i < end) {
        addChunk(this.pattern.substr(i, MAX_BITS), i)
        i += MAX_BITS
      }

      if (remainder) {
        const startIndex = len - MAX_BITS
        addChunk(this.pattern.substr(startIndex), startIndex)
      }
    } else {
      addChunk(this.pattern, 0)
    }
  }

  searchIn(text: string): SearchResult {
    const { isCaseSensitive, ignoreDiacritics, includeMatches } = this.options

    text = isCaseSensitive ? text : text.toLowerCase()
    text = ignoreDiacritics ? stripDiacritics(text) : text

    // Exact match
    if (this.pattern === text) {
      // The whole string is the match, so enforce minMatchCharLength here too,
      // mirroring convertMaskToIndices on the fuzzy path.
      if (text.length < this.options.minMatchCharLength) {
        return { isMatch: false, score: 1 }
      }

      const result: SearchResult = {
        isMatch: true,
        score: 0
      }

      if (includeMatches) {
        result.indices = [[0, text.length - 1]]
      }

      return result
    }

    // Otherwise, use Bitap algorithm
    const { location, ignoreLocation, minMatchCharLength } = this.options

    // One Myers pass per chunk (./canMatch.ts). No chunk can match: skip the
    // kernel. With ignoreLocation and no indices needed (computeMatches false
    // in the kernel), the pass also yields each chunk's exact kernel score.
    const direct =
      ignoreLocation && !includeMatches && !(minMatchCharLength > 1)
    const chunks = this.chunks
    let any = false
    let directScore = 0
    for (const chunk of chunks) {
      const r = canMatch(text, chunk, this.options)
      if (r) {
        any = true
        if (!direct) break
        directScore += Math.max(0.001, ~r / chunk.pattern.length)
      } else {
        directScore += 1
      }
    }
    if (!any) {
      return { isMatch: false, score: 1 }
    }
    if (direct) {
      return { isMatch: true, score: directScore / chunks.length }
    }

    const allIndices: RangeTuple[] = []
    let totalScore = 0
    let hasMatches = false

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
