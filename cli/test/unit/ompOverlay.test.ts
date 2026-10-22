import { readFileSync } from "node:fs";
import { delimiter, join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";

import type { OmpSessionModel } from "../../src/engine-native/harnesses";
import {
  advisorLevelFor,
  advisorRecommendation,
  buildOmpArgs,
  ladderCeiling,
  ompChildEnvironment,
  overlayFileName,
  parseFreeModels,
  planEffortChoice,
  renderFreeOverlay,
  THINKING_LADDER,
} from "../../src/engine-native/ompOverlay";

const FREE_SELECTOR = "opencode-zen/muse-spark-1.3-contributor-free";

const REPO_DIR = resolve(import.meta.dirname, "..", "..", "..");

// Keys the overlay leaves to the deployed config on purpose. The `web` role
// and its chain keep the deployed web-search provider order. The launcher
// docs state that this order can include a paid model.
const DEPLOYED_ONLY_KEYS = ["web"];

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
  "reviewer",
  "memory",
  "judge",
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
  "reviewer",
  "memory",
  "judge",
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

function renderedRoles(model: OmpSessionModel): Record<string, string> {
  const parsed = parse(renderFreeOverlay(model)) as Record<string, unknown>;
  return parsed["modelRoles"] as Record<string, string>;
}

const LADDER_MODEL: OmpSessionModel = {
  selector: FREE_SELECTOR,
  thinking: "high",
  advisorThinking: "low",
};
const LEVEL_FREE_MODEL: OmpSessionModel = { selector: "provider/ling-free" };
const OVERLAY_PATH = join("cache", "docks-kit", "omp-free.yml");

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
        // omp prices usage-billed and plan-included models at zero cost.
        {
          selector: "cursor/default",
          name: "Auto",
          thinking: [],
          contextWindow: 100,
          cost: { input: 0, output: 0 },
          pricingStatus: "variable",
        },
        {
          selector: "plan/included",
          name: "Included",
          thinking: [],
          contextWindow: 100,
          cost: { input: 0, output: 0 },
          pricingStatus: "included",
        },
        {
          selector: "status/unknown",
          name: "Unknown status",
          thinking: [],
          contextWindow: 100,
          cost: { input: 0, output: 0 },
          pricingStatus: "unknown",
        },
        {
          selector: FREE_SELECTOR,
          name: "Muse Spark 1.3 Free",
          thinking: ["minimal", "low", "medium", "high", "xhigh", "ultra"],
          contextWindow: 1048576,
          cost: { input: 0, output: 0 },
          pricingStatus: "free",
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
      { selector: "status/unknown", name: "Unknown status", thinking: [], contextWindow: 100 },
    ]);
    expect(parseFreeModels(undefined)).toEqual([]);
    expect(parseFreeModels({})).toEqual([]);
  });

  it("keeps distinct models and levels in separate, repeatable overlay files", () => {
    const high = { selector: "opencode-zen/muse", thinking: "high", advisorThinking: "low" };
    const name = overlayFileName(high);
    expect(name).toMatch(/^omp-free-[A-Za-z0-9._-]+\.yml$/);
    expect(overlayFileName({ ...high })).toBe(name);
    // A running session reloads its overlay when the file changes, so another
    // level for the same model must not share the file.
    expect(
      overlayFileName({
        selector: "opencode-zen/muse",
        thinking: "xhigh",
        advisorThinking: "medium",
      }),
    ).not.toBe(name);
    // These selectors have the same sanitized spelling but must not overwrite
    // each other's live-session overlay.
    expect(overlayFileName({ selector: "opencode-zen/muse" })).not.toBe(
      overlayFileName({ selector: "opencode-zen-muse" }),
    );
  });

  it("covers every deployed role and retry chain or declares it deployed-only", () => {
    const sot = parse(readFileSync(join(REPO_DIR, "SoT", ".omp", "config.yml"), "utf8")) as Record<
      string,
      unknown
    >;
    const overlay = parse(
      renderFreeOverlay({ selector: FREE_SELECTOR, thinking: "xhigh", advisorThinking: "medium" }),
    ) as Record<string, unknown>;
    const overlayRoles = Object.keys(overlay["modelRoles"] as Record<string, unknown>);
    const overlayChains = Object.keys(fallbackChains(overlay));
    const sotRoles = Object.keys(sot["modelRoles"] as Record<string, unknown>);
    const sotChains = Object.keys(fallbackChains(sot));
    expect(
      sotRoles.filter((key) => !overlayRoles.includes(key) && !DEPLOYED_ONLY_KEYS.includes(key)),
    ).toEqual([]);
    expect(
      sotChains.filter((key) => !overlayChains.includes(key) && !DEPLOYED_ONLY_KEYS.includes(key)),
    ).toEqual([]);
    // A deployed-only key must stay out of the overlay, or the docs that
    // describe it as deployed would be wrong.
    for (const key of DEPLOYED_ONLY_KEYS) {
      expect(overlayRoles).not.toContain(key);
      expect(overlayChains).not.toContain(key);
    }
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

describe("free model fallback chains", () => {
  it.each([
    ["a model with a ladder", LADDER_MODEL],
    ["a level-free model", LEVEL_FREE_MODEL],
  ])(
    "empties the chains keyed by the selector, :off, and every ladder level for %s",
    (_label, model) => {
      // A chain keyed by the model outranks a role chain, and the session can
      // run the free model at any concrete level.
      const chains = fallbackChains(parse(renderFreeOverlay(model)) as Record<string, unknown>);
      expect(chains[model.selector]).toEqual([]);
      expect(chains[`${model.selector}:off`]).toEqual([]);
      for (const level of THINKING_LADDER) {
        expect(chains[`${model.selector}:${level}`]).toEqual([]);
      }
      for (const key of FALLBACK_KEYS) {
        expect(chains[key]).toEqual([]);
      }
    },
  );
});

describe("buildOmpArgs", () => {
  it("starts omp with launch, the overlay, and the session model at its level", () => {
    const args = buildOmpArgs(OVERLAY_PATH, LADDER_MODEL, ["-p", "commit"]);
    expect(args).toEqual([
      "launch",
      "--config",
      OVERLAY_PATH,
      "--model",
      `${FREE_SELECTOR}:high`,
      "-p",
      "commit",
    ]);
    // The explicit model is the overlay's default role, so a restored
    // session model cannot replace it.
    expect(args[4]).toBe(renderedRoles(LADDER_MODEL)["default"]);
  });

  it("passes the bare selector for a model without a ladder", () => {
    const args = buildOmpArgs(OVERLAY_PATH, LEVEL_FREE_MODEL, ["--continue"]);
    expect(args).toEqual([
      "launch",
      "--config",
      OVERLAY_PATH,
      "--model",
      "provider/ling-free",
      "--continue",
    ]);
    expect(args[4]).toBe(renderedRoles(LEVEL_FREE_MODEL)["default"]);
  });
});

describe("ompChildEnvironment", () => {
  const roles = renderedRoles(LADDER_MODEL);

  it("adds the overlay and the overlay role models to an empty environment", () => {
    expect(ompChildEnvironment({}, OVERLAY_PATH, LADDER_MODEL)).toEqual({
      env: {
        PI_CONFIG_FILES: OVERLAY_PATH,
        PI_SMOL_MODEL: roles["smol"],
        PI_SLOW_MODEL: roles["slow"],
        PI_PLAN_MODEL: roles["plan"],
      },
      replaced: [],
    });
  });

  it("uses the bare selector for a level-free model", () => {
    const bare = renderedRoles(LEVEL_FREE_MODEL);
    const { env } = ompChildEnvironment({}, OVERLAY_PATH, LEVEL_FREE_MODEL);
    expect(env["PI_SMOL_MODEL"]).toBe(bare["smol"]);
    expect(env["PI_SLOW_MODEL"]).toBe(bare["slow"]);
    expect(env["PI_PLAN_MODEL"]).toBe(bare["plan"]);
  });

  it("appends the overlay after the inherited PI_CONFIG_FILES entries and keeps other variables", () => {
    const inherited = [join("team", "a.yml"), "", join("team", "b.yml")].join(delimiter);
    const { env } = ompChildEnvironment(
      { PI_CONFIG_FILES: inherited, KEEP_ME: "1" },
      OVERLAY_PATH,
      LADDER_MODEL,
    );
    expect(env["PI_CONFIG_FILES"]).toBe(
      [join("team", "a.yml"), join("team", "b.yml"), OVERLAY_PATH].join(delimiter),
    );
    expect(env["KEEP_ME"]).toBe("1");
  });

  it("lists only a non-empty parent model variable that differs from the overlay value", () => {
    const { env, replaced } = ompChildEnvironment(
      { PI_SMOL_MODEL: "paid/x", PI_SLOW_MODEL: roles["slow"], PI_PLAN_MODEL: "" },
      OVERLAY_PATH,
      LADDER_MODEL,
    );
    expect(replaced).toEqual(["PI_SMOL_MODEL"]);
    expect(env["PI_SMOL_MODEL"]).toBe(roles["smol"]);
    expect(env["PI_SLOW_MODEL"]).toBe(roles["slow"]);
    expect(env["PI_PLAN_MODEL"]).toBe(roles["plan"]);
  });

  it("lists replaced variables in smol, slow, plan order", () => {
    const { replaced } = ompChildEnvironment(
      { PI_PLAN_MODEL: "paid/p", PI_SLOW_MODEL: "paid/s", PI_SMOL_MODEL: "paid/x" },
      OVERLAY_PATH,
      LADDER_MODEL,
    );
    expect(replaced).toEqual(["PI_SMOL_MODEL", "PI_SLOW_MODEL", "PI_PLAN_MODEL"]);
  });

  it("does not mutate the parent environment", () => {
    const parent = { PI_CONFIG_FILES: join("team", "a.yml"), PI_SMOL_MODEL: "paid/x" };
    const before = { ...parent };
    const { env } = ompChildEnvironment(parent, OVERLAY_PATH, LADDER_MODEL);
    expect(parent).toEqual(before);
    expect(env).not.toBe(parent);
  });
});
