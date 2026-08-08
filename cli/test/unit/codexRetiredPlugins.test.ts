import { describe, expect, it } from "vitest"
import { removeRetiredPluginTablesText } from "../../src/engine-native/codexSync"

describe("removeRetiredPluginTablesText", () => {
  it("removes a retired table between surviving plugin tables with one separator", () => {
    const input = `[plugins."docks@docks"]
enabled = true

[plugins."session-relay@docks"]
enabled = true

[plugins."effect-kit@docks"]
enabled = true
`

    expect(removeRetiredPluginTablesText(input)).toBe(`[plugins."docks@docks"]
enabled = true

[plugins."effect-kit@docks"]
enabled = true
`)
  })

  it("removes a retired final table without changing the preceding content", () => {
    const input = `model = "gpt-5.6-sol"

[agents]
max_threads = 4

[plugins."session-relay@docks"]
enabled = true
`

    expect(removeRetiredPluginTablesText(input)).toBe(`model = "gpt-5.6-sol"

[agents]
max_threads = 4

`)
  })

  it("round-trips content without a retired table byte-for-byte", () => {
    const input = `model = "gpt-5.6-sol"

[plugins."docks@docks"]
enabled = true
`

    expect(removeRetiredPluginTablesText(input)).toBe(input)
  })
})
