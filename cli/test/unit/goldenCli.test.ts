import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { labelSelected, parseArgs } from "../lib/goldenCli"

const ORIGINAL_GOLDEN_FILTER = process.env["GOLDEN_FILTER"]

beforeEach(() => {
  delete process.env["GOLDEN_FILTER"]
  vi.spyOn(process, "exit").mockImplementation((code) => {
    throw new Error(`exit ${String(code)}`)
  })
  vi.spyOn(console, "error").mockImplementation(() => undefined)
})

afterEach(() => {
  if (ORIGINAL_GOLDEN_FILTER === undefined) delete process.env["GOLDEN_FILTER"]
  else process.env["GOLDEN_FILTER"] = ORIGINAL_GOLDEN_FILTER
  vi.restoreAllMocks()
})

describe("golden CLI options", () => {
  it("compiles GOLDEN_FILTER once and reuses the same RegExp for selections", () => {
    process.env["GOLDEN_FILTER"] = "^selected-case$"

    const options = parseArgs(["bun", "golden-suite.ts"])
    const compiledFilter = options.filter

    expect(compiledFilter).toBeInstanceOf(RegExp)
    expect(labelSelected("selected-case", options.filter)).toBe(true)
    expect(labelSelected("other-case", options.filter)).toBe(false)
    expect(options.filter).toBe(compiledFilter)
  })

  it("selects matching labels and rejects non-matching labels", () => {
    const filter = /^fixture=home-fresh /

    expect(labelSelected("fixture=home-fresh cmd=sync agents", filter)).toBe(true)
    expect(labelSelected("fixture=home-existing cmd=sync agents", filter)).toBe(false)
  })

  it("rejects unknown options", () => {
    expect(() => parseArgs(["bun", "golden-suite.ts", "--unknown"])).toThrow("exit 2")
    expect(console.error).toHaveBeenCalledWith("unknown option(s): --unknown")
  })

  it("rejects prove-red and golden updates together", () => {
    expect(() =>
      parseArgs(["bun", "golden-suite.ts", "--prove-red", "--update-goldens"])
    ).toThrow("exit 2")
    expect(console.error).toHaveBeenCalledWith(
      "--prove-red and --update-goldens are mutually exclusive"
    )
  })

  it("reports an invalid GOLDEN_FILTER exactly and exits 2", () => {
    process.env["GOLDEN_FILTER"] = "["
    let regexError = ""
    try {
      new RegExp("[")
    } catch (error) {
      regexError = error instanceof Error ? error.message : String(error)
    }


    expect(() => parseArgs(["bun", "golden-suite.ts"])).toThrow("exit 2")
    expect(console.error).toHaveBeenCalledWith(`invalid GOLDEN_FILTER '[': ${regexError}`)
  })
})
