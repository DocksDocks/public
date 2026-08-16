import { existsSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { afterAll, describe, expect, it } from "vitest"

import { checkedSpawnExitCode, readArgvLog, runEngine } from "../lib/goldenExecution"
import { childHostId, cleanupTemporaryDirs, makeStubDir, readStubHost } from "../lib/goldenResources"

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

describe("stub host pairing", () => {
  afterAll(() => {
    cleanupTemporaryDirs()
  })

  it("plants launchers for the host the child runs as, not for the recording host", () => {
    const preloaded = makeStubDir()

    expect(readStubHost(preloaded)).toBe("linux")
    // The Linux-canonical child resolves extensionless names on every recording host.
    expect(existsSync(join(preloaded, "git"))).toBe(true)
  })

  it("records the native host so a native run pairs on any recording host", () => {
    expect(readStubHost(makeStubDir({}, { nativeHost: true }))).toBe(childHostId(true))
  })

  it("fails before spawning when the planted host is not the host the child runs as", () => {
    // Written, not recorded on a foreign machine: the canonical child is always
    // Linux, so a Windows marker is a mismatch on every runner - including a
    // Linux one, where the native and canonical hosts are the same id.
    const stubs = makeStubDir()
    writeFileSync(join(stubs, ".golden-stub-host"), "windows\n")

    expect(() => runEngine(["--version"], "home-fresh", stubs)).toThrow(
      /stub host mismatch: stubs were planted for windows but this child runs as linux/
    )
  })
})
