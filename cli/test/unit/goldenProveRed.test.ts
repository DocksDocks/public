import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it } from "vitest"

import { readGolden, selectProveRedMismatch } from "../lib/goldenProveRed"

const temporaryPaths: Array<string> = []

afterEach(() => {
  for (const path of temporaryPaths.splice(0)) rmSync(path, { recursive: true, force: true })
})

describe("golden prove-red support", () => {
  it("does not accept an invariant-only failure as proof of a comparator mismatch", () => {
    const proof = selectProveRedMismatch({ selected: "expected", other: "planted" })

    expect(proof.result()).toEqual({
      comparedCases: 0,
      comparatorMismatches: 0,
      succeeded: false
    })
  })

  it("requires a compared case that actually mismatches", () => {
    const proof = selectProveRedMismatch({ selected: "expected", other: "planted" })

    expect(proof.expectedFor("selected")).toBe("planted")
    proof.recordComparison(false)
    expect(proof.result().succeeded).toBe(false)
    proof.recordComparison(true)
    expect(proof.result()).toEqual({
      comparedCases: 2,
      comparatorMismatches: 1,
      succeeded: true
    })
  })

  it("loads a version-1 golden file", () => {
    const root = mkdtempSync(join(tmpdir(), "docks-golden-reader-"))
    temporaryPaths.push(root)
    const path = join(root, "nested", "golden.json")
    mkdirSync(join(root, "nested"))
    writeFileSync(path, JSON.stringify({ version: 1, cases: { one: { value: 1 } } }))

    expect(readGolden<{ value: number }>(path)).toEqual({
      version: 1,
      cases: { one: { value: 1 } }
    })
  })
})
