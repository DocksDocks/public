import { describe, expect, it } from "vitest"

import { resolveFreeSelector } from "../../src/commands/omp"
import type { CatalogModel } from "../../src/engine-native/ompOverlay"

const FREE: ReadonlyArray<CatalogModel> = [
  {
    selector: "opencode-zen/muse-spark-1.3-contributor-free",
    name: "Muse Spark 1.3 Free",
    thinking: ["minimal", "low", "medium", "high", "xhigh"],
    contextWindow: 1048576
  },
  {
    selector: "opencode-zen/glm-4.7-free",
    name: "GLM 4.7 Free",
    thinking: ["minimal", "low", "medium"],
    contextWindow: 204800
  }
]

describe("resolveFreeSelector", () => {
  it("matches an exact selector", () => {
    const resolved = resolveFreeSelector("opencode-zen/glm-4.7-free", FREE)
    expect(resolved).toEqual({ ok: true, model: FREE[1] })
  })

  it("matches a unique case-insensitive substring", () => {
    const resolved = resolveFreeSelector("SPARK", FREE)
    expect(resolved).toEqual({ ok: true, model: FREE[0] })
  })

  it("rejects an ambiguous substring by listing the matches", () => {
    const resolved = resolveFreeSelector("opencode-zen", FREE)
    expect(resolved.ok).toBe(false)
    if (!resolved.ok) {
      expect(resolved.message).toContain("ambiguous")
      expect(resolved.message).toContain("opencode-zen/muse-spark-1.3-contributor-free")
      expect(resolved.message).toContain("opencode-zen/glm-4.7-free")
    }
  })

  it("rejects a paid or unknown selector by naming the free catalog", () => {
    const resolved = resolveFreeSelector("opencode-zen/kimi-paid", FREE)
    expect(resolved.ok).toBe(false)
    if (!resolved.ok) {
      expect(resolved.message).toContain("not in the free catalog")
      expect(resolved.message).toContain("opencode-zen/muse-spark-1.3-contributor-free")
      expect(resolved.message).toContain("opencode-zen/glm-4.7-free")
    }
  })
})
