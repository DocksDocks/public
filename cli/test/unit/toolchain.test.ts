import { describe, expect, it } from "vitest"
import { promptLine } from "../../src/engine-native/toolchain"

describe("toolchain prompt", () => {
  it("keeps the interactive prompt as raw stderr bytes", () => {
    const input = Buffer.from("n\r\n")
    const chunks: Array<string> = []
    let offset = 0
    const answer = promptLine(
      "Install agent-browser 0.99.0 anyway? [y/N] ",
      (chunk) => chunks.push(chunk),
      (buffer) => {
        if (offset >= input.length) return 0
        buffer[0] = input[offset++]!
        return 1
      }
    )

    expect({ answer, prompt: chunks.join("") }).toEqual({
      answer: "n",
      prompt: "Install agent-browser 0.99.0 anyway? [y/N] "
    })
  })
})
