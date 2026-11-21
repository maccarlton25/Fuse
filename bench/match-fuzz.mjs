#!/usr/bin/env node
/**
 * Kernel-level differential fuzzer for the hill-climb swarm.
 *
 * bench/parity-fuzz.mjs exercises whole searches; this one hammers the single
 * pattern-vs-text path (`Fuse.match`) where the bitap kernel, its reject
 * filter and its direct-answer shortcuts live. It compares the candidate with
 * bench/baseline-fuse.mjs, byte-exact, on near-miss texts (the pattern with a
 * few random edits, planted at varying offsets in filler) under option values
 * chosen to sit on the edges: window bounds, 32-character chunk boundaries,
 * and numeric options that are legal to pass but unusual (negative, huge,
 * fractional, NaN, infinite).
 *
 * Outcomes per case:
 *   identical                      ok
 *   both return, results differ    MISMATCH            -> fail
 *   only the candidate throws      CAND_THROWS_ONLY    -> fail
 *   only the baseline throws       counted, not a failure. The baseline sizes
 *                                  an array from `location`, so NaN and some
 *                                  fractional values make it throw RangeError;
 *                                  the swarm does not reproduce those crashes.
 *
 * Usage:
 *   npm run build && node bench/match-fuzz.mjs
 *   node bench/match-fuzz.mjs --iters 400000 --seed 9
 *   node bench/match-fuzz.mjs --candidate ./some/other/fuse.mjs
 *
 * Added after generation 1: a fractional `location` with `findAllMatches`
 * made the generation 1 kernel return a wrong score where the baseline
 * returns a valid one, and neither the whole-search fuzzer nor two smaller
 * ad hoc checks caught it.
 */

import path from 'node:path'
import { pathToFileURL } from 'node:url'
import BaselineFuse from './baseline-fuse.mjs'

const args = process.argv.slice(2)
const flag = (name, dflt) => {
  const i = args.indexOf(name)
  return i >= 0 && args[i + 1] ? args[i + 1] : dflt
}
const ITERS = Number(flag('--iters', 150000))
let seed = Number(flag('--seed', 1)) >>> 0
const candidatePath = flag('--candidate', '../dist/fuse.mjs')
const candidateUrl = candidatePath.startsWith('.')
  ? new URL(candidatePath, import.meta.url).href
  : pathToFileURL(path.resolve(candidatePath)).href
const CandidateFuse = (await import(candidateUrl)).default

const rnd = () => {
  seed = (seed + 0x6d2b79f5) >>> 0
  let t = seed
  t = Math.imul(t ^ (t >>> 15), t | 1)
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296
}
const ri = (n) => Math.floor(rnd() * n)
const pick = (a) => a[ri(a.length)]

const ALPHABETS = [
  'ab', 'abc', 'a', 'abcdefghijklmnopqrstuvwxyz', 'aAbB', 'éeèêaàäöoüu', 'ab ',
  '日本語中文', 'xyz01 -_', 'ÀÉÎÕÜçñ', 'ałß😀b'
].map((s) => Array.from(s))
const PATTERN_LENGTHS = [1, 1, 2, 2, 3, 4, 5, 6, 7, 8, 10, 12, 16, 31, 32, 33, 40, 63, 64, 65, 70, 96, 100]

const randStr = (alpha, n) => {
  let s = ''
  for (let i = 0; i < n; i++) s += alpha[ri(alpha.length)]
  return s
}
function mutate(pattern, alpha, edits) {
  const s = pattern.split('')
  for (let e = 0; e < edits; e++) {
    const op = ri(4)
    const pos = ri(s.length + 1)
    if (op === 0 && s.length) s.splice(Math.min(pos, s.length - 1), 1)
    else if (op === 1) s.splice(pos, 0, alpha[ri(alpha.length)])
    else if (op === 2 && s.length) s[Math.min(pos, s.length - 1)] = alpha[ri(alpha.length)]
    else if (op === 3 && s.length > 1) {
      const i = Math.min(pos, s.length - 2)
      const t = s[i]
      s[i] = s[i + 1]
      s[i + 1] = t
    }
  }
  return s.join('')
}

function makeCase() {
  const alpha = pick(ALPHABETS)
  const plen = pick(PATTERN_LENGTHS)
  const pattern = rnd() < 0.15 ? randStr(alpha, 1).repeat(plen) : randStr(alpha, plen)
  const filler = rnd() < 0.7 ? alpha : pick(ALPHABETS)
  let text
  const kind = ri(10)
  if (kind === 0) text = ''
  else if (kind === 1) text = randStr(filler, 1)
  else if (kind === 2) text = randStr(filler, ri(80))
  else {
    const edits = ri(plen + 1) <= plen / 2 ? ri(Math.ceil(plen / 2) + 1) : ri(plen + 1)
    text =
      randStr(filler, pick([0, 0, 1, 2, 5, 10, 30, 60, 100, 150, 300, 2000])) +
      mutate(pattern, alpha, edits) +
      randStr(filler, pick([0, 0, 1, 3, 10, 40, 120, 800]))
    if (rnd() < 0.1) text += mutate(pattern, alpha, ri(3))
  }
  if (rnd() < 0.2) text = text.toUpperCase()
  const len = text.length
  const opts = {}
  if (rnd() < 0.8) {
    opts.threshold = pick([0, 0, 0.001, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.6, 0.7, 0.8, 0.9, 0.99, 1, 1.5, -0.1, NaN, Infinity, -Infinity])
  }
  if (rnd() < 0.7) {
    opts.distance = pick([0, 0, 1, 1, 2, 5, 10, 100, 100, 1000, 1e9, 1e12, 0.5, -1, -100, NaN, Infinity, -Infinity])
  }
  if (rnd() < 0.7) {
    opts.location = pick([0, 0, 1, 3, 10, 50, 100, 200, len, len + 1, len + 50, 1e6, -5, 0.5, 2.5, 7.25, len - 0.5, -1.5, NaN, Infinity, -Infinity])
  }
  if (rnd() < 0.3) opts.ignoreLocation = true
  if (rnd() < 0.3) opts.findAllMatches = true
  if (rnd() < 0.3) opts.minMatchCharLength = pick([2, 3, 4, 8, 40])
  if (rnd() < 0.4) opts.includeMatches = true
  if (rnd() < 0.3) opts.isCaseSensitive = true
  if (rnd() < 0.3) opts.ignoreDiacritics = true
  if (rnd() < 0.05) opts.useExtendedSearch = true
  return { pattern, text, opts }
}

// NaN and infinities do not survive JSON; print options in a form that does.
const show = (v) =>
  JSON.stringify(v, (k, x) => (typeof x === 'number' && !Number.isFinite(x) ? String(x) : x))
const run = (Fuse, c) => {
  try {
    return show(Fuse.match(c.pattern, c.text, c.opts))
  } catch (err) {
    return 'THROW:' + (err && err.message)
  }
}

let mismatches = 0
let candThrowsOnly = 0
let baseThrowsOnly = 0
let matches = 0
const firstSeed = Number(flag('--seed', 1))
for (let it = 0; it < ITERS; it++) {
  const c = makeCase()
  const a = run(CandidateFuse, c)
  const b = run(BaselineFuse, c)
  if (b.includes('"isMatch":true')) matches++
  if (a === b) continue
  const repro = show({ pattern: c.pattern, text: c.text.length > 300 ? c.text.slice(0, 300) + '…(' + c.text.length + ' chars)' : c.text, opts: c.opts })
  if (b.startsWith('THROW:') && !a.startsWith('THROW:')) {
    baseThrowsOnly++
  } else if (a.startsWith('THROW:') && !b.startsWith('THROW:')) {
    if (++candThrowsOnly <= 3) console.error(`CAND_THROWS_ONLY case ${it}: ${repro}\n  candidate ${a}\n  baseline  ${b}`)
  } else {
    if (++mismatches <= 5) console.error(`MISMATCH case ${it}: ${repro}\n  candidate ${a}\n  baseline  ${b}`)
  }
}
const failed = mismatches > 0 || candThrowsOnly > 0
console.log(
  `${failed ? 'MATCH_FUZZ_FAIL' : 'MATCH_FUZZ_OK'} cases=${ITERS} seed=${firstSeed} mismatches=${mismatches} candThrowsOnly=${candThrowsOnly} baseThrowsOnly=${baseThrowsOnly} baselineMatchRate=${(matches / ITERS).toFixed(3)} candidate=${candidatePath}`
)
process.exit(failed ? 1 : 0)
