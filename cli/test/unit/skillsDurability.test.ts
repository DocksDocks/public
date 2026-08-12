import { mkdirSync, mkdtempSync, readFileSync, readlinkSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type * as ExecModule from "../../src/engine-native/exec"

const mocks = vi.hoisted(() => ({
  payloadText: vi.fn<(path: string) => string>(),
  spawnProcess: vi.fn()
}))

vi.mock("../../src/payload", () => ({ payloadText: mocks.payloadText }))
vi.mock("../../src/engine-native/exec", async () => {
  const actual = await vi.importActual<typeof ExecModule>("../../src/engine-native/exec")
  return { ...actual, spawnProcess: mocks.spawnProcess }
})

import type { Ctx } from "../../src/engine-native"
import { linkOrCopy, skillsSync } from "../../src/engine-native/skillsSync"
import { makeDependencyManager, makeEngineServices, makePlatform } from "../../src/engine-native/services"

const roots: Array<string> = []

function makeCtx(root: string): Ctx {
  const platform = makePlatform("linux")
  const services = {
    ...makeEngineServices({ sinks: { stderr: () => {}, stdout: () => {} } }),
    deps: makeDependencyManager(platform, {
      commandExists: (name) => name === "npx",
      capture: async () => "",
      which: (name) => (name === "npx" ? "/usr/bin/npx" : "")
    }),
    platform
  }
  return {
    home: root,
    agentsDir: join(root, ".agents"),
    dryRun: false,
    prune: true,
    verbose: false,
    services,
    nextStepTriggers: { skillsRestart: false }
  } as Ctx
}

describe("skills durability", () => {
  beforeEach(() => {
    mocks.spawnProcess.mockReset()
    mocks.payloadText.mockReset().mockImplementation((path) => {
      if (path === "SoT/.agents/skills.txt") return ""
      if (path === "SoT/.claude/settings.json") return '{"enabledPlugins":{}}'
      if (path === "SoT/toolchain.json") return '{"tools":{"skills-cli":{"verified":"1.5.15"}}}'
      throw new Error(`Unexpected payload: ${path}`)
    })
  })

  afterEach(() => {
    for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
  })

  it("preserves a regular file when the link source and destination resolve to the same path", () => {
    const root = mkdtempSync(join(tmpdir(), "docks-skills-same-path-"))
    roots.push(root)
    const executable = join(root, "bun")
    writeFileSync(executable, "user bun\n")

    expect(linkOrCopy(executable, executable)).toBe(true)
    expect(readFileSync(executable, "utf8")).toBe("user bun\n")
    expect(() => readlinkSync(executable)).toThrow()
  })

  it("retains a failed removal in the snapshot and retries it on the next prune", async () => {
    const root = mkdtempSync(join(tmpdir(), "docks-skills-prune-retry-"))
    roots.push(root)
    const ctx = makeCtx(root)
    mkdirSync(ctx.agentsDir, { recursive: true })
    const snapshot = join(ctx.agentsDir, ".kit-managed-skills")
    writeFileSync(snapshot, "acme/orphan\n")
    mocks.spawnProcess
      .mockResolvedValueOnce({ error: new Error("remove failed"), exitCode: 1, stdout: "", stderr: "" })
      .mockResolvedValueOnce({ error: undefined, exitCode: 0, stdout: "", stderr: "" })

    await skillsSync(ctx)
    expect(readFileSync(snapshot, "utf8")).toBe("acme/orphan\n")

    await skillsSync(ctx)
    expect(mocks.spawnProcess).toHaveBeenCalledTimes(2)
    expect(mocks.spawnProcess).toHaveBeenNthCalledWith(
      2,
      "npx",
      ["--yes", "skills@1.5.15", "remove", "--global", "orphan", "-y"],
      { stdio: "ignore" }
    )
    expect(readFileSync(snapshot, "utf8")).toBe("")
  })
})
