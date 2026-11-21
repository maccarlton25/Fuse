import Fuse from '../dist/fuse.mjs'
import BaselineFuse from '../bench/baseline-fuse.mjs'

// TokenSearch case-folds and strips diacritics once per text and hands the
// term searchers pre-normalised texts and patterns. Results must equal the
// baseline, where every term searcher normalised both itself.
const docs = [
  { title: 'Crème Brûlée Recipe', body: 'Łódź café naïve RÉSUMÉ' },
  { title: 'CAFE culture', body: 'resume writing, Cafe Society' },
  { title: 'İstanbul ΣΟΦΙΑ', body: 'straße STRASSE ǅungla' },
  { title: 'plain text', body: 'nothing special here' }
]
const keys = ['title', 'body']
const queries = [
  'cafe',
  'Café résumé',
  'CRÈME brulee',
  'lodz',
  'σοφια',
  'strasse'
]
const optionSets = [
  {},
  { isCaseSensitive: true },
  { ignoreDiacritics: true },
  { isCaseSensitive: true, ignoreDiacritics: true },
  { tokenMatch: 'all', includeMatches: true },
  { ignoreDiacritics: true, includeMatches: true, includeScore: true },
  // A tokenizer that returns tokens BitapSearch must still case-fold.
  { tokenize: (s) => s.toUpperCase().split(/\s+/).filter(Boolean) },
  { tokenize: (s) => s.toUpperCase().split(/\s+/), ignoreDiacritics: true }
]

describe('token search normalisation matches the baseline', () => {
  test.each(optionSets.map((o, i) => [i, o]))('options #%i', (_, extra) => {
    const options = { keys, useTokenSearch: true, includeScore: true, ...extra }
    const fuse = new Fuse(docs, options)
    const base = new BaselineFuse(docs, options)
    for (const q of queries) {
      expect(JSON.stringify(fuse.search(q))).toBe(
        JSON.stringify(base.search(q))
      )
    }
  })

  test('explicit undefined flags fall back to the defaults', () => {
    const options = {
      keys,
      useTokenSearch: true,
      includeScore: true,
      isCaseSensitive: undefined,
      ignoreDiacritics: undefined
    }
    const fuse = new Fuse(docs, options)
    const base = new BaselineFuse(docs, options)
    for (const q of queries) {
      expect(JSON.stringify(fuse.search(q))).toBe(
        JSON.stringify(base.search(q))
      )
    }
  })
})
