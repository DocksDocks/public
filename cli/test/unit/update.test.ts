import { describe, expect, it } from "vitest"
import { updateSyncArgs } from "../../src/commands/update"

describe("update chained sync", () => {
  it("uses the fresh package entrypoint and skips refresh-only plugin work", () => {
    expect(updateSyncArgs("/kit")).toEqual([
      "/kit/cli/src/main.ts",
      "sync",
      "--skip-plugin-refresh"
    ])
  })
})
