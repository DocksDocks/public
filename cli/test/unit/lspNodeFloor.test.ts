import { afterAll, describe, expect, it } from "vitest"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import type { Ctx } from "../../src/engine-native"
import { syncLspServers } from "../../src/engine-native/claudePlugins"
import { DEPENDENCIES, type ToolId } from "../../src/engine-native/deps"
import { p } from "../../src/engine-native/exec"
import { makeLogger } from "../../src/engine-native/logger"
import { makePlatform, type EngineServices } from "../../src/engine-native/services"
import { kitHome } from "../../src/kitHome"

type Sinks = { readonly out: Array<string>; readonly err: Array<string> }

/**
 * The typescript-lsp plugin is enabled in SoT, its server binary is absent, and
 * every other LSP tool is present. That isolates the single install decision
 * the Node floor governs.
 */
function lspCtx(nodeVersion: string, missing: ReadonlyArray<ToolId>, sinks: Sinks): Ctx {
  const home = mkdtempSync(join(tmpdir(), "docks-lsp-floor-"))
  const services: EngineServices = {
    logger: makeLogger({
      stderr: (chunk) => void sinks.err.push(chunk.replace(/\n$/, "")),
      progress: () => {},
      stdout: (chunk) => void sinks.out.push(chunk.replace(/\n$/, ""))
    }),
    platform: makePlatform("linux"),
    deps: {
      spec: (id) => DEPENDENCIES[id],
      probe: (id) => ({ state: missing.includes(id) ? "missing" : "present" }),
      version: async (id) => (id === "node" ? nodeVersion : ""),
      path: async () => "",
      warnMissing: () => {}
    }
  }
  return {
    repoDir: kitHome(),
    home,
    agentsDir: p(home, ".agents"),
    interactive: false,
    dryRun: true,
    verbose: false,
    skipBubblewrap: false,
    skipPluginRefresh: false,
    reconcile: false,
    prune: false,
    claudeCompactWindow: "",
    claudePermissive: false,
    claudePlugins: [],
    claudeModel: "",
    claudeEffort: "",
    claudeAdvisor: "",
    codexModel: "",
    codexEffort: "",
    syncConcurrency: 3,
    failures: [],
    targetFilterSet: true,
    syncClaude: true,
    syncCodex: false,
    syncAgents: false,
    syncOmp: false,
    nextStepTriggers: {
      claudePlugins: false,
      claudeRestart: false,
      codexRestart: false,
      skillsRestart: false,
      ompRestart: false
    },
    services
  }
}

describe("LSP install under the Node floor", () => {
  const homes = new Array<string>()
  const run = async (nodeVersion: string, missing: ReadonlyArray<ToolId>) => {
    const sinks: Sinks = { out: [], err: [] }
    const ctx = lspCtx(nodeVersion, missing, sinks)
    homes.push(ctx.home)
    await syncLspServers(ctx)
    return { out: sinks.out.join("\n"), err: sinks.err.join("\n") }
  }

  it("refuses the server install on a Node below the floor and names the remedy", async () => {
    const { out, err } = await run("v20.19.0", ["typescript-language-server"])

    expect(err).toContain("Skipping typescript-language-server install")
    expect(err).toContain("Node 20.19.0 is older than the 22.22.2")
    expect(out).not.toContain("typescript-language-server")
  })

  it("still installs the tools the floor does not govern", async () => {
    const { out } = await run("v20.19.0", ["typescript-language-server", "tsc", "intelephense"])

    expect(out).toContain("[dry-run] would install: npm install -g intelephense@")
    expect(out).toContain("typescript@")
    expect(out).not.toContain("typescript-language-server@")
  })

  it("installs the server on a Node at or above the floor", async () => {
    const { out, err } = await run("v22.22.2", ["typescript-language-server"])

    expect(out).toContain("[dry-run] would install: npm install -g typescript-language-server@6.0.0")
    expect(err).not.toContain("Skipping")
  })

  it("never probes Node when the server binary is already present", async () => {
    const { out, err } = await run("", [])

    expect(out).toContain("[dry-run] LSP server binaries present")
    expect(err).toBe("")
  })

  afterAll(() => {
    for (const home of homes) rmSync(home, { recursive: true, force: true })
  })
})
