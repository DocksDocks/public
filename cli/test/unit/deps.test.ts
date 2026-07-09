import { describe, expect, it } from "vitest"
import { DEPENDENCIES } from "../../src/engine-native/deps"

describe("DependencyManager registry", () => {
  it("gives the win32 git hint (winget)", () => {
    expect(DEPENDENCIES.git.installHint("win32")).toBe("winget install Git.Git (then open a new terminal)")
  })

  it("gives executable unix git hints", () => {
    expect(DEPENDENCIES.git.installHint("darwin")).toBe("brew install git")
    expect(DEPENDENCIES.git.installHint("linux")).toBe("sudo apt install -y git (or your distro's package manager)")
  })

  it("registers the Node-shipped launchers npm and npx", () => {
    expect(DEPENDENCIES.npm.installHint()).toContain("Node.js")
    expect(DEPENDENCIES.npx.installHint()).toContain("Node.js")
    expect(DEPENDENCIES.npm.requirement).toBe("optional")
  })

  it("registers Chrome-for-Testing, LSP binaries, and ffplay", () => {
    expect(Object.keys(DEPENDENCIES)).toEqual(
      expect.arrayContaining(["chrome-for-testing", "intelephense", "typescript-language-server", "tsc", "ffplay"])
    )
  })

  it("gives platform-correct jq hints", () => {
    expect(DEPENDENCIES.jq.installHint("win32")).toContain("winget install jqlang.jq")
    expect(DEPENDENCIES.jq.installHint("darwin")).toBe("brew install jq")
    expect(DEPENDENCIES.jq.installHint("linux")).toBe("sudo apt install -y jq")
  })

  it("every dependency has a non-empty hint and version args", () => {
    for (const spec of Object.values(DEPENDENCIES)) {
      expect(spec.installHint("linux").length).toBeGreaterThan(0)
      expect(spec.installHint("win32").length).toBeGreaterThan(0)
      expect(spec.versionArgs.length).toBeGreaterThan(0)
    }
  })

  it("marks preflight tools required and degradable tools optional", () => {
    expect(DEPENDENCIES.jq.requirement).toBe("required")
    expect(DEPENDENCIES.curl.requirement).toBe("required")
    expect(DEPENDENCIES.git.requirement).toBe("optional")
    expect(DEPENDENCIES.claude.requirement).toBe("optional")
  })
})
