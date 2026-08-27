/**
 * `omp plugin list --json` keys marketplace rows on a composite `id`
 * ("<plugin>@<marketplace>") and npm rows on `name` plus `version`. Reading the
 * wrong field turns every run into a failing reinstall, so these rows pin the
 * install / upgrade / skip decision that the inventory drives.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type * as ExecModule from "../../src/engine-native/exec"

const mocks = vi.hoisted(() => ({
  payloadText: vi.fn<(path: string) => string>(),
  spawnProcess: vi.fn()
}))

vi.mock("../../src/payload", () => ({
  payloadText: mocks.payloadText,
  payloadDisplayPath: (path: string) => `embedded:${path}`
}))
vi.mock("../../src/engine-native/exec", async () => {
  const actual = await vi.importActual<typeof ExecModule>("../../src/engine-native/exec")
  return { ...actual, spawnProcess: mocks.spawnProcess }
})
vi.mock("../../src/engine-native/bun", () => ({
  bunBootstrap: async () => ({ kind: "ready", executable: "bun" })
}))

import type { Ctx } from "../../src/engine-native"
import { ompSync } from "../../src/engine-native/ompSync"
import { makeDependencyManager, makeEngineServices, makePlatform } from "../../src/engine-native/services"

const PIN = "0.10.0"
const roots: Array<string> = []

const INVENTORY_PRESENT = JSON.stringify({
  npm: [{ name: "pi-intercom", version: PIN }],
  marketplace: [
    { id: "docks@docks", scope: "user", entries: [{ version: "0.18.0" }] },
    { id: "plan-lifecycle@docks", scope: "user", entries: [{ version: "0.9.0" }] }
  ]
})
const INVENTORY_EMPTY = JSON.stringify({ npm: [], marketplace: [] })

function makeRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "docks-omp-inventory-"))
  roots.push(root)
  // Pre-register the marketplace so the plugin pass is the only spawn source.
  mkdirSync(join(root, ".omp"), { recursive: true })
  writeFileSync(join(root, ".omp", "marketplaces.json"), JSON.stringify({ docks: { source: "git" } }))
  return root
}

function makeCtx(root: string, options: { skipPluginRefresh?: boolean } = {}): Ctx {
  const platform = makePlatform("linux")
  const services = {
    ...makeEngineServices({ sinks: { stderr: () => {}, stdout: () => {} } }),
    deps: makeDependencyManager(platform, {
      commandExists: () => true,
      capture: async () => "",
      which: (name) => `/usr/bin/${name}`
    }),
    platform
  }
  return {
    home: root,
    agentsDir: join(root, ".agents"),
    dryRun: false,
    verbose: false,
    prune: false,
    skipPluginRefresh: options.skipPluginRefresh ?? false,
    services,
    nextStepTriggers: { ompRestart: false }
  } as unknown as Ctx
}

/** Every `omp` argv the pipeline spawned, as one joined string per call. */
function ompCommands(): Array<string> {
  return mocks.spawnProcess.mock.calls.map((call) => (call[1] as ReadonlyArray<string>).join(" "))
}

function respondWithInventory(inventory: string): void {
  mocks.spawnProcess.mockImplementation(async (_cmd: string, args: ReadonlyArray<string>) => ({
    error: undefined,
    exitCode: 0,
    stdout: args[0] === "plugin" && args[1] === "list" ? inventory : "",
    stderr: ""
  }))
}

describe("omp plugin inventory", () => {
  beforeEach(() => {
    mocks.payloadText.mockReset().mockImplementation((path) => {
      if (path === "SoT/.omp/AGENTS.md") return "# omp\n"
      if (path === "SoT/.omp/mcp.json") return "{}\n"
      if (path === "SoT/.omp/config.yml") return "theme: dark\n"
      if (path === "SoT/.omp/intercom.json") return "{}\n"
      if (path === "SoT/toolchain.json") return `{"tools":{"pi-intercom":{"verified":"${PIN}"}}}`
      throw new Error(`Unexpected payload: ${path}`)
    })
    mocks.spawnProcess.mockReset()
  })

  afterEach(() => {
    for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
  })

  it("upgrades marketplace plugins already named by a composite id", async () => {
    respondWithInventory(INVENTORY_PRESENT)
    const state = await ompSync(makeCtx(makeRoot()))

    expect(ompCommands()).toEqual([
      "plugin marketplace update docks",
      "plugin list --json",
      "plugin upgrade --scope user docks@docks",
      "plugin upgrade --scope user plan-lifecycle@docks"
    ])
    expect(state.pluginsInstalled).toBe(3)
  })

  it("installs every plugin when the inventory is empty", async () => {
    respondWithInventory(INVENTORY_EMPTY)
    const state = await ompSync(makeCtx(makeRoot()))

    expect(ompCommands()).toEqual([
      "plugin marketplace update docks",
      "plugin list --json",
      "plugin install --scope user docks@docks",
      "plugin install --scope user plan-lifecycle@docks",
      `install pi-intercom@${PIN}`
    ])
    expect(state.pluginsInstalled).toBe(3)
  })

  it("reinstalls pi-intercom with --force when the installed version misses the pin", async () => {
    respondWithInventory(
      JSON.stringify({ npm: [{ name: "pi-intercom", version: "0.9.0" }], marketplace: [] })
    )
    await ompSync(makeCtx(makeRoot()))

    expect(ompCommands()).toContain(`install --force pi-intercom@${PIN}`)
  })

  it("skips every refresh of present plugins under --skip-plugin-refresh", async () => {
    respondWithInventory(INVENTORY_PRESENT)
    const state = await ompSync(makeCtx(makeRoot(), { skipPluginRefresh: true }))

    expect(ompCommands()).toEqual(["plugin list --json"])
    expect(state.pluginsInstalled).toBe(3)
  })

  it("still installs a missing plugin under --skip-plugin-refresh", async () => {
    respondWithInventory(
      JSON.stringify({ npm: [], marketplace: [{ id: "docks@docks", scope: "user", entries: [] }] })
    )
    await ompSync(makeCtx(makeRoot(), { skipPluginRefresh: true }))

    expect(ompCommands()).toEqual([
      "plugin list --json",
      "plugin install --scope user plan-lifecycle@docks",
      `install pi-intercom@${PIN}`
    ])
  })

  it("falls back to the full refresh path when the inventory cannot be parsed", async () => {
    respondWithInventory("not json")
    await ompSync(makeCtx(makeRoot()))

    expect(ompCommands()).toEqual([
      "plugin marketplace update docks",
      "plugin list --json",
      "plugin install --scope user docks@docks",
      "plugin install --scope user plan-lifecycle@docks",
      `install pi-intercom@${PIN}`
    ])
  })
})
