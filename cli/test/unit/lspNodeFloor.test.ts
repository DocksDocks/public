import { afterAll, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { stripVTControlCharacters } from "node:util";

import type { Ctx } from "../../src/engine-native";
import { syncLspServers } from "../../src/engine-native/claudeLsp";
import { DEPENDENCIES, type ToolId } from "../../src/engine-native/deps";
import { p } from "../../src/engine-native/exec";
import { makeLogger } from "../../src/engine-native/logger";
import { makePlatform, type EngineServices } from "../../src/engine-native/services";
import { kitHome } from "../../src/kitHome";
import { verifiedVersion } from "../lib/toolchainManifest";

type Sinks = { readonly out: Array<string>; readonly err: Array<string> };

/**
 * The typescript-lsp plugin is enabled in SoT, its server binary is absent, and
 * every other LSP tool is present. That isolates the single install decision
 * the Node floor governs.
 */
function lspCtx(nodeVersion: string, missing: ReadonlyArray<ToolId>, sinks: Sinks): Ctx {
  const home = mkdtempSync(join(tmpdir(), "docks-lsp-floor-"));
  const services: EngineServices = {
    logger: makeLogger({
      stderr: (chunk) => void sinks.err.push(chunk.replace(/\n$/, "")),
      progress: () => {},
      stdout: (chunk) => void sinks.out.push(chunk.replace(/\n$/, "")),
    }),
    platform: makePlatform("linux"),
    deps: {
      spec: (id) => DEPENDENCIES[id],
      probe: (id) => ({ state: missing.includes(id) ? "missing" : "present" }),
      version: async (id) => (id === "node" ? nodeVersion : ""),
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
      ompRestart: false,
    },
    services,
  };
}

describe("LSP install under the Node floor", () => {
  const homes = new Array<string>();
  const run = async (nodeVersion: string, missing: ReadonlyArray<ToolId>) => {
    const sinks: Sinks = { out: [], err: [] };
    const ctx = lspCtx(nodeVersion, missing, sinks);
    homes.push(ctx.home);
    await syncLspServers(ctx);
    return { out: sinks.out.join("\n"), err: sinks.err.join("\n") };
  };

  it("refuses the server install below the Node floor and names the remedy", async () => {
    const { out, err } = await run("v20.19.0", ["typescript-language-server"]);

    expect(stripVTControlCharacters(err)).toBe(
      "[warn] Skipping typescript-language-server install: Node 20.19.0 is older than the 22.22.2 that version requires. Upgrade Node, then re-run sync.",
    );
    expect(out).toBe("");
  });

  it("still installs tools not governed by the Node floor", async () => {
    const { out } = await run("v20.19.0", ["typescript-language-server", "tsc", "intelephense"]);

    expect(out).toBe(
      "[dry-run] would install: npm install -g intelephense@1.18.5 typescript@6.0.3",
    );
  });

  it("installs the server at the Node floor", async () => {
    const { out, err } = await run("v22.22.2", ["typescript-language-server"]);

    expect(out).toBe(
      `[dry-run] would install: npm install -g typescript-language-server@${verifiedVersion("typescript-language-server")}`,
    );
    expect(err).toBe("");
  });

  afterAll(() => {
    for (const home of homes) rmSync(home, { recursive: true, force: true });
  });
});
