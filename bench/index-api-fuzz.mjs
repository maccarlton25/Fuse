#!/usr/bin/env node
/**
 * Index-API and observable-read differential for the hill-climb swarm.
 *
 * bench/parity-fuzz.mjs drives the index only through Fuse's own methods,
 * which always pass plain arrays and plain documents. This tool covers what
 * that misses, each found by the gen 2 review of climb/gen2-index:
 *
 *  1. FuseIndex.removeAll() called directly with any iterable (Set, generator,
 *     typed array), on created and parsed indexes, including parsed indexes
 *     whose `records` are out of order or hold the same object twice.
 *  2. What index creation reads, and how often: documents and getFn results
 *     are wrapped in Proxies that log every property read, and values come
 *     from getters that change on each read. The read log and the resulting
 *     index must both equal the baseline's.
 *
 * A case fails when baseline and candidate differ in result, in thrown
 * message, or in read log.
 *
 * Usage:
 *   npm run build && node bench/index-api-fuzz.mjs
 *   node bench/index-api-fuzz.mjs --iters 3000 --seed 7 --candidate ./x/fuse.mjs
 */
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import BaselineFuse from './baseline-fuse.mjs'

const args = process.argv.slice(2)
const flag = (name, dflt) => {
  const i = args.indexOf(name)
  return i >= 0 && args[i + 1] ? args[i + 1] : dflt
}
const ITERS = Number(flag('--iters', 1500))
const SEED = Number(flag('--seed', 1))
const candidatePath = flag('--candidate', '../dist/fuse.mjs')
const candidateUrl = candidatePath.startsWith('.')
  ? new URL(candidatePath, import.meta.url).href
  : pathToFileURL(path.resolve(candidatePath)).href
const CandidateFuse = (await import(candidateUrl)).default

let state = SEED >>> 0
const rnd = () => {
  state = (state + 0x6d2b79f5) >>> 0
  let t = state
  t = Math.imul(t ^ (t >>> 15), t | 1)
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296
}
const int = (n) => Math.floor(rnd() * n)
const pick = (a) => a[int(a.length)]
const chance = (p) => rnd() < p
const WORDS = ['alpha', 'beta gamma', 'delta\tepsilon', '', ' ', 'zeta eta theta', 'Ünïcode word', 'x']

const ser = (v) =>
  JSON.stringify(v, (k, x) => (typeof x === 'number' && Object.is(x, -0) ? '-0' : x === undefined ? '[undef]' : x)) ??
  'undefined'
const attempt = (fn) => {
  try {
    return ser(fn())
  } catch (err) {
    return `THROW:${err && err.message}`
  }
}

// ---- 1. removeAll with arbitrary iterables --------------------------------
function planRemoveAll() {
  const n = 1 + int(9)
  const docs = Array.from({ length: n }, (_, i) => `${pick(WORDS)} d${i}`)
  const raw = Array.from({ length: int(6) }, () =>
    pick([int(n), int(n), int(n + 2), -1, 0.5, NaN, n, '1', null, undefined, 2 ** 32])
  )
  return {
    docs,
    raw,
    shape: pick(['array', 'set', 'generator', 'typed', 'sparse']),
    source: pick(['created', 'parsed', 'parsed-shuffled', 'parsed-shared']),
    order: Array.from({ length: n }, () => rnd()),
    share: [int(n), int(n)]
  }
}
function runRemoveAll(Fuse, p) {
  let index = Fuse.createIndex([], p.docs)
  if (p.source !== 'created') {
    const json = JSON.parse(JSON.stringify(index.toJSON()))
    if (p.source === 'parsed-shuffled') {
      json.records = json.records.map((r, i) => [p.order[i], r]).sort((a, b) => a[0] - b[0]).map((x) => x[1])
    } else if (p.source === 'parsed-shared') {
      json.records[p.share[0]] = json.records[p.share[1]]
    }
    index = Fuse.parseIndex(json)
  }
  let indices = p.raw.slice()
  if (p.shape === 'set') indices = new Set(p.raw)
  else if (p.shape === 'generator') indices = (function* () { yield* p.raw })()
  else if (p.shape === 'typed') indices = Int32Array.from(p.raw.map((v) => (Number.isInteger(v) ? v : 0)))
  else if (p.shape === 'sparse') delete indices[0]
  return [attempt(() => index.removeAll(indices)), attempt(() => index.toJSON()), attempt(() => index.size())]
}

// ---- 2. observable reads during index creation ----------------------------
function planReads() {
  const leaf = () => pick(['str', 'str', 'num', 'null', 'undef', 'bool', 'obj'])
  const field = () => {
    const kind = pick(['leaf', 'leaf', 'array', 'items', 'nested', 'missing'])
    if (kind === 'array' || kind === 'nested') return { kind, items: Array.from({ length: int(4) }, leaf), hole: chance(0.2) }
    if (kind === 'items') return { kind, items: Array.from({ length: 1 + int(3) }, leaf), i: chance(0.5) }
    return { kind, leaf: leaf() }
  }
  return {
    nDocs: 1 + int(3),
    fields: [field(), field()],
    getFn: pick(['none', 'none', 'perKey', 'perKeyItems', 'global']),
    weight: pick([undefined, 2]),
    word: pick(WORDS)
  }
}
function runReads(Fuse, p) {
  const log = []
  let tick = 0
  // Every read of a leaf returns a different value, so reading it a different
  // number of times than the baseline changes the index as well as the log.
  const leafValue = (kind) => {
    tick++
    if (kind === 'str') return `${p.word} r${tick}`
    if (kind === 'num') return tick
    if (kind === 'null') return null
    if (kind === 'undef') return undefined
    if (kind === 'bool') return tick % 2 === 0
    return { toString: () => `obj${tick}` }
  }
  const watch = (target, name) =>
    new Proxy(target, {
      get(t, key, recv) {
        if (typeof key === 'string') log.push(`${name}.${key}`)
        return Reflect.get(t, key, recv)
      },
      has(t, key) {
        if (typeof key === 'string') log.push(`${name} has ${key}`)
        return Reflect.has(t, key)
      }
    })
  const build = (f, name) => {
    if (f.kind === 'missing') return undefined
    if (f.kind === 'leaf') return undefined // installed as a getter below
    if (f.kind === 'items') {
      return f.items.map((kind, j) => {
        const item = {}
        Object.defineProperty(item, 'v', { enumerable: true, get: () => leafValue(kind) })
        if (f.i) item.i = j
        return watch(item, `${name}[${j}]`)
      })
    }
    const arr = f.items.map((kind) => leafValue(kind))
    if (f.hole && arr.length > 1) delete arr[1]
    return watch(f.kind === 'nested' ? [arr, arr.slice(0, 1)] : arr, name)
  }
  const docs = []
  for (let d = 0; d < p.nDocs; d++) {
    const doc = {}
    p.fields.forEach((f, k) => {
      const name = `d${d}.f${k}`
      if (f.kind === 'leaf') Object.defineProperty(doc, `f${k}`, { enumerable: true, get: () => leafValue(f.leaf) })
      else if (f.kind !== 'missing') doc[`f${k}`] = build(f, name)
    })
    docs.push(watch(doc, `d${d}`))
  }
  const keys = p.fields.map((f, k) => {
    const key = { name: `f${k}` }
    if (p.weight && k === 0) key.weight = p.weight
    if (p.getFn === 'perKey') key.getFn = (doc) => doc[`f${k}`]
    if (p.getFn === 'perKeyItems') key.getFn = () => build({ kind: 'items', items: ['str', 'num'], i: true }, `g${k}`)
    return key
  })
  const options = { keys }
  if (p.getFn === 'global') options.getFn = (doc, path) => doc[Array.isArray(path) ? path[0] : path]
  const out = attempt(() => new Fuse(docs, options).getIndex().toJSON())
  return [out, log.join('|')]
}

let mismatches = 0
let first = ''
const counts = { removeAll: 0, reads: 0 }
const bad = { removeAll: 0, reads: 0 }
for (let iter = 0; iter < ITERS; iter++) {
  for (const [name, plan, run] of [
    ['removeAll', planRemoveAll, runRemoveAll],
    ['reads', planReads, runReads]
  ]) {
    const p = plan()
    const a = run(BaselineFuse, p)
    const b = run(CandidateFuse, p)
    counts[name]++
    if (ser(a) !== ser(b)) {
      mismatches++
      bad[name]++
      if (!first) {
        const i = a.findIndex((x, j) => x !== b[j])
        first = `${name} case ${iter}: plan=${ser(p)}\n  baseline : ${String(a[i]).slice(0, 300)}\n  candidate: ${String(b[i]).slice(0, 300)}`
      }
    }
  }
}
if (mismatches) {
  console.error(
    `INDEX_API_FUZZ_FAIL mismatches=${mismatches} of ${counts.removeAll + counts.reads} (removeAll ${bad.removeAll}, reads ${bad.reads}; seed=${SEED})`
  )
  console.error(`first: ${first}`)
  process.exit(1)
}
console.log(
  `INDEX_API_FUZZ_OK removeAll=${counts.removeAll} reads=${counts.reads} seed=${SEED} mismatches=0 candidate=${candidatePath}`
)
