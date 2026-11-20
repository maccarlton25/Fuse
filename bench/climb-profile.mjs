#!/usr/bin/env node
/**
 * Fast single-workload A/B timer + profiling target for the hill-climb swarm.
 *
 * bench/hillclimb.mjs is the only source of truth for reported numbers, but a
 * full run takes ~100s. This script replays ONE of its workloads (same corpus
 * generator, seeds, options and queries, copied verbatim) so an experiment can
 * be timed in seconds or fed to the profiler:
 *
 *   node bench/climb-profile.mjs token            # baseline vs candidate, 7 rounds
 *   node bench/climb-profile.mjs all --rounds 5
 *   node bench/climb-profile.mjs fuzzy --seed holdout
 *   node --cpu-prof --cpu-prof-dir=/tmp/prof bench/climb-profile.mjs token --candidate-only
 *
 * Workloads: fuzzy | matches | topk | extended | token | index | all
 */

import BaselineFuse from './baseline-fuse.mjs'
import CandidateFuse from '../dist/fuse.mjs'

const args = process.argv.slice(2)
const which = args[0] && !args[0].startsWith('--') ? args[0] : 'all'
const flag = (name, dflt) => {
  const i = args.indexOf(name)
  return i >= 0 && args[i + 1] ? args[i + 1] : dflt
}
const ROUNDS = Number(flag('--rounds', 7))
const seedArg = flag('--seed', 'train')
const candidateOnly = args.includes('--candidate-only')
const SEED =
  seedArg === 'train' ? 20261120 : seedArg === 'holdout' ? 987654321 : Number(seedArg) || 424242

// --- Copied verbatim from bench/hillclimb.mjs ---
function createRng(seed) {
  let a = seed >>> 0
  return function rng() {
    let t = (a += 0x6d2b79f5)
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const VOCAB = [
  'algorithm', 'architecture', 'async', 'authentication', 'benchmark',
  'bitap', 'bitmask', 'browser', 'buffer', 'cache', ' café', 'compiler',
  'compression', 'concurrency', 'configuration', 'container', 'database',
  'deployment', 'diacritics', 'distributed', 'document', 'edge', 'encryption',
  'evaluation', 'execution', 'extended', 'filtering', 'firewall', 'framework',
  'function', 'fuzzy', 'gateway', 'generation', 'graph', 'harness', 'heap',
  'heuristic', 'indexing', 'inference', 'inverted', 'isolation', 'javascript',
  'kernel', 'latency', 'leaderboard', 'lightweight', 'matching', 'memory',
  'microvm', 'middleware', 'mutation', 'naïve', 'network', 'normalization',
  'observability', 'optimization', 'orchestration', 'parallel', 'parser',
  'performance', 'persistence', 'pipeline', 'posting', 'precision', 'profiling',
  'protocol', 'query', 'queue', 'ranking', 'reactive', 'recall', 'recovery',
  'regression', 'resilience', 'résumé', 'routing', 'runtime', 'sandbox',
  'scheduler', 'scoring', 'searching', 'security', 'serialization', 'session',
  'snapshot', 'streaming', 'substring', 'telemetry', 'threshold', 'throughput',
  'tokenizer', 'typescript', 'validation', 'vector', 'verification', 'worker'
]

function buildCorpus(count, seed) {
  const rng = createRng(seed)
  const pickWord = () => VOCAB[Math.floor(rng() * VOCAB.length)].trim()
  const sentence = (min, max) => {
    const len = min + Math.floor(rng() * (max - min + 1))
    let out = ''
    for (let i = 0; i < len; i++) {
      if (i > 0) out += ' '
      out += pickWord()
    }
    return out
  }

  const docs = new Array(count)
  for (let i = 0; i < count; i++) {
    docs[i] = {
      id: `doc_${i}`,
      title: sentence(2, 6),
      body: sentence(8, 20),
      author: { name: `${pickWord()} ${pickWord()}` },
      tags: [sentence(1, 2), sentence(1, 2), sentence(1, 3)]
    }
  }
  return docs
}
// --- End verbatim copy ---

const docs = buildCorpus(4_000, SEED)
const subDocs = docs.slice(0, 3_000)
const keys = [
  { name: 'title', weight: 2 },
  { name: 'body', weight: 1 },
  { name: 'author.name', weight: 1.5 },
  { name: 'tags', weight: 1.2 }
]
const fuzzyQueries = ['javascript', 'optimiztion', 'microvm sandbox', 'latncy']
const extendedQueries = [
  '^arch',
  "'stream",
  '!legacy throughput',
  { $and: [{ title: 'typescript' }, { body: '!error' }] },
  { $or: [{ title: '^bit' }, { tags: "'perf" }] }
]
const tokenQueries = [
  'javascript',
  'javascript optimization',
  'sandbox isolation microvm',
  'javascrpt benchmrk'
]

const searchAll = (opts, queries, searchOpts) => (Fuse) => {
  const fuse = new Fuse(docs, { keys, includeScore: true, ...opts })
  return () => {
    for (const q of queries) fuse.search(q, searchOpts)
  }
}

const WORKLOADS = {
  fuzzy: searchAll({}, fuzzyQueries),
  matches: searchAll({ includeMatches: true }, fuzzyQueries),
  topk: searchAll({}, fuzzyQueries, { limit: 10 }),
  extended: searchAll({ useExtendedSearch: true }, extendedQueries),
  token: searchAll({ useTokenSearch: true }, tokenQueries),
  index: (Fuse) => () => {
    const f = new Fuse(subDocs.slice(), { keys, ignoreDiacritics: true })
    let removed = 0
    f.remove(() => {
      if (removed < 300) {
        removed++
        return true
      }
      return false
    })
  }
}

const median = (xs) => xs.slice().sort((a, b) => a - b)[Math.floor(xs.length / 2)]
const time = (fn) => {
  const t = performance.now()
  fn()
  return performance.now() - t
}

const names = which === 'all' ? Object.keys(WORKLOADS) : [which]
const speedups = []
for (const name of names) {
  if (!WORKLOADS[name]) {
    console.error(`Unknown workload "${name}". Use: ${Object.keys(WORKLOADS).join(' | ')} | all`)
    process.exit(1)
  }
  // The index workload is ~10ms, so repeat it for a stable reading.
  const inner = name === 'index' ? 10 : 1
  const repeat = (fn) => () => {
    for (let i = 0; i < inner; i++) fn()
  }
  const cand = repeat(WORKLOADS[name](CandidateFuse))
  const base = candidateOnly ? null : repeat(WORKLOADS[name](BaselineFuse))
  for (let w = 0; w < 2; w++) {
    if (base) base()
    cand()
  }
  const bt = []
  const ct = []
  for (let r = 0; r < ROUNDS; r++) {
    if (r % 2 === 0) {
      if (base) bt.push(time(base))
      ct.push(time(cand))
    } else {
      ct.push(time(cand))
      if (base) bt.push(time(base))
    }
  }
  const c = median(ct) / inner
  if (base) {
    const b = median(bt) / inner
    speedups.push(b / c)
    console.log(
      `${name.padEnd(9)} baseline=${b.toFixed(2).padStart(9)}ms  candidate=${c.toFixed(2).padStart(9)}ms  speedup=${(b / c).toFixed(3)}x`
    )
  } else {
    console.log(`${name.padEnd(9)} candidate=${c.toFixed(2).padStart(9)}ms`)
  }
}
if (speedups.length > 1) {
  const geo = Math.exp(speedups.reduce((a, s) => a + Math.log(s), 0) / speedups.length)
  console.log(`geomean (indicative only; report bench/hillclimb.mjs numbers): ${geo.toFixed(4)}x`)
}
