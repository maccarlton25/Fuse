import get from '../src/helpers/get'
import norm from '../src/tools/fieldNorm'
import { isBlank } from '../src/helpers/typeGuards'
import FuseIndex from '../src/tools/FuseIndex'

process.env.EXTENDED_SEARCH_ENABLED = 'true'
process.env.TOKEN_SEARCH_ENABLED = 'true'
const { default: Fuse } = await import('../src/entry')
// The locked baseline oracle (untyped).
const oracle: string = '../bench/baseline-fuse.mjs'
const { default: BaselineFuse } = await import(oracle)

// Reference implementations copied from the pre-optimization code; the
// optimized versions must agree with them exactly.
function refGet(obj: any, path: string | string[]): any {
  const list: any[] = []
  let arr = false
  const isBool = (v: any) =>
    v === true ||
    v === false ||
    (typeof v === 'object' &&
      v !== null &&
      Object.prototype.toString.call(v) == '[object Boolean]')
  const toStr = (v: any) =>
    v == null
      ? ''
      : typeof v == 'string'
        ? v
        : typeof v === 'bigint'
          ? v.toString()
          : v + '' == '0' && 1 / v == -Infinity
            ? '-0'
            : v + ''
  const deepGet = (obj: any, path: string[], index: number, ai?: number) => {
    if (obj === undefined || obj === null) return
    if (!path[index]) {
      list.push(ai !== undefined ? { v: obj, i: ai } : obj)
    } else {
      const value = obj[path[index]]
      if (value === undefined || value === null) return
      if (
        index === path.length - 1 &&
        (typeof value === 'string' ||
          typeof value === 'number' ||
          isBool(value) ||
          typeof value === 'bigint')
      ) {
        list.push(ai !== undefined ? { v: toStr(value), i: ai } : toStr(value))
      } else if (Array.isArray(value)) {
        arr = true
        for (let i = 0; i < value.length; i++) deepGet(value[i], path, index + 1, i)
      } else if (path.length) {
        deepGet(value, path, index + 1, ai)
      }
    }
  }
  deepGet(obj, typeof path === 'string' ? path.split('.') : path, 0)
  return arr ? list : list[0]
}

function refWords(value: string): number {
  const sep = (c: number) => (c >= 9 && c <= 13) || c === 32 || c === 160
  let n = 0
  let inWord = false
  for (let i = 0; i < value.length; i++) {
    if (!sep(value.charCodeAt(i))) {
      if (!inWord) {
        n++
        inWord = true
      }
    } else inWord = false
  }
  return n || 1
}

describe('get() matches the reference walk', () => {
  const obj: any = {
    a: 'x',
    n: 0,
    neg: -0,
    b: true,
    bo: new Boolean(false),
    big: BigInt(12),
    nul: null,
    o: { p: { q: 'deep' }, num: new Number(3), arr: [] },
    arr: ['s', 1, null, { x: 'ax' }, [{ x: 'nested' }, 'z'], { x: [1, 2] }],
    objs: [{ x: { y: 'a' } }, { x: null }, { y: 1 }, { x: { y: [false] } }],
    '': { e: 'empty-seg' },
    empty: []
  }
  const paths: (string | string[])[] = [
    'a', 'n', 'neg', 'b', 'bo', 'big', 'nul', 'missing', 'o', 'o.p', 'o.p.q',
    'o.p.q.r', 'o.num', 'o.arr', 'arr', 'arr.x', 'arr.x.y', 'objs.x.y', 'objs.x',
    'objs', 'empty', 'empty.x', '', 'a..b', '.e', ['o', 'p', 'q'], [], ['arr'],
    ['a', 'length'], 'a.length', ['objs', 'x', 'y'], 'nul.x', 'a.0'
  ]
  test.each(paths.map((p) => [p]))('path %j', (p) => {
    expect(get(obj, p)).toEqual(refGet(obj, p))
    expect(JSON.stringify(get(obj, p) ?? null, (_, v) =>
      typeof v === 'bigint' ? `${v}n` : v
    )).toBe(JSON.stringify(refGet(obj, p) ?? null, (_, v) =>
      typeof v === 'bigint' ? `${v}n` : v
    ))
  })
  test('non-object roots', () => {
    for (const root of [null, undefined, 'str', 5, [1, 2], [{ a: 'q' }]]) {
      for (const p of ['a', 'length', '', '0']) {
        expect(get(root, p)).toEqual(refGet(root, p))
      }
    }
  })
})

describe('fieldNorm word count matches the char-loop reference', () => {
  const pieces = ['a', 'bc', ' ', '  ', '\t', '\n', '\r\n', '\v', '\f', '\u00a0',
    '\u3000', '\u2003', 'é', '\u0001', '\u001f', '']
  test('random strings', () => {
    let seed = 7
    const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647
    for (let k = 0; k < 3000; k++) {
      let s = ''
      const len = Math.floor(rnd() * 10)
      for (let i = 0; i < len; i++) s += pieces[Math.floor(rnd() * pieces.length)]
      for (const w of [1, 0.5, 2]) {
        const expected =
          Math.round(1000 / Math.pow(refWords(s), 0.5 * w)) / 1000
        expect(norm(w, 3).get(s)).toBe(expected)
      }
    }
  })
})

describe('isBlank matches trim()', () => {
  test('all single chars and prefixes', () => {
    for (let c = 0; c < 0x3100; c++) {
      const ch = String.fromCharCode(c)
      for (const s of [ch, ch + 'x', ch + ' ', ' ' + ch, ch + ch]) {
        expect(isBlank(s)).toBe(!s.trim().length)
      }
    }
    expect(isBlank('')).toBe(true)
  })
})

describe('FuseIndex.removeAll matches the Set-based reference', () => {
  test('unsorted, duplicate, invalid indices and unordered records', () => {
    let seed = 3
    const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647
    for (let k = 0; k < 300; k++) {
      const n = Math.floor(rnd() * 12)
      const recs = Array.from({ length: n }, (_, i) => ({ i, $: {} }))
      recs.sort(() => rnd() - 0.5)
      const idx: number[] = Array.from({ length: Math.floor(rnd() * 8) }, () => {
        const r = rnd()
        return r < 0.1 ? -1 : r < 0.2 ? 1.5 : r < 0.25 ? NaN : Math.floor(rnd() * 14)
      })
      const a = new FuseIndex()
      a.setIndexRecords(JSON.parse(JSON.stringify(recs)))
      a.removeAll(idx.slice())

      // reference
      let ref = JSON.parse(JSON.stringify(recs))
      const set = new Set(idx.filter((v) => Number.isInteger(v) && v >= 0))
      if (set.size) {
        ref = ref.filter((r: any) => !set.has(r.i))
        const sorted = Array.from(set).sort((x, y) => x - y)
        for (const r of ref) r.i -= sorted.filter((v) => v < r.i).length
      }
      expect(JSON.stringify(a.records)).toBe(JSON.stringify(ref))
    }
  })
})

// Differential checks against the locked baseline oracle.
const snap = (f: any, queries: string[]) =>
  JSON.stringify({
    index: f.getIndex().toJSON(),
    hits: queries.map((q) => f.search(q, { includeScore: true }))
  })

describe('Fuse.remove on sparse docs matches the baseline', () => {
  test('hole at a removed index keeps docs and index in step', () => {
    const docs = ['apple', , 'banana', 'cherry'] as any[]
    const a = new Fuse(docs.slice())
    const b = new BaselineFuse(docs.slice())
    const pred = (_: any, i: number) => i === 1 || i === 2
    expect(JSON.stringify(a.remove(pred))).toBe(JSON.stringify(b.remove(pred)))
    expect(snap(a, ['cherry', 'apple'])).toBe(snap(b, ['cherry', 'apple']))
  })

  test('random sparse docs, string and object lists, token search', () => {
    let seed = 11
    const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647
    const words = ['apple', 'banana', 'cherry', 'date', ' ', '']
    for (let k = 0; k < 200; k++) {
      const n = 1 + Math.floor(rnd() * 10)
      const objects = rnd() < 0.5
      const docs: any[] = new Array(n)
      for (let i = 0; i < n; i++) {
        if (rnd() < 0.3) continue // hole
        const w = words[Math.floor(rnd() * words.length)]
            docs[i] = objects ? { t: w, tags: [w, , 'x' + i] } : w
      }
      if (objects && docs[0] === undefined) docs[0] = { t: 'first' }
      if (!objects && docs[0] === undefined) docs[0] = 'first'
      if (rnd() < 0.3) (docs as any).extra = 'not an index'
      const opts: any = objects ? { keys: ['t', 'tags'] } : {}
      if (rnd() < 0.5) opts.useTokenSearch = true
      const a = new Fuse(docs.slice(), opts)
      const b = new BaselineFuse(docs.slice(), opts)
      const picks = new Set<number>()
      for (let i = 0; i < n; i++) if (rnd() < 0.4) picks.add(i)
      const pred = (_: any, i: number) => picks.has(i)
      expect(JSON.stringify(a.remove(pred))).toBe(
        JSON.stringify(b.remove(pred))
      )
      const qs = ['apple', 'cherry', 'x3', 'first']
      expect(snap(a, qs)).toBe(snap(b, qs))
    }
  })
})

describe('field norm over rare separators matches the baseline', () => {
  test('tabs, LF, VT, FF, CR, NBSP, leading, trailing and repeated runs', () => {
    let seed = 29
    const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647
    const seps = ['\t', '\n', '\v', '\f', '\r', ' ', '\u00a0', '\u3000', '\u2003', '\x08', '\x0e', '\x1f', '!']
    const docs: any[] = []
    for (let k = 0; k < 400; k++) {
      let s = ''
      const n = Math.floor(rnd() * 12)
      for (let i = 0; i < n; i++) {
        s += rnd() < 0.5 ? seps[Math.floor(rnd() * seps.length)] : 'w' + i
      }
      docs.push({ t: s, tags: [s, s + ' x', '\t' + s] })
    }
    for (const fieldNormWeight of [0, 0.5, 1, 2.5]) {
      const opts = { keys: ['t', 'tags'], fieldNormWeight }
      const a = new Fuse(docs, opts)
      const b = new BaselineFuse(docs, opts)
      expect(JSON.stringify(a.getIndex().toJSON())).toBe(
        JSON.stringify(b.getIndex().toJSON())
      )
    }
  })
})

describe('get() reads each path segment once, like the baseline', () => {
  const counting = () => {
    const reads: string[] = []
    const tags = ['a', { x: 'b' }, ['c']]
    const doc = {
      get tags() {
        reads.push('tags')
        return tags
      },
      get o() {
        reads.push('o')
        return {
          get arr() {
            reads.push('o.arr')
            return [{ x: 'y' }, { x: 'z' }]
          }
        }
      }
    }
    return { doc, reads }
  }
  test.each([['tags'], ['o.arr.x'], [['o', 'arr']], ['tags.x'], ['o.arr']])(
    'path %j',
    (path) => {
      const a = counting()
      const b = counting()
      const ra = Fuse.config.getFn(a.doc, path)
      const rb = BaselineFuse.config.getFn(b.doc, path)
      expect(JSON.stringify(ra)).toBe(JSON.stringify(rb))
      expect(a.reads).toEqual(b.reads)
    }
  )
  test('Proxy traps fire as often as in the baseline', () => {
    const trap = (log: string[]) =>
      new Proxy(
        { list: ['p', 'q'], deep: { list: [{ v: 1 }] } },
        {
          get(t: any, k) {
            log.push(String(k))
            return t[k]
          }
        }
      )
    for (const path of ['list', 'deep.list.v', 'deep', 'missing']) {
      const la: string[] = []
      const lb: string[] = []
      expect(JSON.stringify(Fuse.config.getFn(trap(la), path))).toBe(
        JSON.stringify(BaselineFuse.config.getFn(trap(lb), path))
      )
      expect(la).toEqual(lb)
    }
  })
})

describe('errors thrown while indexing match the baseline', () => {
  const thrown = (F: any, docs: any[], opts?: any) => {
    try {
      new F(docs, opts)
      return 'no throw'
    } catch (e: any) {
      return `${e.constructor.name}: ${e.message}`
    }
  }
  test.each([
    [['a', 5]],
    [['a', {}]],
    [['a', true]],
    [['a', 1n]],
    [['a', ['b']]],
    [['a', new String(' ')]],
    [['a', { trim: () => '' }]],
    [['a', { charCodeAt: () => 65 }]],
    [['a', Symbol('s')]]
  ])('string list %#', (docs) => {
    expect(thrown(Fuse, docs)).toBe(thrown(BaselineFuse, docs))
  })
})

describe('object records match the baseline key for key', () => {
  const shape = (f: any) =>
    JSON.stringify(
      f
        .getIndex()
        .records.map((r: any) => [
          Object.keys(r),
          Object.keys(r.$),
          Object.values(r.$),
          r
        ])
    )
  const docs: any[] = [
    { a: 'x y', b: ['p', '', ' ', null, 'q'], c: { d: 'z' } },
    { a: '', b: [], c: null },
    { a: '   ', b: 'solo', c: { d: 5 } },
    { a: 7, b: [1, true, 2n, -0], c: { d: [{ e: 1 }] } },
    { b: [['n', ['m']], { v: 'w' }] },
    {},
    { a: null, b: undefined, c: { d: '\t' } },
    { a: 'last', b: ['r'], c: { d: 'dd' } }
  ]
  const keySets: any[] = [
    ['a', 'b', 'c.d'],
    ['a'],
    [{ name: 'a', getFn: (d: any) => d.a ?? 42 }, 'b'],
    [{ name: 'b', getFn: (d: any) => d.b ?? ' ' }, { name: 'z', getFn: () => [''] }]
  ]
  test.each(keySets.map((k) => [k]))('keys %#', (keys) => {
    for (const getFn of [undefined, (d: any, p: any) => (p[0] === 'a' ? d.a : ['g'])]) {
      const opts: any = getFn ? { keys, getFn } : { keys }
      const a = new Fuse(docs.slice(0, 6), opts)
      const b = new BaselineFuse(docs.slice(0, 6), opts)
      for (const d of docs.slice(6)) {
        a.add(d)
        b.add(d)
      }
      expect(shape(a)).toBe(shape(b))
      a.removeAt(1)
      b.removeAt(1)
      expect(shape(a)).toBe(shape(b))
      const pa = Fuse.parseIndex(a.getIndex().toJSON())
      const pb = BaselineFuse.parseIndex(b.getIndex().toJSON())
      expect(JSON.stringify(pa.toJSON())).toBe(JSON.stringify(pb.toJSON()))
    }
  })
})

describe('cached field norms match the baseline for any weight', () => {
  test('norms that round to 0, NaN, negative and huge weights', () => {
    const docs = ['a', 'a b', 'a b c d e f g h i j', 'w '.repeat(5000), '', ' ']
    for (const fieldNormWeight of [0, 1, 7, 50, -1, NaN, Infinity, 1e-9]) {
      const a = new Fuse(docs.slice(), { fieldNormWeight })
      const b = new BaselineFuse(docs.slice(), { fieldNormWeight })
      expect(JSON.stringify(a.getIndex().toJSON())).toBe(
        JSON.stringify(b.getIndex().toJSON())
      )
      // second pass over the same norm cache
      for (const d of docs) {
        a.add(d)
        b.add(d)
      }
      expect(JSON.stringify(a.getIndex().toJSON())).toBe(
        JSON.stringify(b.getIndex().toJSON())
      )
    }
  })
})

describe('inlined default getFn on one-segment keys matches the baseline', () => {
  const json = (f: any) => JSON.stringify(f.getIndex().toJSON())
  class Odd {
    toString() {
      return 'odd one'
    }
  }
  const values: any[] = [
    'plain words',
    '',
    '  ',
    0,
    -0,
    12.5,
    NaN,
    true,
    false,
    10n,
    null,
    undefined,
    new Boolean(false),
    new String('wrapped'),
    new Number(3),
    { v: 'looks like a hit', i: 9 },
    new Odd(),
    [],
    ['a', 'b c'],
    ['a', , 'b'],
    [null, undefined, '', ' ', 'x'],
    [0, -0, 1n, true, new Boolean(true), new String('s')],
    [['n', ['m']], { v: 'w' }, new Odd()],
    Object.assign(['p', 'q'], { extra: 'not an index' })
  ]
  test('every value kind, docs that are not objects, odd key paths', () => {
    let seed = 41
    const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647
    const pick = () => values[Math.floor(rnd() * values.length)]
    const docs: any[] = [{ a: 'first', b: ['x'] }]
    for (let k = 0; k < 300; k++) {
      const r = rnd()
      docs.push(
        r < 0.03 ? null : r < 0.06 ? 'a string doc' : r < 0.08 ? 7 : { a: pick(), b: pick(), length: pick(), '': pick() }
      )
    }
    const keySets: any[] = [
      ['a', 'b'],
      [['a'], 'length'],
      ['a.', ['b', '']],
      [[''], 'b'],
      [[], 'a'],
      [[0], 'b'],
      [{ name: 'a', weight: 2 }, { name: ['b'] }]
    ]
    for (const keys of keySets) {
      for (const extra of [{}, { getFn: Fuse.config.getFn }, { useTokenSearch: true }]) {
        const opts = { keys, ...extra }
        const a = new Fuse(docs.slice(), opts)
        const b = new BaselineFuse(docs.slice(), opts)
        expect(json(a)).toBe(json(b))
        for (const d of docs.slice(0, 40)) {
          a.add(d)
          b.add(d)
        }
        expect(json(a)).toBe(json(b))
        const big = (_: string, v: any) =>
          typeof v === 'bigint' ? 'bigint ' + v : v
        expect(JSON.stringify(a.search('words'), big)).toBe(
          JSON.stringify(b.search('words'), big)
        )
      }
    }
  })

  test('custom getFn, global or per key, keeps the generic path', () => {
    const docs = [{ a: ['x', 'y'], b: 'z' }, { a: 'w', b: ['v'] }]
    const keyGetFn = function (this: any, d: any) {
      return this.name === 'a' ? d.a : ['k']
    }
    const optsList: any[] = [
      { keys: ['a', 'b'], getFn: (d: any, p: any) => (p[0] === 'a' ? ['g'] : d.b) },
      { keys: [{ name: 'a', getFn: keyGetFn }, 'b'] }
    ]
    for (const opts of optsList) {
      expect(json(new Fuse(docs, opts))).toBe(json(new BaselineFuse(docs, opts)))
    }
  })

  test('reads, getters, Proxy traps and toString calls happen in the same order', () => {
    const run = (F: any) => {
      const log: string[] = []
      const obj = (name: string) => ({
        toString() {
          log.push('toString ' + name)
          return name
        }
      })
      const arr = new Proxy(['s0', obj('o1'), , 's3', obj('o4')], {
        get(t: any, k) {
          log.push('get ' + String(k))
          return t[k]
        },
        has(t: any, k) {
          log.push('has ' + String(k))
          return k in t
        }
      })
      const doc = {
        get a() {
          log.push('read a')
          return arr
        },
        get b() {
          log.push('read b')
          return obj('lone')
        },
        get c() {
          log.push('read c')
          return 5
        }
      }
      const f = new F([doc], { keys: ['a', 'b', 'c'] })
      return JSON.stringify([log, f.getIndex().toJSON()])
    }
    expect(run(Fuse)).toBe(run(BaselineFuse))
  })
})

describe('FuseIndex.removeAll accepts any iterable, like the baseline (D1)', () => {
  const strs = ['a0', 'b1', 'c2', 'd3', 'e4']
  function* gen() {
    yield 3
    yield 1
    yield 3
  }
  test.each([
    ['Set', () => new Set([1, 2])],
    ['generator', () => gen()],
    ['Int32Array', () => new Int32Array([4, 0])],
    ['Float64Array', () => new Float64Array([1.5, 2, -1])],
    ['Map keys', () => new Map([[0, 'x'], [2, 'y']]).keys()],
    ['string', () => '12']
  ])('%s', (_name, make) => {
    const a = Fuse.createIndex([], strs)
    const b = BaselineFuse.createIndex([], strs)
    a.removeAll(make() as any)
    b.removeAll(make() as any)
    expect(JSON.stringify(a.toJSON())).toBe(JSON.stringify(b.toJSON()))
  })
})

describe('FuseIndex.removeAll with one record object listed twice (D3)', () => {
  test('shared records in a parsed index match the baseline', () => {
    for (const removeIdx of [[0], [1], [2], [0, 3], [5], [1, 2, 3]]) {
      const build = (F: any) => {
        const s = { i: 2, $: { 0: { v: 's', n: 1 } } }
        const r = (i: number) => ({ i, $: { 0: { v: 'r' + i, n: 1 } } })
        const idx = F.parseIndex({
          keys: [{ path: ['k'], id: 'k', weight: 1, src: 'k' }],
          records: [r(0), s, r(3), s, r(4)]
        })
        idx.removeAll(removeIdx)
        return JSON.stringify(idx.toJSON())
      }
      expect(build(Fuse)).toBe(build(BaselineFuse))
    }
  })
})

describe('index creation reads item.v as often as the baseline (D2)', () => {
  const run = (F: any, values: any[]) => {
    let n = 0
    const log: string[] = []
    const items = values.map((val, i) => ({
      get v() {
        n++
        log.push('v' + i)
        return typeof val === 'function' ? val(n) : val
      },
      get i() {
        log.push('i' + i)
        return i
      }
    }))
    let rec: any
    try {
      const f = new F([{}], { keys: [{ name: 'k', getFn: () => items }] })
      rec = f.getIndex().toJSON().records
    } catch (e: any) {
      rec = `${e.constructor.name}: ${e.message}`
    }
    return JSON.stringify({ rec, n, log })
  }
  test.each([
    ['stateful string', [(n: number) => (n === 1 ? 'first' : 'later')]],
    ['stateful number', [(n: number) => (n === 1 ? 1 : n === 2 ? 'two' : 3)]],
    ['nullish then string', [(n: number) => (n === 1 ? null : 'x')]],
    ['string then nullish', [(n: number) => (n === 1 ? 'x' : undefined)]],
    ['plain values', ['a', 5, null, undefined, '  ', 0, -0, 10n, true]]
  ])('%s', (_name, values) => {
    expect(run(Fuse, values as any[])).toBe(run(BaselineFuse, values as any[]))
  })
})

describe('isBlank on non-strings behaves like trim()', () => {
  const ref = (value: any) => !value.trim().length
  const outcome = (f: (v: any) => boolean, v: any) => {
    try {
      return String(f(v))
    } catch (e: any) {
      return `${e.constructor.name}: ${e.message}`
    }
  }
  test.each([
    [5],
    [null],
    [undefined],
    [Symbol('s')],
    [{}],
    [{ trim: () => '' }],
    [{ trim: () => 'x' }],
    [new String('  ')],
    [new String('ab')],
    [['a']],
    ['\ufeffa'],
    ['\u3000'],
    ['\x7f'],
    ['~']
  ])('%s', (v) => {
    expect(outcome(isBlank as any, v)).toBe(outcome(ref, v))
  })
})
