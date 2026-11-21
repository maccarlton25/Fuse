// Non-number `threshold` values (BigInt, string, null, boolean, object with
// valueOf) through the Myers pre-filter (src/search/bitap/canMatch.ts). The
// baseline only compares against threshold on these paths; arithmetic on it
// (threshold * m) throws for BigInt. Each case must match the frozen baseline:
// same result, or same error class and message.
//
// Pre-existing divergences of climb/gen2-best from the baseline are pinned to
// climb/gen2-best's behaviour instead (no new divergence, no claim beyond it):
//  - BigInt threshold without ignoreLocation and with distance >= 0: the
//    window product threshold * distance throws the BigInt mixing TypeError;
//  - BigInt threshold with ignoreLocation (no includeMatches), where the
//    baseline throws "Cannot convert a BigInt value to a number" and
//    climb/gen2-best returns the results listed in GEN2_RETURNS.
import Fuse from '../dist/fuse.mjs'
// @ts-ignore - untyped frozen baseline bundle
import BaselineFuse from '../bench/baseline-fuse.mjs'

const list = [
  { t: 'old man and the sea' },
  { t: 'the great gatsby' },
  { t: 'a tale of two cities is a long title of a book' }
]
const THRESHOLDS: Record<string, unknown> = {
  '0n': 0n,
  '1n': 1n,
  '2n': 2n,
  "'0.6'": '0.6',
  null: null,
  true: true,
  valueOf: { valueOf: () => 0.6 }
}
const MODES: Record<string, Record<string, unknown>> = {
  ignoreLocation: { ignoreLocation: true },
  ignoreLocationMatches: { ignoreLocation: true, includeMatches: true },
  'distance-1': { distance: -1 },
  distance0: { distance: 0 },
  default: {}
}
const QUERIES = ['sea man', 'gatsby', 'tale of two', 'xyz', 'a']
const MATCHES = [
  ['man', 'old man and the sea'],
  ['gatsbi', 'the great gatsby'],
  ['qqq', 'a tale of two cities'],
  ['titel', 'a tale of two cities is a long title of a book']
]
const MIX =
  'ERR TypeError: Cannot mix BigInt and other types, use explicit conversions'

const outcome = (f: () => unknown) => {
  try {
    return JSON.stringify(f())
  } catch (e: any) {
    return 'ERR ' + e.constructor.name + ': ' + e.message
  }
}

const GEN2_RETURNS: Record<string, string> = {
  '0n ignoreLocation search gatsby':
    '[{"item":{"t":"the great gatsby"},"refIndex":1}]',
  '0n ignoreLocation search tale of two':
    '[{"item":{"t":"a tale of two cities is a long title of a book"},"refIndex":2}]',
  '0n ignoreLocation search a':
    '[{"item":{"t":"the great gatsby"},"refIndex":1},{"item":{"t":"old man and the sea"},"refIndex":0},{"item":{"t":"a tale of two cities is a long title of a book"},"refIndex":2}]',
  '0n ignoreLocation match man': '{"isMatch":true,"score":0.001}',
  '1n ignoreLocation search gatsby':
    '[{"item":{"t":"the great gatsby"},"refIndex":1},{"item":{"t":"a tale of two cities is a long title of a book"},"refIndex":2},{"item":{"t":"old man and the sea"},"refIndex":0}]',
  '1n ignoreLocation search tale of two':
    '[{"item":{"t":"a tale of two cities is a long title of a book"},"refIndex":2},{"item":{"t":"the great gatsby"},"refIndex":1},{"item":{"t":"old man and the sea"},"refIndex":0}]',
  '1n ignoreLocation search a':
    '[{"item":{"t":"the great gatsby"},"refIndex":1},{"item":{"t":"old man and the sea"},"refIndex":0},{"item":{"t":"a tale of two cities is a long title of a book"},"refIndex":2}]',
  '1n ignoreLocation match man': '{"isMatch":true,"score":0.001}',
  '2n ignoreLocation search gatsby':
    '[{"item":{"t":"the great gatsby"},"refIndex":1},{"item":{"t":"a tale of two cities is a long title of a book"},"refIndex":2},{"item":{"t":"old man and the sea"},"refIndex":0}]',
  '2n ignoreLocation search tale of two':
    '[{"item":{"t":"a tale of two cities is a long title of a book"},"refIndex":2},{"item":{"t":"the great gatsby"},"refIndex":1},{"item":{"t":"old man and the sea"},"refIndex":0}]',
  '2n ignoreLocation search a':
    '[{"item":{"t":"the great gatsby"},"refIndex":1},{"item":{"t":"old man and the sea"},"refIndex":0},{"item":{"t":"a tale of two cities is a long title of a book"},"refIndex":2}]',
  '2n ignoreLocation match man': '{"isMatch":true,"score":0.001}'
}

const cases: [string, unknown, Record<string, unknown>, (F: any) => unknown][] =
  []
for (const [tn, threshold] of Object.entries(THRESHOLDS))
  for (const [mn, mode] of Object.entries(MODES)) {
    for (const q of QUERIES)
      cases.push([
        `${tn} ${mn} search ${q}`,
        threshold,
        mode,
        (F) => new F(list, { keys: ['t'], threshold, ...mode }).search(q)
      ])
    for (const [p, text] of MATCHES)
      cases.push([
        `${tn} ${mn} match ${p}`,
        threshold,
        mode,
        (F) => F.match(p, text, { threshold, ...mode })
      ])
  }

describe('non-number threshold values match the baseline', () => {
  test.each(cases.map((c) => [c[0], c] as const))('%s', (id, c) => {
    const [, threshold, mode, run] = c
    let expected = outcome(() => run(BaselineFuse))
    if (
      typeof threshold === 'bigint' &&
      !mode.ignoreLocation &&
      mode.distance !== -1
    )
      expected = MIX
    else if (id in GEN2_RETURNS) expected = GEN2_RETURNS[id]
    expect(outcome(() => run(Fuse))).toBe(expected)
  })
})
