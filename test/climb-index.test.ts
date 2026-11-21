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
