import get from '../helpers/get'
import type { IFuseOptions } from '../types'

// One literal, in the order the former Basic/Match/Fuzzy/Advanced option
// groups were spread, so `Object.keys(Fuse.config)` is unchanged.
const Config: Required<IFuseOptions<any>> = Object.freeze({
  // Basic options
  isCaseSensitive: false,
  ignoreDiacritics: false,
  includeScore: false,
  keys: [] as any[],
  shouldSort: true,
  sortFn: (
    a: { score: number; idx: number },
    b: { score: number; idx: number }
  ): number =>
    a.score === b.score ? (a.idx < b.idx ? -1 : 1) : a.score < b.score ? -1 : 1,
  // Match options
  includeMatches: false,
  findAllMatches: false,
  minMatchCharLength: 1,
  // Fuzzy options
  location: 0,
  threshold: 0.6,
  distance: 100,
  // Advanced options
  useExtendedSearch: false,
  useTokenSearch: false,
  tokenize: undefined as IFuseOptions<any>['tokenize'],
  tokenMatch: 'any' as 'all' | 'any',
  getFn: get as any,
  ignoreLocation: false,
  ignoreFieldNorm: false,
  fieldNormWeight: 1
}) as Required<IFuseOptions<any>>

export default Config
