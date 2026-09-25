import { describe, expect, it } from "vitest";

import {
  advisorCatalog,
  effortCatalog,
  isEffortModifierValue,
  resolveEffort,
  sotEffort,
  validateEffortDefault,
} from "../../src/efforts";

describe("deploy-time effort catalogs", () => {
  it("accepts each tool's distinct limits and rejects unknown efforts", () => {
    expect(isEffortModifierValue("claude", "xhigh")).toBe(true);
    expect(isEffortModifierValue("claude", "ultra")).toBe(false);
    expect(isEffortModifierValue("codex", "ultra")).toBe(true);
    expect(isEffortModifierValue("codex", "default")).toBe(true);
    expect(isEffortModifierValue("codex", "future")).toBe(false);
  });

  it("resolves embedded defaults and rejects invalid explicit efforts", () => {
    expect(sotEffort("claude")).toBe("high");
    expect(sotEffort("codex")).toBe("high");
    expect(resolveEffort("claude", "default")).toBe("high");
    expect(resolveEffort("codex", "default")).toBe("high");
    expect(resolveEffort("claude", "low")).toBe("low");
    expect(resolveEffort("codex", "ultra")).toBe("ultra");
    expect(() => resolveEffort("claude", "ultra")).toThrow("Invalid claude effort 'ultra'");
    expect(() => resolveEffort("codex", "future")).toThrow("Invalid codex effort 'future'");
  });

  it("rejects missing or out-of-catalog embedded defaults", () => {
    expect(validateEffortDefault("claude", "low")).toBe("low");
    expect(validateEffortDefault("codex", "ultra")).toBe("ultra");
    expect(() => validateEffortDefault("claude", "max")).toThrow(
      "Embedded SoT Claude effortLevel 'max' is outside the verified catalog",
    );
    expect(() => validateEffortDefault("codex", undefined)).toThrow(
      "Embedded SoT Codex model_reasoning_effort is missing",
    );
  });

  it("renders exact discoverable catalogs with per-tool defaults", () => {
    expect(effortCatalog("claude")).toBe(
      [
        "Available claude effort levels (effortLevel; verified 2026-07-10):",
        "  low",
        "  medium",
        "  high",
        "  xhigh",
        "  default  — SoT: high",
      ].join("\n"),
    );
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
        "  default  — SoT: high",
        "  (support is model-dependent)",
      ].join("\n"),
    );
    expect(advisorCatalog()).toBe(
      [
        "Available claude advisor states (advisorModel; verified 2026-09-22):",
        "  on  — set advisorModel: opus",
        "  off  — unset advisorModel",
        "  default  — SoT: off (unset)",
      ].join("\n"),
    );
  });
});
