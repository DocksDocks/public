/**
 * jq-semantics primitives for EngineNative.
 *
 * Some deployed JSON contracts were defined by jq behavior, so EngineNative
 * reproduces three jq behaviors exactly:
 *   - `*` (recursive object merge): right side wins; objects merge
 *     recursively; arrays and scalars are REPLACED, never concatenated;
 *     merged key order = left object's order, then right-only keys appended.
 *   - `unique`: sorts (jq's total order — for our string arrays, Unicode
 *     codepoint order) and deduplicates.
 *   - output formatting: 2-space indent, UTF-8 raw, trailing newline.
 */

export type Json = null | boolean | number | string | Array<Json> | { [key: string]: Json }

export function isObject(v: Json): v is { [key: string]: Json } {
  return typeof v === "object" && v !== null && !Array.isArray(v)
}

/** jq `$left * $right`. */
export function deepMerge(left: Json, right: Json): Json {
  if (!isObject(left) || !isObject(right)) return right
  const out: { [key: string]: Json } = { ...left }
  for (const [k, v] of Object.entries(right)) {
    const lv = out[k]
    out[k] = lv !== undefined && isObject(lv) && isObject(v) ? deepMerge(lv, v) : v
  }
  return out
}

/** jq `unique` over an array of strings: codepoint sort + dedup. */
export function uniqueStrings(arr: Array<string>): Array<string> {
  return [...new Set(arr)].sort(compareCodepoints)
}

export function compareCodepoints(a: string, b: string): number {
  const ia = a[Symbol.iterator]()
  const ib = b[Symbol.iterator]()
  for (;;) {
    const ra = ia.next()
    const rb = ib.next()
    if (ra.done && rb.done) return 0
    if (ra.done) return -1
    if (rb.done) return 1
    const ca = ra.value.codePointAt(0)!
    const cb = rb.value.codePointAt(0)!
    if (ca !== cb) return ca - cb
  }
}

/** jq's default pretty-printer for the documents this kit writes. */
export function jqStringify(v: Json): string {
  return `${JSON.stringify(v, null, 2)}\n`
}

/** jq `empty` validation: parse or null. */
export function parseJson(text: string): Json | undefined {
  try {
    return JSON.parse(text) as Json
  } catch {
    return undefined
  }
}
