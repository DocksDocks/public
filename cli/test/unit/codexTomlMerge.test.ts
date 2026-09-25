import { describe, expect, it } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync as nodeSpawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { codexSync } from "../../src/engine-native/codexSync";
import { p } from "../../src/engine-native/exec";
import { syncCodexEffort } from "../../src/engine-native/codexToml";
import type { Ctx } from "../../src/engine-native";
import { DEPENDENCIES } from "../../src/engine-native/deps";
import { makeLogger } from "../../src/engine-native/logger";
import { makePlatform, type EngineServices } from "../../src/engine-native/services";
import { kitHome } from "../../src/kitHome";

function testCtx(root: string): Ctx {
  const home = join(root, "home");
  const platform = makePlatform("darwin");
  const services: EngineServices = {
    logger: makeLogger({
      stderr: () => {},
      progress: () => {},
      stdout: () => {},
    }),
    platform,
    deps: {
      spec: (id) => DEPENDENCIES[id],
      probe: () => ({ state: "missing" as const }),
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
    dryRun: false,
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
    syncCodex: true,
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
    failures: [],
  };
}

function prepareConfig(root: string, content: string): string {
  const home = join(root, "home");
  const config = p(home, ".codex", "config.toml");
  mkdirSync(p(home, ".codex"), { recursive: true });
  writeFileSync(config, content);
  return config;
}

function parseToml(content: string): Record<string, unknown> {
  const parsed = nodeSpawnSync(
    "bun",
    ["-e", "console.log(JSON.stringify(Bun.TOML.parse(await Bun.stdin.text())))"],
    {
      input: content,
      encoding: "utf8",
    },
  );
  expect(parsed.status, parsed.stderr).toBe(0);
  return JSON.parse(parsed.stdout) as Record<string, unknown>;
}

const sotConfig = readFileSync(join(kitHome(), "SoT", ".codex", "config.toml"), "utf8");

describe("Codex TOML merge durability", () => {
  it("merges a CRLF config into valid TOML with the managed plugins", async () => {
    const root = mkdtempSync(join(tmpdir(), "codex-crlf-merge-"));
    const config = prepareConfig(root, sotConfig.replace(/\n/g, "\r\n"));

    try {
      await codexSync(testCtx(root));
      const deployed = readFileSync(config, "utf8");

      expect(parseToml(deployed)["plugins"]).toEqual({
        "docks@docks": { enabled: true },
        "plan-lifecycle@docks": { enabled: true },
      });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("replaces the user Windows sandbox table with the SoT elevated sandbox", async () => {
    const root = mkdtempSync(join(tmpdir(), "codex-windows-merge-"));
    const config = prepareConfig(
      root,
      'model = "user-choice"\n\n[windows]\nsandbox = "unelevated"\nuser_override = true\n',
    );

    try {
      await codexSync(testCtx(root));
      const deployed = readFileSync(config, "utf8");

      expect(parseToml(deployed)["windows"]).toEqual({ sandbox: "elevated" });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it.each([
    ["a commented header", "[tui] # keep this note", "[tui]", "status_line_use_colors"],
    ["a whitespace-padded header", "[ tui ]", "[tui]", "status_line_use_colors"],
    ["a trailing-space header", "[tui] ", "[tui]", "status_line_use_colors"],
    ["a single-quoted plugin key", "[plugins.'docks@docks']", '[plugins."docks@docks"]', "enabled"],
  ])(
    "recognizes %s as the managed table instead of duplicating it",
    async (_label, userHeader, sotHeader, setting) => {
      const root = mkdtempSync(join(tmpdir(), "codex-header-merge-"));
      const userOverride = `${setting} = false`;
      const managedSetting = `${setting} = true`;
      const config = prepareConfig(
        root,
        sotConfig.replace(`${sotHeader}\n${managedSetting}`, `${userHeader}\n${userOverride}`),
      );

      try {
        await codexSync(testCtx(root));
        const deployed = readFileSync(config, "utf8");

        expect(parseToml(deployed)).toMatchObject(
          setting === "enabled"
            ? { plugins: { "docks@docks": { enabled: true } } }
            : { tui: { status_line_use_colors: true } },
        );
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    },
  );

  it("rejects invalid deployed marketplace JSON without overwriting it", async () => {
    const root = mkdtempSync(join(tmpdir(), "codex-invalid-marketplace-"));
    const home = join(root, "home");
    const marketplace = p(home, ".agents", "plugins", "marketplace.json");
    mkdirSync(p(home, ".agents", "plugins"), { recursive: true });
    writeFileSync(marketplace, "{ invalid");

    try {
      await expect(codexSync(testCtx(root))).rejects.toThrow(
        `invalid deployed Codex marketplace JSON: ${marketplace}. Fix or delete it.`,
      );
      expect(readFileSync(marketplace, "utf8")).toBe("{ invalid");
      expect(existsSync(`${marketplace}.bak`)).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("propagates a non-ENOENT Codex config read failure", () => {
    const root = mkdtempSync(join(tmpdir(), "codex-config-read-error-"));
    const config = p(join(root, "home"), ".codex", "config.toml");
    mkdirSync(config, { recursive: true });

    try {
      expect(() => syncCodexEffort(testCtx(root), "high")).toThrow(/EISDIR|EPERM/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
