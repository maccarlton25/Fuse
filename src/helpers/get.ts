import {
  isDefined,
  isString,
  isNumber,
  isBoolean,
  isArray,
  toString
} from './typeGuards'

const isLeaf = (value: any): boolean =>
  isString(value) ||
  isNumber(value) ||
  isBoolean(value) ||
  typeof value === 'bigint'

// Generic walk, used once an array is met along the path. Every hit is
// pushed as `{ v, i }`, where `i` is the index in the innermost array.
function deepGet(
  list: any[],
  obj: any,
  path: string[],
  index: number,
  arrayIndex: number
): void {
  if (!isDefined(obj)) {
    return
  }
  if (!path[index]) {
    // If there's no path left, we've arrived at the object we care about.
    list.push({ v: obj, i: arrayIndex })
  } else {
    const value = obj[path[index]]

    if (!isDefined(value)) {
      return
    }

    // If we're at the last value in the path, and if it's a string/number/bool,
    // add it to the list
    if (index === path.length - 1 && isLeaf(value)) {
      list.push({ v: toString(value), i: arrayIndex })
    } else if (isArray(value)) {
      // Search each item in the array.
      for (let i = 0, len = value.length; i < len; i += 1) {
        deepGet(list, value[i], path, index + 1, i)
      }
    } else {
      // An object. Recurse further.
      deepGet(list, value, path, index + 1, arrayIndex)
    }
  }
}

export default function get(obj: any, path: string | string[]): any {
  // Backwards compatibility (since path used to be a string)
  if (isString(path)) path = path.split('.')

  // Walk plain (non-array) segments without allocating; switch to the
  // generic walk at the first array, which always yields a list.
  for (let index = 0; ; index++) {
    if (!isDefined(obj)) {
      return
    }
    if (!path[index]) {
      return obj
    }
    const value = obj[path[index]]
    if (!isDefined(value)) {
      return
    }
    if (index === path.length - 1 && isLeaf(value)) {
      return toString(value)
    }
    if (isArray(value)) {
      // deepGet re-reads `value` and takes its array branch.
      const list: any[] = []
      deepGet(list, obj, path, index, 0)
      return list
    }
    obj = value
  }
}
