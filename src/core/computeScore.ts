import Config from './config'
import type { InternalResult, MatchScore } from '../types'

export function computeScoreSingle(
  matches: MatchScore[],
  { ignoreFieldNorm = Config.ignoreFieldNorm }
): number {
  let totalScore = 1

  for (const { key, norm, score } of matches) {
    const weight = key ? key.weight : null

    totalScore *= Math.pow(
      score === 0 && weight ? Number.EPSILON : score,
      (weight || 1) * (ignoreFieldNorm ? 1 : norm)
    )
  }

  return totalScore
}

export default function computeScore(
  results: InternalResult[],
  options: { ignoreFieldNorm?: boolean }
): void {
  for (const result of results) {
    result.score = computeScoreSingle(result.matches, options)
  }
}
