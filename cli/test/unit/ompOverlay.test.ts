import { describe, expect, it } from "vitest";
import { parse } from "yaml";

import {
  advisorLevelFor,
  advisorRecommendation,
  ladderCeiling,
  overlayFileName,
  parseFreeModels,
  planEffortChoice,
  renderFreeOverlay,
} from "../../src/engine-native/ompOverlay";

const FREE_SELECTOR = "opencode-zen/muse-spark-1.3-contributor-free";

const ROLE_KEYS = [
  "smol",
  "advisor",
  "designer",
  "plan",
  "commit",
  "task",
  "vision",
  "tiny",
  "default",
  "slow",
  "fable",
  "switch_fable",
  "astra",
];

const FALLBACK_KEYS = [
  "default",
  "advisor",
  "task",
  "vision",
  "smol",
  "tiny",
  "commit",
  "switch_fable",
  "fable",
  "astra",
];

// Free catalog ladders can skip medium or xhigh entirely.
const LADDER_FULL = ["minimal", "low", "medium", "high", "xhigh"];
const LADDER_NO_XHIGH = ["minimal", "low", "medium", "high"];
const LADDER_LOW_HIGH_MAX = ["low", "high", "max"];
const LADDER_HIGH_MAX = ["high", "max"];
const LADDER_EMPTY: ReadonlyArray<string> = [];

function fallbackChains(parsed: Record<string, unknown>): Record<string, unknown> {
  return (parsed["retry"] as Record<string, unknown>)["fallbackChains"] as Record<string, unknown>;
}

describe("omp free-session overlay", () => {
  it("sets the chat-model roles to one free selector with a cheaper advisor", () => {
    const parsed = parse(
      renderFreeOverlay({ selector: FREE_SELECTOR, thinking: "xhigh", advisorThinking: "medium" }),
    ) as Record<string, unknown>;
    expect(parsed["defaultThinkingLevel"]).toBe("xhigh");
    const roles = parsed["modelRoles"] as Record<string, string>;
    for (const role of ROLE_KEYS) {
      const level = role === "advisor" ? "medium" : "xhigh";
      expect(roles[role]).toBe(`${FREE_SELECTOR}:${level}`);
    }
    const task = parsed["task"] as Record<string, unknown>;
    expect(task["maxEffort"]).toBe("xhigh");
    const chains = fallbackChains(parsed);
    for (const key of FALLBACK_KEYS) {
      expect(chains[key]).toEqual([]);
    }
  });

  it("derives the advisor level from the model own ladder", () => {
    expect(advisorLevelFor(LADDER_FULL)).toBe("medium");
    expect(advisorLevelFor(LADDER_LOW_HIGH_MAX)).toBe("low");
    expect(advisorLevelFor(LADDER_HIGH_MAX)).toBe("high");
    expect(advisorLevelFor(LADDER_EMPTY)).toBeUndefined();
  });

  it("resolves the ceiling from the model own ladder without guessing", () => {
    expect(ladderCeiling(LADDER_FULL)).toBe("xhigh");
    expect(ladderCeiling(LADDER_NO_XHIGH)).toBe("high");
    expect(ladderCeiling(LADDER_LOW_HIGH_MAX)).toBe("max");
    expect(ladderCeiling(LADDER_EMPTY)).toBeUndefined();
  });

  it("renders the chosen max level for every non-advisor role", () => {
    const parsed = parse(
      renderFreeOverlay({
        selector: "provider/big-pickle",
        thinking: "max",
        advisorThinking: "high",
      }),
    ) as Record<string, unknown>;
    const roles = parsed["modelRoles"] as Record<string, string>;
    for (const role of ROLE_KEYS) {
      expect(roles[role]).toBe(`provider/big-pickle:${role === "advisor" ? "high" : "max"}`);
    }
    expect(parsed["defaultThinkingLevel"]).toBe("max");
    expect((parsed["task"] as Record<string, unknown>)["maxEffort"]).toBe("max");
  });

  it("renders a level-free model with bare chat selectors and no thinking keys", () => {
    const parsed = parse(renderFreeOverlay({ selector: "provider/ling-free" })) as Record<
      string,
      unknown
    >;
    expect("defaultThinkingLevel" in parsed).toBe(false);
    expect("task" in parsed).toBe(false);
    const roles = parsed["modelRoles"] as Record<string, string>;
    for (const role of ROLE_KEYS) {
      expect(roles[role]).toBe("provider/ling-free");
    }
    const chains = fallbackChains(parsed);
    for (const key of FALLBACK_KEYS) {
      expect(chains[key]).toEqual([]);
    }
  });

  it("keeps zero-cost rows and rejects paid and unpriced models", () => {
    const catalog = {
      models: [
        {
          selector: "paid/input",
          name: "Paid input",
          thinking: ["low"],
          contextWindow: 100,
          cost: { input: 1, output: 0 },
        },
        {
          selector: "paid/output",
          name: "Paid output",
          thinking: ["low"],
          contextWindow: 100,
          cost: { input: 0, output: 1 },
        },
        { selector: "unpriced/model" },
        {
          selector: FREE_SELECTOR,
          name: "Muse Spark 1.3 Free",
          thinking: ["minimal", "low", "medium", "high", "xhigh", "ultra"],
          contextWindow: 1048576,
          cost: { input: 0, output: 0 },
        },
        "not-a-row",
        { selector: "", cost: { input: 0, output: 0 } },
      ],
    };
    expect(parseFreeModels(catalog)).toEqual([
      {
        selector: FREE_SELECTOR,
        name: "Muse Spark 1.3 Free",
        thinking: ["minimal", "low", "medium", "high", "xhigh"],
        contextWindow: 1048576,
      },
    ]);
    expect(parseFreeModels(undefined)).toEqual([]);
    expect(parseFreeModels({})).toEqual([]);
  });

  it("keeps distinct selectors in separate, repeatable overlay files", () => {
    const name = overlayFileName("opencode-zen/muse");
    expect(name).toMatch(/^omp-free-[A-Za-z0-9._-]+\.yml$/);
    expect(overlayFileName("opencode-zen/muse")).toBe(name);
    // These selectors have the same sanitized spelling but must not overwrite
    // each other's live-session overlay.
    expect(overlayFileName("opencode-zen/muse")).not.toBe(overlayFileName("opencode-zen-muse"));
  });

  it("asks nothing when the model publishes no usable ladder", () => {
    expect(planEffortChoice([])).toEqual({ kind: "none" });
    // An unknown future level is not a level omp would accept from the kit.
    expect(planEffortChoice(["turbo"])).toEqual({ kind: "none" });
  });

  it("settles a single-level model without a question", () => {
    expect(planEffortChoice(["high"])).toEqual({ kind: "fixed", level: "high" });
  });

  it("offers only the levels the model publishes, lowest first", () => {
    const plan = planEffortChoice(["high", "minimal", "medium"]);
    expect(plan).toEqual({
      kind: "choose",
      levels: ["minimal", "medium", "high"],
      highest: "high",
    });
  });

  it("allows a model whose top level is max rather than xhigh", () => {
    expect(planEffortChoice(["low", "high", "max"])).toEqual({
      kind: "choose",
      levels: ["low", "high", "max"],
      highest: "max",
    });
  });

  it("recommends an advisor two steps down the model own ladder", () => {
    expect(advisorRecommendation(LADDER_FULL, "xhigh")).toBe("medium");
    expect(advisorRecommendation(LADDER_FULL, "high")).toBe("low");
  });

  it("clamps the recommendation to the lowest level the model publishes", () => {
    expect(advisorRecommendation(LADDER_FULL, "low")).toBe("minimal");
    expect(advisorRecommendation(LADDER_FULL, "minimal")).toBe("minimal");
    // A sparse ladder counts its own positions, so two steps cannot invent
    // a level between high and max.
    expect(advisorRecommendation(["high", "max"], "max")).toBe("high");
  });
});
