import { describe, expect, it } from "vitest"

import {
  CLAUDE_ADVISOR_STATES,
  CLAUDE_EFFORT_LEVELS,
  CODEX_REASONING_EFFORTS,
  advisorCatalog,
  effortCatalog,
  effortModifierValues,
  isEffortModifierValue,
  resolveEffort,
  sotEffort,
  validateEffortDefault
} from "../../src/efforts"

describe("deploy-time effort catalogs", () => {
  it("keeps the researched per-tool enums distinct and ordered", () => {
    expect(CLAUDE_EFFORT_LEVELS).toEqual(["low", "medium", "high", "xhigh"])
    expect(CODEX_REASONING_EFFORTS).toEqual([
      "none",
      "minimal",
      "low",
      "medium",
      "high",
      "xhigh",
      "max",
      "ultra"
    ])
    expect(CLAUDE_ADVISOR_STATES).toEqual(["on", "off", "default"])
    expect(effortModifierValues("claude")).toEqual(["low", "medium", "high", "xhigh", "default"])
    expect(effortModifierValues("codex")).toEqual([
      "none",
      "minimal",
      "low",
      "medium",
      "high",
      "xhigh",
      "max",
      "ultra",
      "default"
    ])
  })

  it("validates the vocabulary without pretending the tools share it", () => {
    expect(isEffortModifierValue("claude", "xhigh")).toBe(true)
    expect(isEffortModifierValue("claude", "ultra")).toBe(false)
    expect(isEffortModifierValue("codex", "ultra")).toBe(true)
    expect(isEffortModifierValue("codex", "default")).toBe(true)
    expect(isEffortModifierValue("codex", "future")).toBe(false)
  })

  it("resolves default from each embedded SoT and rejects invalid embedded values", () => {
    expect(sotEffort("claude")).toBe("high")
    expect(sotEffort("codex")).toBe("xhigh")
    expect(resolveEffort("claude", "default")).toBe(sotEffort("claude"))
    expect(resolveEffort("codex", "default")).toBe(sotEffort("codex"))
    expect(resolveEffort("claude", "low")).toBe("low")
    expect(resolveEffort("codex", "ultra")).toBe("ultra")
    expect(() => validateEffortDefault("claude", "max")).toThrow(
      "Embedded SoT Claude effortLevel 'max' is outside the verified catalog"
    )
    expect(() => validateEffortDefault("codex", undefined)).toThrow(
      "Embedded SoT Codex model_reasoning_effort is missing"
    )
  })

  it("renders exact discoverable catalogs with per-tool defaults", () => {
    expect(effortCatalog("claude")).toBe(
      [
        "Available claude effort levels (effortLevel; verified 2026-07-10):",
        "  low",
        "  medium",
        "  high",
        "  xhigh",
        `  default  — SoT: ${sotEffort("claude")}`
      ].join("\n")
    )
    expect(effortCatalog("codex")).toBe(
      [
        "Available codex effort levels (model_reasoning_effort; verified 2026-07-10):",
        "  none",
        "  minimal",
        "  low",
        "  medium",
        "  high",
        "  xhigh",
        "  max",
        "  ultra",
        `  default  — SoT: ${sotEffort("codex")}`,
        "  (support is model-dependent)"
      ].join("\n")
    )
    expect(advisorCatalog()).toBe(
      [
        "Available claude advisor states (advisorModel; verified 2026-07-10):",
        "  on  — set advisorModel: fable",
        "  off  — unset advisorModel",
        "  default  — SoT: off (unset)"
      ].join("\n")
    )
  })
})
