import { describe, expect, it } from "vitest"

import { checkedSpawnExitCode, readArgvLog } from "../lib/goldenExecution"

describe("checkedSpawnExitCode", () => {
  it("returns a numeric spawn status", () => {
    expect(checkedSpawnExitCode("bash", { status: 7, signal: null })).toBe(7)
  })

  it("classifies an ETIMEDOUT spawn error before a numeric status", () => {
    const error = Object.assign(new Error("spawnSync bash ETIMEDOUT"), { code: "ETIMEDOUT" })

    expect(() => checkedSpawnExitCode("bash", { status: 130, signal: "SIGTERM", error })).toThrow(
      "bash timed out: Error: spawnSync bash ETIMEDOUT"
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

describe("readArgvLog", () => {
  it("fails when command instrumentation is missing", () => {
    const run = {
      exitCode: 0,
      output: "",
      stdout: "",
      home: "/missing-home",
      argvLog: "/missing-home/.golden-argv.log"
    }

    expect(() => readArgvLog(run)).toThrow()
  })
})
