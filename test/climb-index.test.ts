import get from '../src/helpers/get'
import norm from '../src/tools/fieldNorm'
import { isBlank } from '../src/helpers/typeGuards'
import FuseIndex from '../src/tools/FuseIndex'

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
