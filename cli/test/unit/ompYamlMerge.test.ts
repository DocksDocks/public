import { describe, expect, it } from "vitest"
import { parse } from "yaml"

import { mergeOmpConfig } from "../../src/engine-native/ompYaml"

describe("omp YAML merge", () => {
  it("recurses into nested mappings", () => {
    const merged = mergeOmpConfig("a: { b: 1 }\n", "a: { c: 2 }\n")

    expect(parse(merged)).toEqual({ a: { b: 1, c: 2 } })
  })

  it("replaces a deployed sequence with the SoT sequence", () => {
    const merged = mergeOmpConfig(
      "models:\n  - kit/model\n",
      "models:\n  - user/first\n  - user/second\n"
    )

    expect(parse(merged)).toEqual({ models: ["kit/model"] })
  })

  it("replaces a deployed scalar with the SoT scalar", () => {
    const merged = mergeOmpConfig("theme: kit\n", "theme: user\n")

    expect(parse(merged)).toEqual({ theme: "kit" })
  })

  it("keeps a deployed-only top-level key", () => {
    const merged = mergeOmpConfig("managed: true\n", "userOnly: preserved\n")

    expect(parse(merged)).toEqual({ managed: true, userOnly: "preserved" })
  })

  it("keeps an unknown deployed-only role under retry.fallbackChains", () => {
    const merged = mergeOmpConfig(
      "retry:\n  fallbackChains:\n    coding:\n      - kit/model\n",
      "retry:\n  fallbackChains:\n    releaseManager:\n      - user/model\n"
    )

    expect(parse(merged)).toEqual({
      retry: {
        fallbackChains: {
          coding: ["kit/model"],
          releaseManager: ["user/model"]
        }
      }
    })
  })

  it("drops deployed-only slash keys under retry.fallbackChains while keeping role siblings", () => {
    const merged = mergeOmpConfig(
      "retry:\n  fallbackChains:\n    coding:\n      - kit/model\n",
      [
        "retry:",
        "  fallbackChains:",
        "    reviewer:",
        "      - user/reviewer",
        '    "provider/*":',
        "      - user/wildcard",
        '    "vendor/model":',
        "      - user/model",
        ""
      ].join("\n")
    )

    expect(parse(merged)).toEqual({
      retry: {
        fallbackChains: {
          coding: ["kit/model"],
          reviewer: ["user/reviewer"]
        }
      }
    })
  })

  it("keeps a deployed-only slash key outside retry.fallbackChains", () => {
    const merged = mergeOmpConfig(
      "modelRoles:\n  coding: kit/model\n",
      'modelRoles:\n  "provider/*": user/model\n'
    )

    expect(parse(merged)).toEqual({
      modelRoles: {
        coding: "kit/model",
        "provider/*": "user/model"
      }
    })
  })

  it("returns the SoT text byte for byte for an empty deployed file", () => {
    const sotText = "# managed\nvalue: 1\n"

    expect(mergeOmpConfig(sotText, "")).toBe(sotText)
  })

  it("returns the SoT text byte for byte for a whitespace-only deployed file", () => {
    const sotText = "# managed\nvalue: 1\n"

    expect(mergeOmpConfig(sotText, " \n\t\n")).toBe(sotText)
  })

  it("preserves SoT comments", () => {
    const merged = mergeOmpConfig("# managed by docks-kit\nvalue: 1\n", "userOnly: true\n")

    expect(merged).toContain("# managed by docks-kit")
  })

  it("throws for invalid deployed YAML", () => {
    expect(() => mergeOmpConfig("value: 1\n", "[unterminated\n")).toThrow(
      /Invalid deployed omp config YAML:/
    )
  })

  it("throws when the deployed root is a sequence", () => {
    expect(() => mergeOmpConfig("value: 1\n", "- first\n- second\n")).toThrow(
      /Deployed omp config YAML root must be a mapping/
    )
  })
})
