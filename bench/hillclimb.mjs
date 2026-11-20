#!/usr/bin/env node
/**
 * Locked Hill-Climbing Verifier & Head-to-Head Benchmark for Fuse.js
 *
 * DO NOT MODIFY THIS FILE OR bench/baseline-fuse.mjs.
 * Reviewers verify SHA-256 integrity of both files before accepting any branch.
 *
 * Usage:
 *   npm run build && node bench/hillclimb.mjs
 *   node bench/hillclimb.mjs --seed holdout
 */

import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import zlib from 'node:zlib'
import BaselineFuse from './baseline-fuse.mjs'
import CandidateFuse from '../dist/fuse.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')

const EXPECTED_BASELINE_SHA256 =
  '2c4938f54cacee4ab2e68aa3b3c6126c04d9e4394baa3d691a36acc1907ef71f'
const BASELINE_MIN_GZIP_BYTES = 10121
const MAX_GZIP_BYTES = Math.ceil(BASELINE_MIN_GZIP_BYTES * 1.05)

// --- Parse CLI flags ---
const args = process.argv.slice(2)
let seedArg = 'train'
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--seed' && args[i + 1]) {
    seedArg = args[i + 1]
    i++
  }
}

const SEED =
  seedArg === 'train'
    ? 20261120
    : seedArg === 'holdout'
      ? 987654321
      : Number(seedArg) || 424242

// --- Deterministic PRNG (Mulberry32) ---
function createRng(seed) {
  let a = seed >>> 0
  return function rng() {
    let t = (a += 0x6d2b79f5)
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

// --- 1. Integrity & Bundle Budget Checks ---
const baselineBytes = fs.readFileSync(path.join(__dirname, 'baseline-fuse.mjs'))
const actualBaselineSha = crypto
  .createHash('sha256')
  .update(baselineBytes)
  .digest('hex')

if (actualBaselineSha !== EXPECTED_BASELINE_SHA256) {
  console.error(
    `INTEGRITY_FAIL: bench/baseline-fuse.mjs SHA-256 mismatch (${actualBaselineSha})`
  )
  process.exit(2)
}

const minBundlePath = path.join(ROOT, 'dist/fuse.min.mjs')
if (!fs.existsSync(minBundlePath)) {
  console.error('BUILD_MISSING: dist/fuse.min.mjs not found. Run `npm run build` first.')
  process.exit(2)
}
const candidateGzipBytes = zlib.gzipSync(fs.readFileSync(minBundlePath)).length
const gzipDeltaPct =
  ((candidateGzipBytes - BASELINE_MIN_GZIP_BYTES) / BASELINE_MIN_GZIP_BYTES) * 100

if (candidateGzipBytes > MAX_GZIP_BYTES) {
  console.error(
    `BUNDLE_FAIL: dist/fuse.min.mjs gzip=${candidateGzipBytes}B exceeds +5% cap (${MAX_GZIP_BYTES}B, baseline=${BASELINE_MIN_GZIP_BYTES}B)`
  )
  process.exit(3)
}

// --- 2. Corpus Generation ---
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

// --- 3. Exact Parity Gate ---
function assertParity(seed) {
  const parityDocs = buildCorpus(1500, seed ^ 0xabcdef)
  const keys = [
    { name: 'title', weight: 2 },
    { name: 'body', weight: 1 },
    { name: 'author.name', weight: 1.5 },
    { name: 'tags', weight: 1.2 }
  ]

  const configs = [
    { name: 'fuzzy_default', opts: { keys, includeScore: true } },
    {
      name: 'fuzzy_matches_diacritics',
      opts: { keys, includeScore: true, includeMatches: true, ignoreDiacritics: true }
    },
    { name: 'fuzzy_topk', opts: { keys, includeScore: true } },
    {
      name: 'extended',
      opts: { keys, includeScore: true, useExtendedSearch: true, includeMatches: true }
    },
    {
      name: 'token_search',
      opts: { keys, includeScore: true, useTokenSearch: true }
    }
  ]

  const queriesByMode = {
    fuzzy_default: [
      'javascript', 'javascrpt', 'optimiztion', 'bitap', 'microvm sandbox',
      'latncy', 'resumé', 'nonexistentxyz', 'a', 'distributed orchestration'
    ],
    fuzzy_matches_diacritics: [
      'cafe', 'resume', 'naive', 'parallel', 'threshld', 'benchmrk', 'toknizer'
    ],
    fuzzy_topk: [
      'performance', 'typescript', 'searching', 'indexing', 'archtecture', 'framewrk'
    ],
    extended: [
      '^java', 'tion$', "'bench", '!sandbox ^comp', 'fuzzy | token', '=authentication',
      { $and: [{ title: 'javascript' }, { body: '!legacy' }] },
      { $or: [{ title: '^opt' }, { tags: "'perf" }] }
    ],
    token_search: [
      'javascript', 'javascript optimization', 'fuzzy bitap scoring',
      'javascrpt benchmrk', 'sandbox isolation microvm', 'unknownzz token'
    ]
  }

  let checked = 0
  for (const cfg of configs) {
    const base = new BaselineFuse(parityDocs, cfg.opts)
    const cand = new CandidateFuse(parityDocs, cfg.opts)
    const searchOpts = cfg.name === 'fuzzy_topk' ? { limit: 10 } : undefined

    for (const q of queriesByMode[cfg.name]) {
      const bRes = base.search(q, searchOpts)
      const cRes = cand.search(q, searchOpts)
      checked++

      if (bRes.length !== cRes.length) {
        throw new Error(
          `Parity length mismatch in ${cfg.name} query=${JSON.stringify(q)}: baseline=${bRes.length} candidate=${cRes.length}`
        )
      }
      for (let i = 0; i < bRes.length; i++) {
        const b = bRes[i]
        const c = cRes[i]
        const scoreDiff = Math.abs((b.score ?? 0) - (c.score ?? 0))
        if (scoreDiff > 1e-11) {
          throw new Error(
            `Parity score mismatch in ${cfg.name} query=${JSON.stringify(q)} at #${i}: baseline=${b.score} candidate=${c.score}`
          )
        }
        // Only enforce strict refIndex order when scores are not tied
        const prevTied = i > 0 && Math.abs((bRes[i - 1].score ?? 0) - (b.score ?? 0)) <= 1e-12
        const nextTied =
          i + 1 < bRes.length && Math.abs((bRes[i + 1].score ?? 0) - (b.score ?? 0)) <= 1e-12
        if (!prevTied && !nextTied && b.refIndex !== c.refIndex) {
          throw new Error(
            `Parity refIndex mismatch in ${cfg.name} query=${JSON.stringify(q)} at #${i}: baseline=${b.refIndex} candidate=${c.refIndex}`
          )
        }
        if (cfg.opts.includeMatches && b.refIndex === c.refIndex) {
          const bMatches = JSON.stringify(b.matches)
          const cMatches = JSON.stringify(c.matches)
          if (bMatches !== cMatches) {
            throw new Error(
              `Parity matches mismatch in ${cfg.name} query=${JSON.stringify(q)} refIndex=${b.refIndex}`
            )
          }
        }
      }
    }
  }

  // Mutation parity (add / removeAt / remove)
  const mutDocsA = parityDocs.slice(0, 300)
  const mutDocsB = parityDocs.slice(0, 300)
  const baseMut = new BaselineFuse(mutDocsA, { keys, includeScore: true })
  const candMut = new CandidateFuse(mutDocsB, { keys, includeScore: true })
  baseMut.add({
    id: 'added_1',
    title: 'hyperbolic bitap accelerator',
    body: 'fast typed array search kernel',
    author: { name: 'fx cloud' },
    tags: ['speed']
  })
  candMut.add({
    id: 'added_1',
    title: 'hyperbolic bitap accelerator',
    body: 'fast typed array search kernel',
    author: { name: 'fx cloud' },
    tags: ['speed']
  })
  baseMut.remove((doc, idx) => idx % 7 === 0)
  candMut.remove((doc, idx) => idx % 7 === 0)
  const bMutRes = baseMut.search('accelerator')
  const cMutRes = candMut.search('accelerator')
  if (
    bMutRes.length !== cMutRes.length ||
    bMutRes[0]?.item?.id !== cMutRes[0]?.item?.id
  ) {
    throw new Error('Parity mismatch after add/remove mutations')
  }
  return checked + 1
}

let parityCount = 0
try {
  parityCount = assertParity(SEED)
} catch (err) {
  console.error(`PARITY_FAIL: ${err.message}`)
  process.exit(4)
}

// --- 4. Head-to-Head Interleaved Benchmarks ---
const DOC_COUNT = 4_000
const docs = buildCorpus(DOC_COUNT, SEED)
const keys = [
  { name: 'title', weight: 2 },
  { name: 'body', weight: 1 },
  { name: 'author.name', weight: 1.5 },
  { name: 'tags', weight: 1.2 }
]

const baseFuzzy = new BaselineFuse(docs, { keys, includeScore: true })
const candFuzzy = new CandidateFuse(docs, { keys, includeScore: true })

const baseMatches = new BaselineFuse(docs, {
  keys,
  includeScore: true,
  includeMatches: true
})
const candMatches = new CandidateFuse(docs, {
  keys,
  includeScore: true,
  includeMatches: true
})

const baseExtended = new BaselineFuse(docs, {
  keys,
  includeScore: true,
  useExtendedSearch: true
})
const candExtended = new CandidateFuse(docs, {
  keys,
  includeScore: true,
  useExtendedSearch: true
})

const baseToken = new BaselineFuse(docs, {
  keys,
  includeScore: true,
  useTokenSearch: true
})
const candToken = new CandidateFuse(docs, {
  keys,
  includeScore: true,
  useTokenSearch: true
})

function measurePair(name, baseFn, candFn, rounds = 5, warmup = 2) {
  for (let w = 0; w < warmup; w++) {
    baseFn()
    candFn()
  }
  const baseTimes = []
  const candTimes = []
  for (let r = 0; r < rounds; r++) {
    if (r % 2 === 0) {
      const t0 = performance.now()
      baseFn()
      baseTimes.push(performance.now() - t0)
      const t1 = performance.now()
      candFn()
      candTimes.push(performance.now() - t1)
    } else {
      const t1 = performance.now()
      candFn()
      candTimes.push(performance.now() - t1)
      const t0 = performance.now()
      baseFn()
      baseTimes.push(performance.now() - t0)
    }
  }
  baseTimes.sort((a, b) => a - b)
  candTimes.sort((a, b) => a - b)
  const baseMed = baseTimes[Math.floor(baseTimes.length / 2)]
  const candMed = candTimes[Math.floor(candTimes.length / 2)]
  const speedup = baseMed / candMed
  return {
    name,
    baselineMs: Number(baseMed.toFixed(3)),
    candidateMs: Number(candMed.toFixed(3)),
    speedup: Number(speedup.toFixed(4))
  }
}

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

const subDocs = docs.slice(0, 3_000)

const workloads = [
  measurePair(
    'bitap_fuzzy',
    () => {
      for (const q of fuzzyQueries) baseFuzzy.search(q)
    },
    () => {
      for (const q of fuzzyQueries) candFuzzy.search(q)
    }
  ),
  measurePair(
    'bitap_matches',
    () => {
      for (const q of fuzzyQueries) baseMatches.search(q)
    },
    () => {
      for (const q of fuzzyQueries) candMatches.search(q)
    }
  ),
  measurePair(
    'topk_limit10',
    () => {
      for (const q of fuzzyQueries) baseFuzzy.search(q, { limit: 10 })
    },
    () => {
      for (const q of fuzzyQueries) candFuzzy.search(q, { limit: 10 })
    }
  ),
  measurePair(
    'extended_logical',
    () => {
      for (const q of extendedQueries) baseExtended.search(q)
    },
    () => {
      for (const q of extendedQueries) candExtended.search(q)
    }
  ),
  measurePair(
    'token_inverted',
    () => {
      for (const q of tokenQueries) baseToken.search(q)
    },
    () => {
      for (const q of tokenQueries) candToken.search(q)
    }
  ),
  measurePair(
    'index_diacritics_mutate',
    () => {
      const f = new BaselineFuse(subDocs.slice(), {
        keys,
        ignoreDiacritics: true
      })
      let removed = 0
      f.remove(() => {
        if (removed < 300) {
          removed++
          return true
        }
        return false
      })
    },
    () => {
      const f = new CandidateFuse(subDocs.slice(), {
        keys,
        ignoreDiacritics: true
      })
      let removed = 0
      f.remove(() => {
        if (removed < 300) {
          removed++
          return true
        }
        return false
      })
    },
    7,
    2
  )
]

const logSum = workloads.reduce((acc, w) => acc + Math.log(w.speedup), 0)
const compositeGeomean = Number(Math.exp(logSum / workloads.length).toFixed(4))

console.log(`Fuse.js Hill-Climb Verifier (seed=${seedArg}:${SEED}, docs=${DOC_COUNT})`)
console.log('='.repeat(74))
console.log(
  `Parity checks: ${parityCount} passed | Minified gzip: ${candidateGzipBytes}B (${gzipDeltaPct >= 0 ? '+' : ''}${gzipDeltaPct.toFixed(2)}%, cap ${MAX_GZIP_BYTES}B)`
)
console.log('-'.repeat(74))
for (const w of workloads) {
  console.log(
    `  ${w.name.padEnd(25)} baseline=${String(w.baselineMs.toFixed(2) + 'ms').padStart(9)}  candidate=${String(w.candidateMs.toFixed(2) + 'ms').padStart(9)}  speedup=${w.speedup.toFixed(3)}x`
  )
}
console.log('-'.repeat(74))
console.log(`COMPOSITE GEOMEAN SPEEDUP: ${compositeGeomean.toFixed(4)}x`)

const summary = {
  status: 'PASS',
  seed: seedArg,
  parityChecks: parityCount,
  gzipBytes: candidateGzipBytes,
  gzipDeltaPct: Number(gzipDeltaPct.toFixed(2)),
  compositeSpeedup: compositeGeomean,
  workloads
}
console.log(`HILLCLIMB_JSON=${JSON.stringify(summary)}`)
