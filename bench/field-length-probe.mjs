#!/usr/bin/env node
/**
 * Off-benchmark regression guard for the hill-climb swarm.
 *
 * bench/hillclimb.mjs only exercises short fields (titles, tags, bodies of
 * 8-20 words). An optimization can win there and still lose badly on long
 * fields, where the baseline's location window keeps the scan short. This
 * probe times baseline vs candidate over a range of field lengths and search
 * modes, checks the results are byte-identical, and fails if the candidate is
 * slower than the baseline anywhere.
 *
 * Usage:
 *   npm run build && node bench/field-length-probe.mjs
 *   node bench/field-length-probe.mjs --max-slowdown 1.25 --rounds 7
 *   node bench/field-length-probe.mjs --candidate ./some/other/fuse.mjs
 *
 * Exit code 0 = no cell slower than --max-slowdown (default 1.25, generous
 * because short cells are noisy) and all results identical; 1 otherwise.
 * First found by the gen 1 holdout review of climb/gen1-prefilter.
 *
 * rev 2 adds the "lone hit" modes, from the second review of that branch: one
 * exact copy of the query at the start of an otherwise non-matching field,
 * searched with a wide location window (distance 100000). The baseline's
 * indexOf pre-pass settles such a field almost at once, so anything that
 * walks the window first (a reject filter, say) is many times slower there
 * while every other cell still passes. Cells whose baseline run is under
 * 3 ms are repeated until it is not, so these very fast cells can be timed.
 */

import path from 'node:path'
import { pathToFileURL } from 'node:url'
import BaselineFuse from './baseline-fuse.mjs'

const args = process.argv.slice(2)
const flag = (name, dflt) => {
  const i = args.indexOf(name)
  return i >= 0 && args[i + 1] ? args[i + 1] : dflt
}
const MAX_SLOWDOWN = Number(flag('--max-slowdown', 1.25))
const ROUNDS = Number(flag('--rounds', 5))
const candidatePath = flag('--candidate', '../dist/fuse.mjs')
const candidateUrl = candidatePath.startsWith('.')
  ? new URL(candidatePath, import.meta.url).href
  : pathToFileURL(path.resolve(candidatePath)).href
const CandidateFuse = (await import(candidateUrl)).default

const WORDS =
  'lorem ipsum dolor sit amet consectetur adipiscing elit sed do eiusmod tempor incididunt ut labore et dolore magna aliqua'.split(
    ' '
  )
let state = 1
const rnd = () => (state = (state * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff

function makeDocs(fieldLen, count) {
  const docs = []
  for (let d = 0; d < count; d++) {
    let text = ''
    while (text.length < fieldLen) text += WORDS[Math.floor(rnd() * WORDS.length)] + ' '
    docs.push({ body: text.slice(0, fieldLen) })
  }
  return docs
}

// One exact hit at the very start; the filler cannot match the query even
// fuzzily, so the hit is the only thing the window contains.
function makeLoneHitDocs(fieldLen, count) {
  const docs = []
  for (let d = 0; d < count; d++) {
    let text = 'zyzzyva '
    while (text.length < fieldLen) text += WORDS[Math.floor(rnd() * WORDS.length)] + ' '
    docs.push({ body: text.slice(0, Math.max(fieldLen, 8)) })
  }
  return docs
}

// Hits near the start, hits only deep in the field, near-misses and non-matches.
const QUERIES = ['tempor', 'magnx', 'xqzvw', 'consectetur', 'dolore magna', 'adipiscng elit']
const MODES = [
  ['default', {}, QUERIES],
  ['includeMatches', { includeMatches: true }, QUERIES],
  ['distance 1000', { distance: 1000 }, QUERIES],
  ['ignoreLocation', { ignoreLocation: true }, QUERIES],
  ['token', { useTokenSearch: true }, ['tempor', 'dolore magna', 'adipiscng xqzvw']],
  ['extended', { useExtendedSearch: true }, ['tempor !xqzvw', "'magna consectetr", '^lorem | aliqua$']],
  ['lone hit dflt', {}, ['zyzzyva'], makeLoneHitDocs],
  ['lone hit', { distance: 100000 }, ['zyzzyva'], makeLoneHitDocs],
  ['lone hit+match', { distance: 100000, includeMatches: true }, ['zyzzyva'], makeLoneHitDocs]
]
// Total text per cell is held near 200k characters so every cell takes a
// comparable, measurable time.
const LENGTHS = [40, 200, 1000, 5000, 25000]

const median = (xs) => xs.slice().sort((a, b) => a - b)[Math.floor(xs.length / 2)]

let failed = false
console.log(`field-length probe rev=2: candidate=${candidatePath} rounds=${ROUNDS} max-slowdown=${MAX_SLOWDOWN}`)
console.log('mode            fieldLen   docs  baseline ms  candidate ms  cand/base')
for (const [label, opts, queries, make = makeDocs] of MODES) {
  for (const len of LENGTHS) {
    const docs = make(len, Math.max(8, Math.round(200000 / len)))
    const options = { keys: ['body'], includeScore: true, ...opts }
    const base = new BaselineFuse(docs, options)
    const cand = new CandidateFuse(docs, options)
    let same = true
    for (const q of queries) {
      if (JSON.stringify(base.search(q)) !== JSON.stringify(cand.search(q))) same = false
    }
    let reps = 1
    const run = (fuse) => {
      const t = performance.now()
      for (let i = 0; i < reps; i++) for (const q of queries) fuse.search(q)
      return performance.now() - t
    }
    run(cand)
    for (let i = 0; i < 3; i++) reps = Math.min(5000, Math.max(reps, Math.ceil((reps * 3) / run(base))))
    const bt = []
    const ct = []
    for (let r = 0; r < ROUNDS; r++) {
      if (r % 2) {
        ct.push(run(cand))
        bt.push(run(base))
      } else {
        bt.push(run(base))
        ct.push(run(cand))
      }
    }
    const b = median(bt) / reps
    const c = median(ct) / reps
    const ratio = c / b
    const bad = !same || ratio > MAX_SLOWDOWN
    if (bad) failed = true
    console.log(
      `${label.padEnd(15)} ${String(len).padStart(8)} ${String(docs.length).padStart(6)} ${b.toFixed(3).padStart(12)} ${c.toFixed(3).padStart(13)} ${ratio.toFixed(2).padStart(10)}${same ? '' : '  RESULT MISMATCH'}${ratio > MAX_SLOWDOWN ? '  SLOWER' : ''}`
    )
  }
}
console.log(failed ? 'FIELD_LENGTH_PROBE_FAIL' : 'FIELD_LENGTH_PROBE_OK')
process.exit(failed ? 1 : 0)
