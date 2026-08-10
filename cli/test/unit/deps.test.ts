import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import { DEPENDENCIES, type ProbeExecutor } from "../../src/engine-native/deps"
import { makeDependencyManager, makePlatform } from "../../src/engine-native/services"

describe("DependencyManager registry", () => {

  it("gives executable Linux and macOS git hints", () => {
    expect(DEPENDENCIES.git.installHint("darwin")).toBe("brew install git")
    expect(DEPENDENCIES.git.installHint("linux")).toBe("sudo apt install -y git (or your distro's package manager)")
  })

  it("registers the Node-shipped launchers npm and npx", () => {
    expect(DEPENDENCIES.npm.installHint()).toContain("Node.js")
    expect(DEPENDENCIES.npx.installHint()).toContain("Node.js")
    expect(DEPENDENCIES.npm.requirement).toBe("optional")
  })

  it("registers the LSP binaries and ffplay", () => {
    expect(Object.keys(DEPENDENCIES)).toEqual(
      expect.arrayContaining(["intelephense", "typescript-language-server", "tsc", "ffplay"])
    )
  })

  it("gives platform-correct jq hints", () => {
    expect(DEPENDENCIES.jq.installHint("darwin")).toBe("brew install jq")
    expect(DEPENDENCIES.jq.installHint("linux")).toBe("sudo apt install -y jq")
  })

  it("every dependency has a non-empty hint and version args", () => {
    for (const spec of Object.values(DEPENDENCIES)) {
      expect(spec.installHint("linux").length).toBeGreaterThan(0)
      expect(spec.installHint("darwin").length).toBeGreaterThan(0)
      expect(spec.versionArgs.length).toBeGreaterThan(0)
    }
  })

  it("marks jq and curl as contextual optional tools", () => {
    expect(DEPENDENCIES.jq.requirement).toBe("optional")
    expect(DEPENDENCIES.curl.requirement).toBe("optional")
    expect(DEPENDENCIES.git.requirement).toBe("optional")
    expect(DEPENDENCIES.claude.requirement).toBe("optional")
  })

  it("reads the intelephense version from one memoized npm global listing", () => {
    const captures: Array<[string, ReadonlyArray<string>]> = []
    const manager = makeDependencyManager(makePlatform("linux"), {
      commandExists: () => true,
      capture: (cmd, args) => {
        captures.push([cmd, args])
        return '{"dependencies":{"intelephense":{"version":"1.18.4"}}}'
      },
      which: (name) => `/stub/${name}`
    })
    expect(manager.version("intelephense")).toBe("1.18.4")
    expect(manager.version("intelephense")).toBe("1.18.4")
    expect(captures).toEqual([["npm", ["ls", "-g", "--depth=0", "--json"]]])
  })

  it("reports no intelephense version when npm is absent", () => {
    const captures: Array<[string, ReadonlyArray<string>]> = []
    const manager = makeDependencyManager(makePlatform("linux"), {
      commandExists: (name) => name !== "npm",
      capture: (cmd, args) => {
        captures.push([cmd, args])
        return ""
      },
      which: (name) => (name !== "npm" ? `/stub/${name}` : "")
    })
    expect(manager.version("intelephense")).toBe("")
    expect(captures).toEqual([])
  })

  it("locates the supported effect-solutions executable", () => {
    const globalBin = "/bun/global/bin"
    const executor = (files: ReadonlyArray<string>): ProbeExecutor => ({
      commandExists: (name) => name === "effect-solutions",
      capture: (cmd, args) => (cmd === "bun" && args.join(" ") === "pm -g bin" ? globalBin : ""),
      which: (name) => (name === "bun" || files.includes(name) ? name : "")
    })

    const resolved = makeDependencyManager(makePlatform("linux"), executor([`${globalBin}/effect-solutions`]))
    expect(resolved.path("effect-solutions")).toBe(`${globalBin}/effect-solutions`)
  })

  it("preserves the original fixed-home Bun version fallbacks", () => {
    const previousHome = process.env["HOME"]
    const previousBunInstall = process.env["BUN_INSTALL"]
    const calls: Array<[string, ReadonlyArray<string>]> = []
    try {
      process.env["HOME"] = "/fixture-home"
      process.env["BUN_INSTALL"] = "/custom-bun"
      const manager = makeDependencyManager(makePlatform("linux"), {
        commandExists: (name) => name === "effect-solutions",
        capture: (cmd, args) => {
          calls.push([cmd, args])
          return cmd === "/custom-bun/bin/bun" ? "effect-solutions@0.5.3" : ""
        },
        which: (name) => (name === "/custom-bun/bin/bun" ? name : "")
      })

      expect(manager.version("bun")).toBe("")
      expect(manager.version("effect-solutions")).toBe("")
      expect(calls).toEqual([["/fixture-home/.bun/bin/bun", ["--version"]]])
    } finally {
      if (previousHome === undefined) delete process.env["HOME"]
      else process.env["HOME"] = previousHome
      if (previousBunInstall === undefined) delete process.env["BUN_INSTALL"]
      else process.env["BUN_INSTALL"] = previousBunInstall
    }
  })

  it("rejects relative POSIX bun paths from PATH and BUN_INSTALL fallbacks", () => {
    const previousHome = process.env["HOME"]
    const previousBunInstall = process.env["BUN_INSTALL"]
    try {
      process.env["HOME"] = "/fixture-home"
      process.env["BUN_INSTALL"] = "relative-bun"
      const fallback = "/fixture-home/.bun/bin/bun"
      const withFallback = makeDependencyManager(makePlatform("linux"), {
        commandExists: () => true,
        capture: () => "",
        which: (name) => (name === "bun" ? "relative/bin/bun" : name === "relative-bun/bin/bun" || name === fallback ? name : "")
      })
      expect(withFallback.probe("bun")).toEqual({ state: "present", path: fallback })

      const onlyRelative = makeDependencyManager(makePlatform("linux"), {
        commandExists: () => true,
        capture: () => "",
        which: (name) => (name === "bun" ? "relative/bin/bun" : "")
      })
      expect(onlyRelative.probe("bun")).toEqual({ state: "missing" })
    } finally {
      if (previousHome === undefined) delete process.env["HOME"]
      else process.env["HOME"] = previousHome
      if (previousBunInstall === undefined) delete process.env["BUN_INSTALL"]
      else process.env["BUN_INSTALL"] = previousBunInstall
    }
  })


  it("keeps presence results focused on presence and path", () => {
    const manager = makeDependencyManager(makePlatform("linux"), {
      commandExists: () => true,
      capture: () => "9.9.9",
      which: (name) => `/stub/${name}`
    })
    expect(manager.probe("git")).toEqual({ state: "present", path: "/stub/git" })
  })
})
