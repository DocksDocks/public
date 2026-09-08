import { describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  payloadText: vi.fn<(path: string) => string>()
}))

vi.mock("../../src/payload", () => ({ payloadText: mocks.payloadText, payloadDisplayPath: (p: string) => p }))

import { modelCatalog } from "../../src/engine-native/models"

describe("modelCatalog typed boundary", () => {
  it("keeps well-formed entries in document order and drops malformed ones", () => {
    mocks.payloadText.mockReturnValue(
      JSON.stringify({
        claude: {
          verified: "2026-01-01",
          models: [
            { id: "opus", kind: "alias", note: "latest" },
            { id: "claude-opus-5", kind: "id" },
            { id: 42, kind: "id" },
            { id: "bad-kind", kind: "pinned" },
            { kind: "alias" },
            "not-an-object"
          ]
        }
      })
    )
    expect(modelCatalog("claude")).toEqual({
      verified: "2026-01-01",
      models: [
        { id: "opus", kind: "alias", note: "latest" },
        { id: "claude-opus-5", kind: "id" }
      ]
    })
  })

  it("returns an empty catalog for a missing tool section or unparseable document", () => {
    mocks.payloadText.mockReturnValue(JSON.stringify({ claude: { verified: "2026-01-01", models: [] } }))
    expect(modelCatalog("codex")).toEqual({ verified: "?", models: [] })
    mocks.payloadText.mockReturnValue("{ not json")
    expect(modelCatalog("claude")).toEqual({ verified: "?", models: [] })
  })
})
