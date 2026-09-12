import { describe, expect, it } from "vitest"
import { parse } from "yaml"

import {
  advisorLevelFor,
  buildOmpArgs,
  ladderCeiling,
  overlayFileName,
  parseFreeModels,
  renderFreeOverlay,
  THINKING_LADDER,
} from "../../src/engine-native/ompOverlay"

const FREE_SELECTOR = "opencode-zen/muse-spark-1.3-contributor-free"

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
]

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
]

// The six ladders observed in the live free catalog.
const LADDER_FULL = ["minimal", "low", "medium", "high", "xhigh"]
const LADDER_TRIO = ["low", "medium", "high"]
const LADDER_NO_XHIGH = ["minimal", "low", "medium", "high"]
const LADDER_LOW_HIGH_MAX = ["low", "high", "max"]
const LADDER_HIGH_MAX = ["high", "max"]
const LADDER_EMPTY: ReadonlyArray<string> = []

function fallbackChains(parsed: Record<string, unknown>): Record<string, unknown> {
  return (parsed["retry"] as Record<string, unknown>)["fallbackChains"] as Record<string, unknown>
}

describe("omp free-session overlay", () => {
  it("renders every deployed role at the free selector with advisor at medium", () => {
    const parsed = parse(
      renderFreeOverlay({ selector: FREE_SELECTOR, thinking: "xhigh", advisorThinking: "medium" }),
    ) as Record<string, unknown>
    expect(parsed["defaultThinkingLevel"]).toBe("xhigh")
    const roles = parsed["modelRoles"] as Record<string, string>
    expect(Object.keys(roles).sort()).toEqual([...ROLE_KEYS].sort())
    for (const role of ROLE_KEYS) {
      const level = role === "advisor" ? "medium" : "xhigh"
      expect(roles[role]).toBe(`${FREE_SELECTOR}:${level}`)
      expect(THINKING_LADDER).toContain(level)
    }
    expect(Object.values(roles).join("\n")).not.toContain("max")
    const task = parsed["task"] as Record<string, unknown>
    expect(task["maxEffort"]).toBe("xhigh")
    const chains = fallbackChains(parsed)
    expect(Object.keys(chains).sort()).toEqual([...FALLBACK_KEYS].sort())
    for (const key of FALLBACK_KEYS) {
      expect(chains[key]).toEqual([])
    }
  })

  it("propagates a max-capable ceiling while the advisor stays at medium", () => {
    const parsed = parse(
      renderFreeOverlay({ selector: FREE_SELECTOR, thinking: "max", advisorThinking: "medium" }),
    ) as Record<string, unknown>
    const roles = parsed["modelRoles"] as Record<string, string>
    for (const role of ROLE_KEYS) {
      const level = role === "advisor" ? "medium" : "max"
      expect(roles[role]).toBe(`${FREE_SELECTOR}:${level}`)
    }
  })

  it("derives the advisor level from the model own ladder", () => {
    expect(advisorLevelFor(LADDER_FULL)).toBe("medium")
    expect(advisorLevelFor(LADDER_TRIO)).toBe("medium")
    expect(advisorLevelFor(LADDER_NO_XHIGH)).toBe("medium")
    expect(advisorLevelFor(LADDER_LOW_HIGH_MAX)).toBe("low")
    expect(advisorLevelFor(LADDER_HIGH_MAX)).toBe("high")
    expect(advisorLevelFor(LADDER_EMPTY)).toBeUndefined()
  })

  it("resolves the ceiling from the model own ladder without guessing", () => {
    expect(ladderCeiling(LADDER_FULL)).toBe("xhigh")
    expect(ladderCeiling(LADDER_TRIO)).toBe("high")
    expect(ladderCeiling(LADDER_NO_XHIGH)).toBe("high")
    expect(ladderCeiling(LADDER_LOW_HIGH_MAX)).toBe("max")
    expect(ladderCeiling(LADDER_HIGH_MAX)).toBe("max")
    expect(ladderCeiling(LADDER_EMPTY)).toBeUndefined()
  })

  it("renders a high/max ladder with no level outside that ladder", () => {
    const parsed = parse(
      renderFreeOverlay({
        selector: "provider/big-pickle",
        thinking: "max",
        advisorThinking: "high",
      }),
    ) as Record<string, unknown>
    const roles = parsed["modelRoles"] as Record<string, string>
    expect(roles["advisor"]).toBe("provider/big-pickle:high")
    for (const role of ROLE_KEYS) {
      const expected = role === "advisor" ? "high" : "max"
      expect(roles[role]).toBe(`provider/big-pickle:${expected}`)
      const level = (roles[role] as string).split(":").at(-1) as string
      expect(LADDER_HIGH_MAX).toContain(level)
    }
    expect(parsed["defaultThinkingLevel"]).toBe("max")
    expect((parsed["task"] as Record<string, unknown>)["maxEffort"]).toBe("max")
  })

  it("renders a level-free model with bare selectors and no thinking keys", () => {
    const parsed = parse(renderFreeOverlay({ selector: "provider/ling-free" })) as Record<
      string,
      unknown
    >
    expect("defaultThinkingLevel" in parsed).toBe(false)
    expect("task" in parsed).toBe(false)
    const roles = parsed["modelRoles"] as Record<string, string>
    expect(Object.keys(roles).sort()).toEqual([...ROLE_KEYS].sort())
    for (const role of ROLE_KEYS) {
      expect(roles[role]).toBe("provider/ling-free")
    }
    expect(Object.values(roles).join("\n")).not.toContain(":")
    const chains = fallbackChains(parsed)
    expect(Object.keys(chains).sort()).toEqual([...FALLBACK_KEYS].sort())
    for (const key of FALLBACK_KEYS) {
      expect(chains[key]).toEqual([])
    }
  })

  it("keeps zero-cost rows, drops paid rows, and survives malformed input", () => {
    const catalog = {
      models: [
        {
          selector: "paid/model",
          name: "Paid",
          thinking: ["low", "high"],
          contextWindow: 100,
          cost: { input: 1, output: 0 },
        },
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
    }
    const models = parseFreeModels(catalog)
    expect(models).toHaveLength(1)
    expect(models[0]?.selector).toBe(FREE_SELECTOR)
    // The unknown "ultra" level is dropped while ladder order is preserved.
    expect(models[0]?.thinking).toEqual(["minimal", "low", "medium", "high", "xhigh"])
    expect(models[0]?.contextWindow).toBe(1048576)
    expect(parseFreeModels(undefined)).toEqual([])
    expect(parseFreeModels({})).toEqual([])
  })

  it("keeps the advisor at or below the session ceiling", () => {
    expect(advisorLevelFor(["low"])).toBe("low")
    expect(advisorLevelFor(LADDER_FULL)).toBe("medium")
    const ceiling = ladderCeiling(LADDER_FULL) as string
    const advisor = advisorLevelFor(LADDER_FULL) as string
    expect(THINKING_LADDER.indexOf(advisor)).toBeLessThanOrEqual(THINKING_LADDER.indexOf(ceiling))
  })

  it("builds the omp argv with the overlay flag first", () => {
    expect(buildOmpArgs("/c.yml", ["-p", "hi"])).toEqual(["--config", "/c.yml", "-p", "hi"])
    expect(buildOmpArgs("/c.yml", [])).toEqual(["--config", "/c.yml"])
  })

  it("gives each model its own overlay file so a live session is never rewritten", () => {
    const name = overlayFileName(FREE_SELECTOR)
    expect(name.startsWith("omp-free-")).toBe(true)
    expect(name.endsWith(".yml")).toBe(true)
    // A path separator in the selector must never create a subdirectory.
    expect(name).not.toContain("/")
    expect(overlayFileName("opencode-zen/muse")).not.toEqual(overlayFileName("opencode/zen-muse"))
    expect(overlayFileName(FREE_SELECTOR)).toEqual(name)
  })
})
