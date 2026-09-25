import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parse } from "yaml";
import type * as ExecModule from "../../src/engine-native/exec";

const mocks = vi.hoisted(() => ({
  payloadText: vi.fn<(path: string) => string>(),
  spawnProcess: vi.fn(),
}));

vi.mock("../../src/payload", () => ({
  payloadText: mocks.payloadText,
  payloadDisplayPath: (path: string) => `embedded:${path}`,
}));
vi.mock("../../src/engine-native/exec", async () => {
  const actual = await vi.importActual<typeof ExecModule>("../../src/engine-native/exec");
  return { ...actual, spawnProcess: mocks.spawnProcess };
});
vi.mock("../../src/engine-native/bun", () => ({
  bunBootstrap: async () => ({ kind: "ready", executable: "bun" }),
}));

import { syncOmpModelRemovals, syncOmpRemovals } from "../../src/engine-native/ompRemovals";
import { ompSync } from "../../src/engine-native/ompSync";
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
    expect(parse(readFileSync(file, "utf8"))).toEqual({ steeringMode: "all" });
  });

  it("keeps a retired key the user changed away from the shipped value", () => {
    const { file, root } = deployConfig("theme:\n  dark: nord\n");

    expect(syncOmpRemovals(testCtx(root), file)).toBe(0);
    expect(parse(readFileSync(file, "utf8"))).toEqual({ theme: { dark: "nord" } });
  });

  it("prunes an outright-retired key at a value the kit never shipped", () => {
    const { file, root } = deployConfig(
      "providers:\n  webSearchOrder:\n    - brave\n  fetch: auto\n",
    );

    expect(syncOmpRemovals(testCtx(root), file)).toBe(1);
    expect(parse(readFileSync(file, "utf8"))).toEqual({ providers: { fetch: "auto" } });
  });

  it("removes a mapping emptied by pruning and keeps one that still holds a key", () => {
    const { file, root } = deployConfig(
      "tui:\n  textSizing: false\n  tight: false\nstatusLine:\n  transparent: false\n  compactThinkingLevel: false\n",
    );

    expect(syncOmpRemovals(testCtx(root), file)).toBe(3);
    expect(parse(readFileSync(file, "utf8"))).toEqual({
      statusLine: { compactThinkingLevel: false },
    });
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

  // With no later key to carry it, a header would otherwise vanish. This is the
  // one position where the carry-over has nowhere obvious to go.
  it("keeps a carried header when the pruned key was last in its mapping", () => {
    const { file, root } = deployConfig(
      "steeringMode: all\n\n# kit-owned omp configuration\n\n# about autoResume\nautoResume: false\n",
    );

    expect(syncOmpRemovals(testCtx(root), file)).toBe(1);
    const after = readFileSync(file, "utf8");
    expect(after).toContain("# kit-owned omp configuration");
    expect(after).toContain("steeringMode: all");
    expect(after).not.toContain("autoResume");
    expect(after).not.toContain("# about autoResume");
  });

  // A trailing comment belongs to the mapping that holds it, not to the
  // document. Hoisting it to the document instead would drag a nested section
  // header to the top of the file.
  it("keeps a carried header inside the mapping it came from", () => {
    const { file, root } = deployConfig(
      "tui:\n  keepMe: 1\n\n  # tui section header\n\n  # about tight\n  tight: false\nsteeringMode: all\n",
    );

    expect(syncOmpRemovals(testCtx(root), file)).toBe(1);
    const after = readFileSync(file, "utf8");
    const header = after.indexOf("# tui section header");
    expect(header).toBeGreaterThan(after.indexOf("keepMe: 1"));
    expect(header).toBeLessThan(after.indexOf("steeringMode: all"));
    expect(after).not.toContain("tight: false");
  });

  // Without this the call site is unguarded: a refactor could drop it and every
  // direct test above would still pass.
  it("runs as part of ompSync, after the additive config merge", async () => {
    const root = mkdtempSync(join(tmpdir(), "omp-removals-sync-"));
    roots.push(root);
    // PI_CODING_AGENT_DIR relocates the whole agent directory, so an ambient
    // value would send these writes outside the temporary root.
    const ompEnvKeys = [
      "XDG_DATA_HOME",
      "OMP_PROFILE",
      "PI_PROFILE",
      "PI_CONFIG_DIR",
      "PI_CODING_AGENT_DIR",
    ] as const;
    const restore: Record<string, string | undefined> = {};
    for (const key of ompEnvKeys) {
      restore[key] = process.env[key];
      delete process.env[key];
    }
    mocks.payloadText.mockImplementation((path) => {
      if (path === "SoT/.omp/config.yml") return "steeringMode: all\n";
      if (path === "SoT/.omp/models.yml") return "providers: {}\n";
      if (path === "SoT/.omp/AGENTS.md") return "# omp\n";
      return "{}\n";
    });
    mocks.spawnProcess.mockResolvedValue({
      error: undefined,
      exitCode: 0,
      stdout: "",
      stderr: "",
    });

    const agentDir = join(root, ".omp", "agent");
    mkdirSync(agentDir, { recursive: true });
    const file = join(agentDir, "config.yml");
    writeFileSync(file, "symbolPreset: unicode\nproviders:\n  webSearchOrder:\n    - brave\n");

    const ctx = testCtx(root);
    try {
      await ompSync({ ...ctx, home: root });
    } finally {
      for (const [key, value] of Object.entries(restore)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    }

    expect(parse(readFileSync(file, "utf8"))).toEqual({ steeringMode: "all" });
  });
});

/** The claude-opus-5-5 override block exactly as SoT/.omp/models.yml shipped it. */
const SHIPPED_OPUS_BLOCK = `      claude-opus-5-5:
        name: Claude Opus 5.5
        reasoning: true
        input:
          - text
          - image
        contextWindow: 1000000
        maxTokens: 128000
        cost:
          input: 4
          output: 20
          cacheRead: 0.2
          cacheWrite: 5
        thinking:
          mode: effort
          efforts:
            - low
            - medium
            - high
            - xhigh
            - max
          defaultLevel: high
`;

function deployModels(content: string): { file: string; root: string } {
  const { file: configFile, root } = deployConfig("");
  const file = join(configFile, "..", "models.yml");
  writeFileSync(file, content);
  return { file, root };
}

describe("retired omp models.yml blocks", () => {
  it("prunes the shipped Opus 5.5 override and the provider mapping it empties", () => {
    const { file, root } = deployModels(
      `providers:\n  anthropic:\n    modelOverrides:\n${SHIPPED_OPUS_BLOCK}  openai-codex:\n    baseUrl: https://example.test\n`,
    );

    expect(syncOmpModelRemovals(testCtx(root), file)).toBe(1);
    expect(parse(readFileSync(file, "utf8"))).toEqual({
      providers: { "openai-codex": { baseUrl: "https://example.test" } },
    });
  });

  it("keeps an Opus 5.5 override the user edited, and a provider key beside it", () => {
    const edited = SHIPPED_OPUS_BLOCK.replace("defaultLevel: high", "defaultLevel: max");
    const { file, root } = deployModels(
      `providers:\n  anthropic:\n    apiKey: secret\n    modelOverrides:\n${edited}`,
    );

    expect(syncOmpModelRemovals(testCtx(root), file)).toBe(0);
    expect(parse(readFileSync(file, "utf8"))).toHaveProperty(
      ["providers", "anthropic", "modelOverrides", "claude-opus-5-5", "thinking", "defaultLevel"],
      "max",
    );
  });
});
