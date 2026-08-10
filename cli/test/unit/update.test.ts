import { describe, expect, it } from "vitest"
import { packageUpdateResult, updateSyncArgs } from "../../src/commands/update"

describe("update chained sync", () => {
  it("uses the fresh package entrypoint and skips refresh-only plugin work", () => {
    expect(updateSyncArgs("/kit")).toEqual([
      "/kit/cli/src/main.ts",
      "sync",
      "--skip-plugin-refresh"
    ])
  })
})

describe("package update result", () => {
  it("reports an unchanged installed version as already current", () => {
    expect(packageUpdateResult("0.14.3", "0.14.3")).toEqual({
      alreadyCurrent: true,
      message: "Already at the latest version (0.14.3)."
    })
  })

  it("reports the installed version change", () => {
    expect(packageUpdateResult("0.14.2", "0.14.3")).toEqual({
      alreadyCurrent: false,
      message: "Updated 0.14.2 -> 0.14.3."
    })
  })

  it("keeps the existing update flow when either version is unavailable", () => {
    expect(packageUpdateResult("", "0.14.3")).toEqual({
      alreadyCurrent: false,
      message: ""
    })
    expect(packageUpdateResult("0.14.2", "")).toEqual({
      alreadyCurrent: false,
      message: ""
    })
  })
})
