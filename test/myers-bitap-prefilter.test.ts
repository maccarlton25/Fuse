import { describe, expect, test } from 'vitest'
import Fuse from '../dist/fuse.mjs'
import BitapSearch from '../src/search/bitap'
import canMatch from '../src/search/bitap/canMatch'
import search from '../src/search/bitap/search'
import { stripDiacritics } from '../src/helpers/diacritics'

describe('Myers bit-vector prefilter & search path optimizations', () => {
  test('canMatch never falsely rejects a chunk accepted by the Bitap kernel', () => {
    const patterns = [
      'apple',
      'javascrpt',
      'café',
      'a',
      '0123456789abcdef0123456789abcdef'
    ]
    const texts = [
      '',
      'a',
      'apple',
      'applx',
      'prefix javascript optimization suffix',
      'x'.repeat(240) + 'apple' + 'y'.repeat(240),
      'completely unrelated words without hits'
    ]
    const optionSets = [
      { location: 0, distance: 100, threshold: 0.6, ignoreLocation: false },
      { location: 0, distance: 100, threshold: 0.2, ignoreLocation: false },
      { location: 40, distance: 10, threshold: 0.4, ignoreLocation: false },
      { location: 0, distance: 1000, threshold: 0.5, ignoreLocation: false },
      { location: 0, distance: 100, threshold: 0.6, ignoreLocation: true }
    ]

    for (const pattern of patterns) {
      const bitap = new BitapSearch(pattern, { isCaseSensitive: true })
      const chunk = bitap.chunks[0]
      for (const opts of optionSets) {
        for (const text of texts) {
          const filterRes = canMatch(text, chunk, opts)
          const kernelRes = search(text, chunk, opts.location, {
            ...opts,
            findAllMatches: false,
            minMatchCharLength: 1,
            includeMatches: false
          })

          if (filterRes === 0) {
            expect(kernelRes.isMatch).toBe(false)
          }
          if (opts.ignoreLocation && filterRes !== 0) {
            const directScore = Math.max(
              0.001,
              ~filterRes / chunk.pattern.length
            )
            expect(kernelRes.isMatch).toBe(true)
            expect(directScore).toBeCloseTo(kernelRes.score, 12)
          }
        }
      }
    }
  })

  test('direct ignoreLocation path matches includeMatches score across multi-chunk (>32 char) queries', () => {
    const docs = [
      {
        title:
          'distributed sandbox orchestration with durable workflow queues and typed buffers'
      },
      {
        title:
          'distributed sandbx orchestraton with durable workflow queues and typed buffers'
      },
      { title: 'unrelated short note' }
    ]
    const longQuery = 'distributed sandbox orchestration with durable'

    const withoutMatches = new Fuse(docs, {
      keys: ['title'],
      includeScore: true,
      ignoreLocation: true,
      includeMatches: false
    }).search(longQuery)

    const withMatches = new Fuse(docs, {
      keys: ['title'],
      includeScore: true,
      ignoreLocation: true,
      includeMatches: true
    }).search(longQuery)

    expect(withoutMatches.map((r) => r.refIndex)).toEqual(
      withMatches.map((r) => r.refIndex)
    )
    for (let i = 0; i < withoutMatches.length; i++) {
      expect(withoutMatches[i].score).toBeCloseTo(withMatches[i].score!, 12)
    }
  })

  test('wide distance window with lone exact hit fast-paths cleanly', () => {
    const text = 'needle' + ' padding '.repeat(400)
    const fuse = new Fuse([text], {
      includeScore: true,
      ignoreFieldNorm: true,
      distance: 2000,
      threshold: 0.4
    })
    const res = fuse.search('needle')
    expect(res).toHaveLength(1)
    expect(res[0].score).toBeCloseTo(0.001, 10)
  })

  test('stripDiacritics handles combining marks, non-decomposable ligatures, and non-Latin scripts', () => {
    expect(stripDiacritics('Crème Brûlée & Café')).toBe('Creme Brulee & Cafe')
    expect(stripDiacritics('Łódź straße Søren Đặng')).toBe(
      'Lodz strasse Soren Dang'
    )
    expect(stripDiacritics('日本語 😀 plain ascii')).toBe(
      '日本語 😀 plain ascii'
    )
  })

  test('TokenSearch single-pass normalization preserves any and all tokenMatch behavior', () => {
    const docs = [
      { title: 'Crème Brûlée Torch', tags: ['kitchen', 'culinary'] },
      { title: 'Café Espresso Machine', tags: ['coffee', 'kitchen'] },
      { title: 'Studio Monitor Speaker', tags: ['audio'] }
    ]
    const fuseAny = new Fuse(docs, {
      keys: ['title', 'tags'],
      useTokenSearch: true,
      ignoreDiacritics: true,
      threshold: 0.3,
      includeScore: true
    })
    const fuseAll = new Fuse(docs, {
      keys: ['title', 'tags'],
      useTokenSearch: true,
      tokenMatch: 'all',
      ignoreDiacritics: true,
      threshold: 0.3,
      includeScore: true
    })

    expect(fuseAny.search('creme kitchen').map((r) => r.refIndex)).toEqual([
      0, 1
    ])
    expect(fuseAll.search('creme kitchen').map((r) => r.refIndex)).toEqual([0])
  })

  test('sparse records in parsed index and logical AND fuzzy queries remain isolated', () => {
    const docs = [
      { title: 'alpha beta', tag: 'one' },
      { title: 'alpha gamma', tag: 'two' },
      { title: 'delta epsilon', tag: 'one' }
    ]
    const idxJson = Fuse.createIndex(['title', 'tag'], docs).toJSON()
    // Simulate a sparse hole in records array
    delete (idxJson.records as any[])[1]
    const parsed = Fuse.parseIndex(idxJson)
    const fuseSparse = new Fuse(docs, { keys: ['title', 'tag'] }, parsed)
    expect(fuseSparse.search('alpha').map((r) => r.refIndex)).toEqual([0])

    const fuseExtended = new Fuse(docs, {
      keys: ['title', 'tag'],
      useExtendedSearch: true,
      includeMatches: true,
      includeScore: true
    })
    const res = fuseExtended.search({
      $and: [{ title: 'alph' }, { tag: 'one' }]
    })
    expect(res).toHaveLength(1)
    expect(res[0].refIndex).toBe(0)
    expect(res[0].matches).toHaveLength(2)
  })

  test('untyped JS inputs (BigInt numeric options and non-string Fuse.match inputs) do not throw unexpectedly', () => {
    const fuse = new Fuse([{ t: 'sea man' }, { t: 'land' }], {
      keys: ['t'],
      // @ts-expect-error untyped JS caller passing BigInt
      threshold: 0n,
      // @ts-expect-error untyped JS caller passing BigInt
      distance: 100n
    })
    expect(fuse.search('sea man')).toHaveLength(1)

    // @ts-expect-error untyped JS caller passing char array
    expect(
      Fuse.match('abc', ['a', 'b', 'c'], { isCaseSensitive: true }).isMatch
    ).toBe(true)
    // @ts-expect-error untyped JS caller passing number
    expect(Fuse.match('abc', 42 as any)).toEqual({ isMatch: false, score: 1 })
  })
})
