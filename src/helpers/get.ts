import {
  isDefined,
  isString,
  isNumber,
  isBoolean,
  isArray,
  toString
} from './typeGuards'

export const isLeaf = (value: any): boolean =>
  isString(value) ||
  isNumber(value) ||
  isBoolean(value) ||
  typeof value === 'bigint'

// Walks `path` from `index`, reading each segment once. Until an array is
// met (`list` undefined) the single hit is returned as is and nothing is
// allocated; from the first array on, every hit is pushed to `list` as
// `{ v, i }`, where `i` is the index in the innermost array.
function walk(
  obj: any,
  path: string[],
  index: number,
  list?: any[],
  arrayIndex?: number
): any {
  for (; ; index++) {
    if (!isDefined(obj)) {
      return list
    }
    // If there's no path left, we've arrived at the object we care about.
    if (!path[index]) {
      break
    }
    // A missing value ends the walk at the top of the next turn.
    const value = obj[path[index]]
    // If we're at the last value in the path, and if it's a
    // string/number/bool, it is the hit.
    if (index === path.length - 1 && isLeaf(value)) {
      obj = toString(value)
      break
    }
    if (isArray(value)) {
      // Search each item in the array.
      list = list || []
      for (let i = 0, len = value.length; i < len; i += 1) {
        walk(value[i], path, index + 1, list, i)
      }
      return list
    }
    // An object. Recurse further.
    obj = value
  }
  if (!list) {
    return obj
  }
  list.push({ v: obj, i: arrayIndex })
  return list
}

export default function get(obj: any, path: string | string[]): any {
  // Backwards compatibility (since path used to be a string)
  return walk(obj, isString(path) ? path.split('.') : path, 0)
}
