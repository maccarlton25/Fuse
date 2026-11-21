#!/usr/bin/env node
/**
 * Memory-retention guard for the hill-climb swarm.
 *
 * Reused scratch buffers and memo tables make the verifier faster, but if they
 * are sized by the input and never released, a single search over a large
 * text pins that memory for the life of the process. The verifier cannot see
 * this. This probe searches a few very long texts in the modes that scan the
 * whole text, drops every reference, forces a GC, and compares what the
 * candidate still holds with what the baseline holds.
 *
 * Usage:
 *   npm run build && node --expose-gc bench/retention-probe.mjs
 *   node --expose-gc bench/retention-probe.mjs --max-retained-mb 4 --chars 5000000
 *   node --expose-gc bench/retention-probe.mjs --candidate ./some/other/fuse.mjs
 *
 * Exit code 0 = candidate retains at most --max-retained-mb (default 4) more
 * than the baseline in both heap and ArrayBuffer memory; 1 otherwise; 2 if
 * run without --expose-gc. First found by the gen 1 holdout review of
 * climb/gen1-bitap.
 */

import path from 'node:path'
import { pathToFileURL } from 'node:url'
import BaselineFuse from './baseline-fuse.mjs'

if (typeof globalThis.gc !== 'function') {
  console.error('retention-probe: run with `node --expose-gc`')
  process.exit(2)
}

const args = process.argv.slice(2)
const flag = (name, dflt) => {
  const i = args.indexOf(name)
  return i >= 0 && args[i + 1] ? args[i + 1] : dflt
}
const MAX_MB = Number(flag('--max-retained-mb', 4))
const CHARS = Number(flag('--chars', 5_000_000))
const candidatePath = flag('--candidate', '../dist/fuse.mjs')
const candidateUrl = candidatePath.startsWith('.')
  ? new URL(candidatePath, import.meta.url).href
  : pathToFileURL(path.resolve(candidatePath)).href
const CandidateFuse = (await import(candidateUrl)).default

const WORDS = 'lorem ipsum dolor sit amet consectetur adipiscing elit sed do eiusmod tempor'.split(' ')
function longText(chars) {
  const parts = []
  let len = 0
  let i = 0
  while (len < chars) {
    const w = WORDS[(i * 7 + (i >> 3)) % WORDS.length]
    parts.push(w)
    len += w.length + 1
    i++
  }
  return parts.join(' ')
}

const MODES = [
  ['ignoreLocation', { ignoreLocation: true }, 'consectetr'],
  ['ignoreLocation+matches', { ignoreLocation: true, includeMatches: true }, 'adipiscng'],
  ['findAllMatches+matches', { findAllMatches: true, includeMatches: true }, 'lorem ipsm'],
  ['token', { useTokenSearch: true }, 'tempor eiusmd'],
  ['extended', { useExtendedSearch: true, ignoreLocation: true }, "'dolor consectetr"]
]

const MB = 1024 * 1024
function settle() {
  for (let i = 0; i < 4; i++) globalThis.gc()
  const m = process.memoryUsage()
  return { heap: m.heapUsed / MB, buffers: m.arrayBuffers / MB }
}

function measure(Fuse) {
  const before = settle()
  let hits = 0
  for (const [, opts, query] of MODES) {
    // Built and dropped inside the loop so nothing survives but module state.
    const fuse = new Fuse([longText(CHARS), 'short text', longText(1000)], opts)
    hits += fuse.search(query).length
  }
  const after = settle()
  return { hits, heap: after.heap - before.heap, buffers: after.buffers - before.buffers }
}

// Warm both once on a small input so one-off module initialisation is not
// counted as retention.
for (const F of [BaselineFuse, CandidateFuse]) new F(['warm up'], {}).search('warm')

const base = measure(BaselineFuse)
const cand = measure(CandidateFuse)
const extraHeap = cand.heap - base.heap
const extraBuffers = cand.buffers - base.buffers
const fmt = (x) => x.toFixed(2).padStart(9)
console.log(`retention probe: candidate=${candidatePath} chars=${CHARS} max-retained-mb=${MAX_MB}`)
console.log('            heap MB  buffers MB   hits')
console.log(`baseline  ${fmt(base.heap)}  ${fmt(base.buffers)}  ${String(base.hits).padStart(5)}`)
console.log(`candidate ${fmt(cand.heap)}  ${fmt(cand.buffers)}  ${String(cand.hits).padStart(5)}`)
const failed = extraHeap > MAX_MB || extraBuffers > MAX_MB || base.hits !== cand.hits
console.log(
  `candidate retains ${extraHeap.toFixed(2)} MB heap and ${extraBuffers.toFixed(2)} MB ArrayBuffer more than baseline`
)
console.log(failed ? 'RETENTION_PROBE_FAIL' : 'RETENTION_PROBE_OK')
process.exit(failed ? 1 : 0)
