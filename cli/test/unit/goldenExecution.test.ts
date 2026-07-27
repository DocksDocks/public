import { describe, expect, it } from "vitest"

import { checkedSpawnExitCode } from "../lib/goldenExecution"

describe("checkedSpawnExitCode", () => {
  it("returns a numeric spawn status", () => {
    expect(checkedSpawnExitCode("bash", { status: 7, signal: null })).toBe(7)
  })

  it("retains an ETIMEDOUT spawn error", () => {
    const error = Object.assign(new Error("spawnSync bash ETIMEDOUT"), { code: "ETIMEDOUT" })

    expect(() => checkedSpawnExitCode("bash", { status: null, signal: null, error })).toThrow(
      "bash failed to spawn: Error: spawnSync bash ETIMEDOUT"
    )
    expect(error.code).toBe("ETIMEDOUT")
  })

  it("reports the killing signal when no status is available", () => {
    expect(() => checkedSpawnExitCode("bash", { status: null, signal: "SIGTERM" })).toThrow(
      "bash terminated by signal SIGTERM"
    )
  })

  it("rejects a result with neither status nor signal", () => {
    expect(() => checkedSpawnExitCode("bash", { status: null, signal: null })).toThrow(
      "bash completed without status or signal"
    )
  })
})
