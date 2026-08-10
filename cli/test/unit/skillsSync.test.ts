import { beforeEach, describe, expect, it, vi } from "vitest"
import type * as ExecModule from "../../src/engine-native/exec"

const mocks = vi.hoisted(() => ({
  lstatSync: vi.fn(),
  spawnProcess: vi.fn(),
  symlinkSync: vi.fn()
}))

vi.mock("../../src/engine-native/exec", async () => {
  const actual = await vi.importActual<typeof ExecModule>("../../src/engine-native/exec")
  return { ...actual, spawnProcess: mocks.spawnProcess }
})
vi.mock("node:fs", async () => {
  const actual = await vi.importActual<typeof import("node:fs")>("node:fs")
  return { ...actual, lstatSync: mocks.lstatSync, symlinkSync: mocks.symlinkSync }
})

import type { Ctx } from "../../src/engine-native"
import { effectSolutionsInstall, linkOrCopy } from "../../src/engine-native/skillsSync"
import { makeDependencyManager, makeEngineServices, makePlatform } from "../../src/engine-native/services"

function servicesFor(platform: NodeJS.Platform) {
  return {
    ...makeEngineServices({
      sinks: { stderr: () => {}, stdout: () => {} }
    }),
    platform: makePlatform(platform)
  }
}

describe("skills platform behavior", () => {
  beforeEach(() => {
    mocks.lstatSync.mockReset().mockReturnValue({ isSymbolicLink: () => true })
    mocks.symlinkSync.mockReset()
    mocks.spawnProcess.mockReset().mockResolvedValue({
      error: undefined,
      exitCode: 0,
      stdout: "",
      stderr: ""
    })
  })

  it("uses a portable directory symlink", () => {
    expect(linkOrCopy("target", "link")).toBe(true)
    expect(mocks.symlinkSync).toHaveBeenCalledWith("target", "link")
  })

  it("retains the known Bun bin directory when effect-solutions has no executable", async () => {
    const globalBin = "/bun/global/bin"
    const lines: Array<string> = []
    const platform = makePlatform("linux")
    const deps = makeDependencyManager(platform, {
      commandExists: () => false,
      capture: async (cmd, args) => (cmd === "bun" && args.join(" ") === "pm -g bin" ? globalBin : ""),
      which: (name) => (name === "bun" ? "/usr/bin/bun" : "")
    })
    const services = {
      ...makeEngineServices({ sinks: { stderr: (chunk) => void lines.push(chunk), stdout: () => {} } }),
      deps,
      platform
    }
    const ctx = { home: "/fixture-home", services } as Ctx

    expect(await effectSolutionsInstall(ctx)("install", "0.5.3", services)).toBe(0)
    expect(lines).toEqual([
      `\x1b[1;32m[ok]\x1b[0m Installing effect-solutions CLI via bun (pinned 0.5.3)...\n`,
      `\x1b[1;33m[warn]\x1b[0m effect-solutions installed but binary not found under '${globalBin}' — link it onto PATH manually\n`
    ])
  })
})
