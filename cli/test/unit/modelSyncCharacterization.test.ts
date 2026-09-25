import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";

import { writeHarnessSelection } from "../../src/engine-native/harnesses";
import { modelCatalog } from "../../src/engine-native/models";
import { runPublicCli } from "../lib/goldenExecution";
import {
  FIXTURES_DIR,
  cleanupTemporaryDirs,
  makeStubDir,
  temporaryDir,
} from "../lib/goldenResources";

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
    expect(JSON.parse(selected.stdout)).toEqual({
      omp: {
        tool: "omp",
        source: "curated",
        verified: "?",
        fallbackReason: "'omp models --json' returned no usable catalog",
        models: [],
      },
    });

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

  it("shows the curated fallback and reason when no live Codex cache exists", () => {
    const run = runPublicCli(["models", "codex"], "home-fresh", makeStubDir());
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

    const jsonRun = runPublicCli(["models", "codex", "--json"], "home-fresh", makeStubDir(), {
      reuseHome: home,
    });
    expect(jsonRun.exitCode).toBe(0);
    expect(jsonRun.stderr).toBe("");
    expect(JSON.parse(jsonRun.stdout)).toEqual({
      codex: {
        tool: "codex",
        source: "codex-cache",
        verified: modelCatalog("codex").verified,
        fetchedAt: "2026-09-24T12:00:00Z",
        models: [{ id: "gpt-demo", kind: "id", note: "Demo" }],
      },
    });
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
});
