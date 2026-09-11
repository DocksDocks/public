import { afterAll, describe, expect, it } from "vitest"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import type { Ctx } from "../../src/engine-native"
import { syncLspServers } from "../../src/engine-native/claudePlugins"
import { DEPENDENCIES, type ToolId } from "../../src/engine-native/deps"
import { p } from "../../src/engine-native/exec"
import { makeLogger, type Logger } from "../../src/engine-native/logger"
import { makePlatform, type EngineServices } from "../../src/engine-native/services"
import { kitHome } from "../../src/kitHome"

type Sinks = { readonly out: Array<string>; readonly err: Array<string> }

/** Node is above the server floor, so the rust cases never turn on that gate. */
const NODE_VERSION = "v22.22.2"

/**
 * The rust-analyzer-lsp plugin is enabled in SoT, and the probe list names the
 * absent tools. `runEngineNative` gates verbose output on `ctx.verbose`, so the
 * harness applies the same wrapper; without it the skip note would reach stderr
 * on every run.
 */
function lspCtx(missing: ReadonlyArray<ToolId>, verbose: boolean, sinks: Sinks): Ctx {
  const home = mkdtempSync(join(tmpdir(), "docks-lsp-rust-"))
  const base = makeLogger({
    stderr: (chunk) => void sinks.err.push(chunk.replace(/\n$/, "")),
    progress: () => {},
    stdout: (chunk) => void sinks.out.push(chunk.replace(/\n$/, ""))
  })
  const logger: Logger = {
    ...base,
    verbose: (msg) => {
      if (verbose) base.verbose(msg)
    }
  }
  const services: EngineServices = {
    logger,
    platform: makePlatform("linux"),
    deps: {
      spec: (id) => DEPENDENCIES[id],
      probe: (id) => ({ state: missing.includes(id) ? "missing" : "present" }),
      version: async (id) => (id === "node" ? NODE_VERSION : ""),
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
    verbose,
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

describe("rust-analyzer LSP server install", () => {
  const homes = new Array<string>()
  const run = async (missing: ReadonlyArray<ToolId>, verbose = false) => {
    const sinks: Sinks = { out: [], err: [] }
    const ctx = lspCtx(missing, verbose, sinks)
    homes.push(ctx.home)
    await syncLspServers(ctx)
    return { out: sinks.out.join("\n"), err: sinks.err.join("\n") }
  }

  it("installs the component through rustup when the host has rustup", async () => {
    const { out, err } = await run(["rust-analyzer"])

    expect(out).toContain("[dry-run] would install: rustup component add rust-analyzer")
    expect(out).not.toContain("npm install -g")
    expect(err).toBe("")
  })

  it("stays silent on a host without rustup", async () => {
    const { out, err } = await run(["rust-analyzer", "rustup"])

    expect(out).toContain("[dry-run] LSP server binaries present")
    expect(out).not.toContain("rustup component add")
    expect(err).toBe("")
  })

  it("names the skipped component under --verbose", async () => {
    const { out, err } = await run(["rust-analyzer", "rustup"], true)

    expect(err).toContain("Skipping rust-analyzer: rustup is not installed")
    expect(out).toContain("[dry-run] LSP server binaries present")
    expect(out).not.toContain("rustup component add")
  })

  it("reports both channels when npm and rustup tools are missing together", async () => {
    const { out } = await run(["intelephense", "rust-analyzer"])

    expect(out).toContain("[dry-run] would install: npm install -g intelephense@")
    expect(out).toContain("[dry-run] would install: rustup component add rust-analyzer")
  })

  it("reports nothing to install when every server binary is present", async () => {
    const { out, err } = await run([])

    expect(out).toContain("[dry-run] LSP server binaries present")
    expect(out).not.toContain("rust-analyzer")
    expect(err).toBe("")
  })

  afterAll(() => {
    for (const home of homes) rmSync(home, { recursive: true, force: true })
  })
})
