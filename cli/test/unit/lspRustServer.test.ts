import { afterAll, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { stripVTControlCharacters } from "node:util";

import type { Ctx } from "../../src/engine-native";
import { syncLspServers } from "../../src/engine-native/claudeLsp";
import { DEPENDENCIES, type ToolId } from "../../src/engine-native/deps";
import { p } from "../../src/engine-native/exec";
import { makeLogger, type Logger } from "../../src/engine-native/logger";
import { makePlatform, type EngineServices } from "../../src/engine-native/services";
import { kitHome } from "../../src/kitHome";

type Sinks = { readonly out: Array<string>; readonly err: Array<string> };

/** Node is above the server floor, so the rust cases never turn on that gate. */
const NODE_VERSION = "v22.22.2";
/** Output of a working rust-analyzer binary; a rustup proxy without the component prints none. */
const RUST_ANALYZER_VERSION = "rust-analyzer 1.92.0 (0d1f2e3a4 2026-08-31)";

/**
 * The rust-analyzer-lsp plugin is enabled in SoT, and the probe list names the
 * absent tools. A tool in `broken` is on PATH but reports no version, like a
 * rustup proxy without its component. A tool in `stalled` does not answer its
 * version probe within the limit. `runEngineNative` gates verbose output on
 * `ctx.verbose`, so the harness applies the same wrapper; without it the skip
 * note would reach stderr on every run.
 */
function lspCtx(
  missing: ReadonlyArray<ToolId>,
  verbose: boolean,
  sinks: Sinks,
  broken: ReadonlyArray<ToolId> = [],
  stalled: ReadonlyArray<ToolId> = [],
): Ctx {
  const home = mkdtempSync(join(tmpdir(), "docks-lsp-rust-"));
  const base = makeLogger({
    stderr: (chunk) => void sinks.err.push(chunk.replace(/\n$/, "")),
    progress: () => {},
    stdout: (chunk) => void sinks.out.push(chunk.replace(/\n$/, "")),
  });
  const logger: Logger = {
    ...base,
    verbose: (msg) => {
      if (verbose) base.verbose(msg);
    },
  };
  // A stalled probe reads as an empty version through `version`, the way
  // `resolveVersion` maps a timeout.
  const version = async (id: ToolId): Promise<string> => {
    if (broken.includes(id) || stalled.includes(id)) return "";
    if (id === "node") return NODE_VERSION;
    return id === "rust-analyzer" ? RUST_ANALYZER_VERSION : "";
  };
  const services: EngineServices = {
    logger,
    platform: makePlatform("linux"),
    deps: {
      spec: (id) => DEPENDENCIES[id],
      probe: (id) => ({ state: missing.includes(id) ? "missing" : "present" }),
      version,
      versionReading: async (id) =>
        stalled.includes(id)
          ? { kind: "timed-out" }
          : { kind: "version", value: await version(id) },
      path: async () => "",
      warnMissing: () => {},
    },
  };
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
      ompRestart: false,
    },
    services,
  };
}

describe("rust-analyzer LSP server install", () => {
  const homes = new Array<string>();
  const run = async (
    missing: ReadonlyArray<ToolId>,
    verbose = false,
    broken: ReadonlyArray<ToolId> = [],
    stalled: ReadonlyArray<ToolId> = [],
  ) => {
    const sinks: Sinks = { out: [], err: [] };
    const ctx = lspCtx(missing, verbose, sinks, broken, stalled);
    homes.push(ctx.home);
    await syncLspServers(ctx);
    return { out: sinks.out.join("\n"), err: sinks.err.join("\n") };
  };

  it("installs the component through rustup when the host has rustup", async () => {
    const { out, err } = await run(["rust-analyzer"]);

    expect(out).toBe("[dry-run] would install: rustup component add rust-analyzer");
    expect(err).toBe("");
  });

  it("installs the component when the PATH hit is a rustup proxy without the component", async () => {
    const { out, err } = await run([], false, ["rust-analyzer"]);

    expect(out).toBe("[dry-run] would install: rustup component add rust-analyzer");
    expect(err).toBe("");
  });

  it("skips the install check when rust-analyzer --version does not answer in time", async () => {
    const { out, err } = await run([], false, [], ["rust-analyzer"]);

    expect(stripVTControlCharacters(err)).toBe(
      "[warn] rust-analyzer --version did not answer within 60 s; skipped the rust-analyzer install check. Run rust-analyzer --version to see what it waits for, then re-run sync.",
    );
    expect(out).toBe("[dry-run] LSP server binaries present");
  });

  it("stays silent on a host without rustup", async () => {
    const { out, err } = await run(["rust-analyzer", "rustup"]);

    expect(out).toBe("[dry-run] LSP server binaries present");
    expect(err).toBe("");
  });

  it("names the skipped component under --verbose", async () => {
    const { out, err } = await run(["rust-analyzer", "rustup"], true);

    expect(stripVTControlCharacters(err)).toBe(
      "[ok] Skipping rust-analyzer: rustup is not installed, so the rust-analyzer-lsp plugin stays a no-op",
    );
    expect(out).toBe("[dry-run] LSP server binaries present");
  });

  it("reports both channels when npm and rustup tools are missing together", async () => {
    const { out } = await run(["intelephense", "rust-analyzer"]);

    expect(out).toBe(
      "[dry-run] would install: npm install -g intelephense@1.18.5\n[dry-run] would install: rustup component add rust-analyzer",
    );
  });

  afterAll(() => {
    for (const home of homes) rmSync(home, { recursive: true, force: true });
  });
});
