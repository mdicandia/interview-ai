import type { CompareMode } from '@/lib/problems/types'

/**
 * Structural equality over JSON-shaped values.
 *
 * Both workers convert their native return value to plain JS before comparing, so
 * this is the single implementation for every language — a Python list and a JS
 * array of the same numbers compare equal without any per-language special casing.
 */
export function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true

  // NaN !== NaN, but two NaN results should be considered the same answer.
  if (typeof a === 'number' && typeof b === 'number') {
    return Number.isNaN(a) && Number.isNaN(b)
  }

  if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') {
    return false
  }

  if (Array.isArray(a) !== Array.isArray(b)) return false

  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false
    return a.every((item, i) => deepEqual(item, b[i]))
  }

  const aObj = a as Record<string, unknown>
  const bObj = b as Record<string, unknown>
  const aKeys = Object.keys(aObj)
  const bKeys = Object.keys(bObj)
  if (aKeys.length !== bKeys.length) return false
  return aKeys.every(
    (k) => Object.prototype.hasOwnProperty.call(bObj, k) && deepEqual(aObj[k], bObj[k]),
  )
}

/** Stable key for multiset comparison. Sorts object keys so field order is irrelevant. */
function canonical(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'undefined'
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  const obj = value as Record<string, unknown>
  const entries = Object.keys(obj)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${canonical(obj[k])}`)
  return `{${entries.join(',')}}`
}

/** Top-level arrays compared as multisets — same elements, any order, duplicates counted. */
function unorderedEqual(a: unknown, b: unknown): boolean {
  if (!Array.isArray(a) || !Array.isArray(b)) return deepEqual(a, b)
  if (a.length !== b.length) return false
  const left = a.map(canonical).sort()
  const right = b.map(canonical).sort()
  return left.every((v, i) => v === right[i])
}

export function matches(actual: unknown, expected: unknown, mode: CompareMode): boolean {
  return mode === 'unordered' ? unorderedEqual(actual, expected) : deepEqual(actual, expected)
}

/** Compact rendering for the results panel. */
export function formatValue(value: unknown): string {
  if (value === undefined) return 'undefined'
  try {
    return JSON.stringify(value) ?? String(value)
  } catch {
    return String(value)
  }
}
