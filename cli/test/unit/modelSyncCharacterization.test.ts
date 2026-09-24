import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";

import { writeHarnessSelection } from "../../src/engine-native/harnesses";
import { modelCatalog } from "../../src/engine-native/models";
import { cleanup, runEngine, runPublicCli } from "../lib/goldenExecution";
import {
  FIXTURES_DIR,
  cleanupTemporaryDirs,
  makeStubDir,
  temporaryDir,
} from "../lib/goldenResources";

// The stub launchers and the child must agree on one host. Native pairing runs
// the real host with its own launcher form, so these cases keep their
// harness-CLI coverage on Windows instead of resolving a shell script the
// host cannot execute.
const NATIVE = { nativeHost: true } as const;

afterAll(cleanupTemporaryDirs);

function deployedText(home: string, path: string): string {
  return readFileSync(join(home, ...path.split("/")), "utf8");
}

describe("retained model and sync behavior", () => {
  it("lists curated Claude and Codex models when neither login nor cache is available", () => {
    const run = runPublicCli(["models", "--json"], "home-fresh", makeStubDir());
    try {
      expect(run.exitCode).toBe(0);
      expect(JSON.parse(run.stdout)).toEqual({
        claude: {
          tool: "claude",
          source: "curated",
          verified: modelCatalog("claude").verified,
          fallbackReason: "no Claude Code login found in ~/.claude/.credentials.json",
          models: modelCatalog("claude").models,
        },
        codex: {
          tool: "codex",
          source: "curated",
          verified: modelCatalog("codex").verified,
          fallbackReason: "no Codex model cache (~/.codex/models_cache.json); run codex once",
          models: modelCatalog("codex").models,
        },
      });
      expect(run.stderr).toBe("");
    } finally {
      rmSync(run.home, { recursive: true, force: true });
    }
  });

  it("lists only enabled model harnesses by default and allows an explicit tool", () => {
    const home = temporaryDir("models-selected-home-");
    writeHarnessSelection(home, ["agents", "omp"]);
    const stubs = makeStubDir();
    const options = { reuseHome: home };

    const selected = runPublicCli(["models", "--json"], "home-fresh", stubs, options);
    expect(selected.exitCode).toBe(0);
    expect(selected.stderr).toBe("");
    expect(Object.keys(JSON.parse(selected.stdout))).toEqual(["omp"]);

    const explicit = runPublicCli(["models", "codex", "--json"], "home-fresh", stubs, options);
    expect(explicit.exitCode).toBe(0);
    expect(explicit.stderr).toBe("");
    expect(JSON.parse(explicit.stdout)).toEqual({
      codex: {
        tool: "codex",
        source: "curated",
        verified: modelCatalog("codex").verified,
        fallbackReason: "codex harness not enabled (docks-kit harnesses)",
        models: modelCatalog("codex").models,
      },
    });
  });

  it("shows the curated fallback and reason with --refresh when no live cache exists", () => {
    const run = runPublicCli(["models", "codex", "--refresh"], "home-fresh", makeStubDir());
    try {
      expect(run.exitCode).toBe(0);
      expect(run.stdout).toContain(
        `codex models (kit-verified ${modelCatalog("codex").verified}):`,
      );
      expect(run.stdout).toContain(
        "  (live list unavailable: no Codex model cache (~/.codex/models_cache.json); run codex once)",
      );
      expect(run.stdout).not.toContain("claude models");
      expect(run.stderr).toBe("");
    } finally {
      rmSync(run.home, { recursive: true, force: true });
    }
  });

  it("shows a live Codex cache with its fetched time instead of stale curated IDs", () => {
    const home = temporaryDir("models-live-home-");
    mkdirSync(join(home, ".codex"));
    writeFileSync(
      join(home, ".codex", "models_cache.json"),
      JSON.stringify({
        fetched_at: "2026-09-24T12:00:00Z",
        models: [{ slug: "gpt-demo", display_name: "Demo", visibility: "list" }],
      }),
    );
    writeHarnessSelection(home, ["codex"]);
    const run = runPublicCli(["models", "codex"], "home-fresh", makeStubDir(), {
      reuseHome: home,
    });

    expect(run.exitCode).toBe(0);
    expect(run.stdout).toContain(
      "codex models (live — codex-cache, fetched 2026-09-24T12:00:00Z):",
    );
    expect(run.stdout).toMatch(/^  gpt-demo\s+id\s+Demo$/m);
    expect(run.stdout).not.toContain("gpt-6-sol");
    expect(run.stdout).not.toContain("live list unavailable");
    expect(run.stderr).toBe("");
  });

  it("parses ordinary model and effort modifiers through the public sync command", () => {
    const fixtureClaude = readFileSync(
      join(FIXTURES_DIR, "home-drift", ".claude", "settings.json"),
      "utf8",
    );
    const fixtureCodex = readFileSync(
      join(FIXTURES_DIR, "home-drift", ".codex", "config.toml"),
      "utf8",
    );
    const run = runPublicCli(
      [
        "sync",
        "claude",
        "codex",
        "--dry-run",
        "--claude-model=opus",
        "--claude-effort=xhigh",
        "--codex-model=gpt-5.5",
        "--codex-effort=ultra",
      ],
      "home-drift",
      makeStubDir(),
    );
    try {
      expect(run.exitCode).toBe(0);
      expect(run.stdout).toContain("[dry-run] (--claude-model) set .model=opus");
      expect(run.stdout).toContain("[dry-run] (--claude-effort) set .effortLevel=xhigh");
      expect(run.stdout).toContain('[dry-run] (--codex-model) set model = "gpt-5.5"');
      expect(run.stdout).toContain(
        '[dry-run] (--codex-effort) set model_reasoning_effort = "ultra"',
      );
      expect(deployedText(run.home, ".claude/settings.json")).toBe(fixtureClaude);
      expect(deployedText(run.home, ".codex/config.toml")).toBe(fixtureCodex);
    } finally {
      rmSync(run.home, { recursive: true, force: true });
    }
  });

  it("restores normal SoT model and effort defaults on a flag-less fixture sync", () => {
    const run = runEngine(["sync"], "home-drift", makeStubDir({}, NATIVE), NATIVE);
    try {
      expect(run.exitCode).toBe(0);

      const claude = JSON.parse(deployedText(run.home, ".claude/settings.json")) as {
        model: string;
        effortLevel: string;
        env: Record<string, string>;
        permissions: { allow: Array<string> };
      };
      expect(claude.model).toBe("opus");
      expect(claude.effortLevel).toBe("high");
      expect(claude.env["MY_CUSTOM_VAR"]).toBe("1");
      expect(claude.permissions.allow).toContain("Bash(my-tool *)");
      expect(claude.permissions.allow).toContain("Read");

      const codex = deployedText(run.home, ".codex/config.toml");
      expect(codex.match(/^model\s*=\s*"([^"]*)"$/m)?.[1]).toBe("gpt-6-sol");
      expect(codex.match(/^model_reasoning_effort\s*=\s*"([^"]*)"$/m)?.[1]).toBe("high");
      expect(codex).toMatch(/^custom_user_key = "keepme"$/m);
      expect(codex).toMatch(/^\[user_only\.table\]\nkeep = true$/m);
      expect(codex).not.toMatch(/^use_legacy_landlock\s*=/m);
    } finally {
      cleanup([run]);
    }
  });
});
