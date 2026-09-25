import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";

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
  // This override is the kit's worked example of a provider ladder redefinition.
  // Every level stays reachable from the in-session thinking control.
  it("declares the full Astra thinking ladder through models.yml", () => {
    const models = parse(readSot("models.yml")) as unknown;
    expect(models).toHaveProperty(
      ["providers", "openai-codex", "modelOverrides", "gpt-6-astra", "thinking"],
      {
        mode: "effort",
        efforts: ["low", "medium", "high", "xhigh", "max"],
        defaultLevel: "xhigh",
      },
    );
  });

  // Every Anthropic role and every Anthropic retry entry moved from Opus 5 to
  // Opus 5.5 at the same levels. A leftover `claude-opus-5:` selector would
  // silently keep one role on the retired model.
  it("selects Opus 5.5 for Anthropic roles and retries, never the retired Opus 5 id", () => {
    const config = ompConfig();
    const roles = config["modelRoles"] as Record<string, string>;
    expect(roles).toMatchObject({
      default: "anthropic/claude-opus-5-5:high",
      slow: "anthropic/claude-opus-5-5:xhigh",
      plan: "anthropic/claude-opus-5-5:xhigh",
      designer: "anthropic/claude-opus-5-5:high",
      vision: "anthropic/claude-opus-5-5:medium",
    });
    const chains = (config["retry"] as Record<string, unknown>)["fallbackChains"] as Record<
      string,
      Array<string>
    >;
    expect(chains).toMatchObject({
      task: ["anthropic/claude-opus-5-5:high"],
      smol: ["anthropic/claude-opus-5-5:low"],
      tiny: ["anthropic/claude-opus-5-5:low"],
      commit: ["anthropic/claude-opus-5-5:medium"],
    });
    expect(
      [...Object.values(roles), ...Object.values(chains).flat()].filter((selector) =>
        /claude-opus-5(?::|$)/.test(selector),
      ),
    ).toEqual([]);
  });

  it("keeps visible Astra and Fable roles at the end of the model switcher", () => {
    const config = ompConfig();
    expect(config["cycleOrder"]).toEqual(["smol", "default", "slow", "fable", "astra"]);
    expect(config["modelRoles"]).toHaveProperty("astra", "openai-codex/gpt-6-astra:xhigh");
    expect(config["modelRoles"]).toHaveProperty("fable", "anthropic/claude-fable-5-1:medium");
    expect(config["modelRoles"]).toHaveProperty(
      "switch_fable",
      "anthropic/claude-fable-5-1:medium",
    );
    expect(config["modelTags"]).toHaveProperty(["astra", "name"], "GPT-6 Astra");
    expect(config["modelTags"]).toHaveProperty(["fable", "name"], "Fable 5.1");
    expect(config["modelTags"]).toHaveProperty(["switch_fable", "hidden"], true);
  });

  // A role the user selects on purpose must not fall onto Sol high through
  // `fallbackChains.default`. Astra and Fable cover each other instead.
  it("keeps cross-vendor retries without routing Astra or Fable through the default chain", () => {
    const retry = ompConfig()["retry"] as Record<string, unknown>;
    const chains = retry["fallbackChains"] as Record<string, ReadonlyArray<string>>;
    expect(chains["default"]).toEqual(["openai-codex/gpt-6-sol:high"]);
    expect(chains["vision"]).toEqual(["openai-codex/gpt-6-sol:medium"]);
    expect(chains["astra"]).toEqual(["anthropic/claude-fable-5-1:medium"]);
    expect(chains["fable"]).toEqual(["openai-codex/gpt-6-astra:xhigh"]);
    expect(chains["switch_fable"]).toEqual([]);
  });

  it("keeps Astra off subagents and maps every reviewer to the Sol task role", () => {
    const config = ompConfig();
    const roles = config["modelRoles"] as Record<string, string>;
    expect(roles).toMatchObject({
      task: "openai-codex/gpt-6-sol:high",
      smol: "openai-codex/gpt-6-luna:medium",
      commit: "openai-codex/gpt-6-luna:medium",
      tiny: "openai-codex/gpt-6-luna:low",
    });
    for (const [role, selector] of Object.entries(roles)) {
      if (role !== "astra") expect(selector).not.toContain("gpt-6-astra");
    }
    const task = config["task"] as Record<string, unknown>;
    expect(task["agentModelOverrides"]).toEqual({
      reviewer: "@task",
      "security-reviewer": "@task",
      "code-reviewer": "@task",
      "plan-reviewer": "@task",
    });
  });

  it("keeps advisor on Opus 5.5 without a GPT-6 Sol retry", () => {
    const config = ompConfig();
    expect(config["advisor"]).toHaveProperty("enabled", true);
    expect(config["modelRoles"]).toHaveProperty("advisor", "anthropic/claude-opus-5-5:medium");
    const chains = (config["retry"] as Record<string, unknown>)["fallbackChains"];
    expect(chains).toHaveProperty("advisor", []);
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
  // explicit chain replaces omp's built-in web order wholesale. The owner
  // removed every older-model entry on purpose; any other shortened list drops
  // providers rather than reordering them.
  it("declares a complete web search chain without the retired webSearchOrder key", () => {
    const config = ompConfig();
    expect(config["providers"]).not.toHaveProperty("webSearchOrder");
    expect(config["modelRoles"]).toHaveProperty("web", "web/firecrawl");
    const chains = (config["retry"] as Record<string, unknown>)["fallbackChains"];
    const web = (chains as Record<string, unknown>)["web"] as ReadonlyArray<string>;
    expect(web).toHaveLength(20);
    expect(new Set(web).size).toBe(20);
    expect(web[0]).toBe("web/exa");
    expect(web.at(-1)).toBe("web/public");
    expect(web.join(" ")).not.toMatch(
      /gemini-2[.-]5-flash|claude-haiku-4[.-]5|gpt-5[.-][56]|grok-4[.-]5/i,
    );
  });
});
