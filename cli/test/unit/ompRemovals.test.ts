import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { syncOmpRemovals } from "../../src/engine-native/ompRemovals";
import { DEPENDENCIES } from "../../src/engine-native/deps";
import { p } from "../../src/engine-native/exec";
import type { Ctx } from "../../src/engine-native";
import { makeLogger } from "../../src/engine-native/logger";
import { makePlatform, type EngineServices } from "../../src/engine-native/services";
import { kitHome } from "../../src/kitHome";

const roots: Array<string> = [];

function testCtx(root: string, dryRun = false, stdout: Array<string> = []): Ctx {
  const home = p(root, "home");
  const services: EngineServices = {
    logger: makeLogger({
      stderr: () => {},
      progress: () => {},
      stdout: (chunk) => stdout.push(chunk),
    }),
    platform: makePlatform("linux"),
    deps: {
      spec: (id) => DEPENDENCIES[id],
      probe: vi.fn(() => ({ state: "missing" as const })),
      version: async () => "",
      path: async () => "",
      warnMissing: () => {},
    },
  };
  return {
    repoDir: kitHome(),
    home,
    agentsDir: p(home, ".agents"),
    interactive: false,
    dryRun,
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
    targetFilterSet: true,
    syncClaude: false,
    syncCodex: false,
    syncAgents: false,
    syncOmp: true,
    nextStepTriggers: {
      claudePlugins: false,
      claudeRestart: false,
      codexRestart: false,
      skillsRestart: false,
      ompRestart: false,
    },
    services,
    failures: [],
  };
}

function deployConfig(content: string): { file: string; root: string } {
  const root = mkdtempSync(join(tmpdir(), "omp-removals-"));
  roots.push(root);
  const dir = join(root, "home", ".omp", "agent");
  mkdirSync(dir, { recursive: true });
  const file = join(dir, "config.yml");
  writeFileSync(file, content);
  return { file, root };
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("retired omp config keys", () => {
  it("prunes a key whose deployed value still matches the value the kit shipped", () => {
    const { file, root } = deployConfig("symbolPreset: unicode\nsteeringMode: all\n");

    expect(syncOmpRemovals(testCtx(root), file)).toBe(1);
    const after = readFileSync(file, "utf8");
    expect(after).not.toContain("symbolPreset");
    expect(after).toContain("steeringMode: all");
  });

  it("keeps a retired key the user changed away from the shipped value", () => {
    const { file, root } = deployConfig("theme:\n  dark: nord\n");

    expect(syncOmpRemovals(testCtx(root), file)).toBe(0);
    expect(readFileSync(file, "utf8")).toContain("dark: nord");
  });

  it("prunes an outright-retired key at a value the kit never shipped", () => {
    const { file, root } = deployConfig(
      "providers:\n  webSearchOrder:\n    - brave\n  fetch: auto\n",
    );

    expect(syncOmpRemovals(testCtx(root), file)).toBe(1);
    const after = readFileSync(file, "utf8");
    expect(after).not.toContain("webSearchOrder");
    expect(after).toContain("fetch: auto");
  });

  it("removes a mapping emptied by pruning and keeps one that still holds a key", () => {
    const { file, root } = deployConfig(
      "tui:\n  textSizing: false\n  tight: false\nstatusLine:\n  transparent: false\n  compactThinkingLevel: false\n",
    );

    expect(syncOmpRemovals(testCtx(root), file)).toBe(3);
    const after = readFileSync(file, "utf8");
    expect(after).not.toContain("tui:");
    expect(after).toContain("statusLine:");
    expect(after).toContain("compactThinkingLevel: false");
    expect(after).not.toContain("transparent");
  });

  // A comment separated by a blank line belongs to the document and must
  // survive. A comment written directly above a key belongs to that key, so it
  // is correct for it to leave with the key rather than be orphaned onto the
  // next one.
  it("keeps document and neighbour comments while a pruned key takes its own", () => {
    const { file, root } = deployConfig(
      "# kit-owned omp configuration\n\n# no longer set by the kit\nautoResume: false\n\n# roles below\nmodelRoles:\n  default: anthropic/claude-opus-5\n",
    );

    expect(syncOmpRemovals(testCtx(root), file)).toBe(1);
    const after = readFileSync(file, "utf8");
    expect(after).toContain("# kit-owned omp configuration");
    expect(after).toContain("# roles below");
    expect(after).toContain("default: anthropic/claude-opus-5");
    expect(after).not.toContain("autoResume");
    expect(after).not.toContain("# no longer set by the kit");
  });

  it("reports the count under dry run and leaves the file byte-identical", () => {
    const source = "symbolPreset: unicode\nautoResume: false\n";
    const { file, root } = deployConfig(source);

    expect(syncOmpRemovals(testCtx(root, true), file)).toBe(2);
    expect(readFileSync(file, "utf8")).toBe(source);
  });

  it("leaves an unparseable config untouched instead of throwing", () => {
    const source = "symbolPreset: unicode\n  : : broken\n   - [\n";
    const { file, root } = deployConfig(source);

    expect(syncOmpRemovals(testCtx(root), file)).toBe(0);
    expect(readFileSync(file, "utf8")).toBe(source);
  });
});
