import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";

import { mergeOmpConfig, mergeOmpModels } from "../../src/engine-native/ompYaml";

const REPO_DIR = resolve(import.meta.dirname, "..", "..", "..");
const OMP_SOT = join(REPO_DIR, "SoT", ".omp");

function readSot(name: string): string {
  return readFileSync(join(OMP_SOT, name), "utf8");
}

function ompConfig(): Record<string, unknown> {
  const parsed = parse(readSot("config.yml")) as unknown;
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error("SoT/.omp/config.yml must parse to a mapping");
  }
  return parsed as Record<string, unknown>;
}

describe("SoT omp tree", () => {
  it("parses config.yml as a YAML mapping", () => {
    expect(Object.keys(ompConfig()).length).toBeGreaterThan(0);
  });

  // This override is the kit's worked example of a provider ladder redefinition.
  // Every level stays reachable from the in-session thinking control.
  it("declares the full Astra thinking ladder through models.yml", () => {
    const models = parse(mergeOmpModels(readSot("models.yml"), "")) as unknown;
    expect(models).toBeTypeOf("object");
    expect(models).not.toBeNull();
    expect(Array.isArray(models)).toBe(false);
    expect(models).toHaveProperty(
      ["providers", "openai-codex", "modelOverrides", "gpt-6-astra", "thinking"],
      {
        mode: "effort",
        efforts: ["low", "medium", "high", "xhigh", "max"],
        defaultLevel: "xhigh",
      },
    );
  });

  it("reaches Astra as the last model-switcher stop", () => {
    const config = ompConfig();
    expect(config["cycleOrder"]).toEqual(["smol", "default", "slow", "fable", "astra"]);
    expect(config["modelRoles"]).toHaveProperty("astra", "openai-codex/gpt-6-astra:xhigh");
  });

  // A role the user selects on purpose must not fall onto Sol high through
  // `fallbackChains.default`. Astra and Fable cover each other instead.
  it("pairs the Astra and Fable retry chains across vendors", () => {
    const retry = ompConfig()["retry"] as Record<string, unknown>;
    const chains = retry["fallbackChains"] as Record<string, ReadonlyArray<string>>;
    expect(chains["astra"]).toEqual(["anthropic/claude-fable-5-1:medium"]);
    expect(chains["fable"]).toEqual(["openai-codex/gpt-6-astra:xhigh"]);
  });

  it("keeps Astra off every subagent role", () => {
    const config = ompConfig();
    const roles = config["modelRoles"] as Record<string, string>;
    expect(roles["task"]).toBe("openai-codex/gpt-5.6-sol:high");
    for (const [role, selector] of Object.entries(roles)) {
      if (role !== "astra") expect(selector).not.toContain("gpt-6-astra");
    }
    const task = config["task"] as Record<string, unknown>;
    const overrides = task["agentModelOverrides"] as Record<string, string>;
    for (const [agent, alias] of Object.entries(overrides)) {
      expect(alias).toMatch(/^@/);
      const target = alias.slice(1);
      const resolved = roles[target];
      expect(resolved, `${agent} -> ${alias} resolves to no role`).toBeDefined();
      expect(resolved).not.toContain("gpt-6-astra");
    }
  });

  // No kit role caps a subagent through models.yml any more.
  // Keep the task ceiling at omp's own ceiling so scout and sonic can reach
  // the top level their model publishes.
  it("allows max effort for subagents whose models support it", () => {
    expect(ompConfig()["task"]).toHaveProperty("maxEffort", "max");
  });

  // `-1` is omp's schema default sentinel, which selects reserve-based
  // compaction: `contextWindow` minus `max(floor(contextWindow * 0.15), 16384)`.
  // The key must stay present rather than be deleted as a redundant default,
  // because `ompYaml.ts mergeOmpConfig` is additive: a key absent from the SoT
  // is returned from the deployed file, so deleting it would strand the kit's
  // former `231200` pin in every already-deployed `~/.omp/agent/config.yml`.
  it("keeps the compaction trigger on omp's reserve-based default", () => {
    expect(ompConfig()["compaction"]).toHaveProperty("thresholdTokens", -1);
  });

  // omp retired `providers.webSearchOrder`. It expands the key in memory into
  // `modelRoles.web` plus `retry.fallbackChains.web` and then drops it, and it
  // never writes that expansion back. The kit declares both keys instead. An
  // explicit chain replaces omp's built-in web order wholesale, so a shortened
  // list drops providers rather than reordering them.
  it("declares the web role instead of the retired webSearchOrder key", () => {
    const config = ompConfig();
    expect(config["providers"]).not.toHaveProperty("webSearchOrder");
    expect(config["modelRoles"]).toHaveProperty("web", "web/firecrawl");
    const chains = (config["retry"] as Record<string, unknown>)["fallbackChains"];
    const web = (chains as Record<string, unknown>)["web"];
    expect(web).toEqual([
      "web/exa",
      "web/perplexity",
      "google/gemini-2.5-flash",
      "openai-codex/gpt-5.6-luna",
      "web/parallel",
      "google-antigravity/gemini-2.5-flash",
      "anthropic/claude-haiku-4-5",
      "openai-codex/gpt-5.6",
      "openai-codex/gpt-5.5",
      "xai/grok-4.5",
      "xai-oauth/grok-4.5",
      "web/zai",
      "web/tinyfish",
      "web/jina",
      "web/kagi",
      "web/tavily",
      "web/brave",
      "web/kimi",
      "web/synthetic",
      "web/ollama",
      "web/searxng",
      "web/startpage",
      "web/duckduckgo",
      "web/ecosia",
      "web/google",
      "web/mojeek",
      "web/public",
    ]);
  });

  // A fresh install copies the SoT text verbatim. If the yaml package
  // re-serializes it differently (for example `[low]` as `[ low ]`), every
  // later sync reports a merge and rewrites the file, breaking idempotency.
  it("keeps both YAML files byte-stable through their own merge", () => {
    const config = readSot("config.yml");
    const models = readSot("models.yml");
    expect(mergeOmpConfig(config, config)).toBe(config);
    expect(mergeOmpModels(models, models)).toBe(models);
  });

  it("loads the canonical ~/.agents skills only", () => {
    expect(ompConfig()["skills"]).toEqual({
      enableClaudeUser: false,
      enableCodexUser: false,
      enableAgentsUser: true,
    });
  });

  // omp rejects `unexpectedStopDetection: true` with
  // `Valid values: none, mechanical, smart`, so a stale boolean in the SoT
  // would quarantine the deployed global YAML and fail omp startup.
  it("declares the current enum value for unexpected-stop detection", () => {
    expect(ompConfig()["features"]).toEqual({ unexpectedStopDetection: "smart" });
  });

  // `omp config get advisor.subagents` answers `Unknown setting`. A retired key
  // in a kit-managed file would break every omp session on every machine.
  it("declares no retired advisor.subagents key", () => {
    const advisor = ompConfig()["advisor"];
    expect(advisor).toBeTypeOf("object");
    expect(Object.keys(advisor as Record<string, unknown>)).not.toContain("subagents");
  });

  // `setupVersion` is omp's own bookkeeping counter, not configuration. A
  // kit-declared value would reset the deployed marker on every sync.
  it("declares no setupVersion bookkeeping key", () => {
    expect(ompConfig()["setupVersion"]).toBeUndefined();
  });

  it("parses mcp.json as JSON that disables the kit-excluded servers", () => {
    const mcp = JSON.parse(readSot("mcp.json")) as { disabledServers?: unknown };
    expect(mcp.disabledServers).toEqual([
      "chrome-devtools",
      "context7:context7",
      "openaiDeveloperDocs",
    ]);
  });

  // pi-intercom's default `npx --no-install tsx` launcher cannot resolve tsx in
  // omp's flat plugin store, so the broker must run under Bun.
  it("parses intercom.json as JSON that runs the broker under Bun", () => {
    const intercom = JSON.parse(readSot("intercom.json")) as { brokerCommand?: unknown };
    expect(intercom.brokerCommand).toBe("bun");
  });

  it("ships AGENTS.md as non-empty global omp guidance", () => {
    expect(readSot("AGENTS.md").startsWith("# Global OMP guidance")).toBe(true);
  });
});
