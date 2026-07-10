import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import { DEPENDENCIES, type ProbeExecutor } from "../../src/engine-native/deps"
import { makeDependencyManager, makePlatform } from "../../src/engine-native/services"

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

  it("locates only the platform-correct effect-solutions executable", () => {
    const globalBin = "/bun/global/bin"
    const executor = (files: ReadonlyArray<string>): ProbeExecutor => ({
      commandExists: (name) => name === "effect-solutions",
      capture: (cmd, args) => (cmd === "bun" && args.join(" ") === "pm -g bin" ? globalBin : ""),
      which: (name) => (name === "bun" || files.includes(name) ? name : "")
    })

    const unixBare = makeDependencyManager(makePlatform("linux"), executor([`${globalBin}/effect-solutions`]))
    expect(unixBare.path("effect-solutions")).toBe(`${globalBin}/effect-solutions`)

    const unixStaleShim = makeDependencyManager(makePlatform("linux"), executor([`${globalBin}/effect-solutions.cmd`]))
    expect(unixStaleShim.path("effect-solutions")).toBe("")

    const windowsShim = makeDependencyManager(makePlatform("win32"), executor([`${globalBin}/effect-solutions.cmd`]))
    expect(windowsShim.path("effect-solutions")).toBe(`${globalBin}/effect-solutions.cmd`)
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

  it("requires an absolute bun.exe on Windows and ignores a shadowing bun.cmd", () => {
    const previousHome = process.env["HOME"]
    const previousBunInstall = process.env["BUN_INSTALL"]
    try {
      process.env["HOME"] = "C:/Users/Test"
      process.env["BUN_INSTALL"] = "C:/Custom Bun"
      const fallback = "C:/Custom Bun/bin/bun.exe"
      const withFallback = makeDependencyManager(makePlatform("win32"), {
        commandExists: () => true,
        capture: () => "",
        which: (name) => name === "bun" ? "C:/shadow/bun.cmd" : name === fallback ? fallback : ""
      })
      expect(withFallback.probe("bun")).toEqual({ state: "present", path: fallback })

      const onlyCmd = makeDependencyManager(makePlatform("win32"), {
        commandExists: () => true,
        capture: () => "",
        which: (name) => name === "bun" ? "C:/shadow/bun.cmd" : ""
      })
      expect(onlyCmd.probe("bun")).toEqual({ state: "missing" })

      const pathExe = makeDependencyManager(makePlatform("win32"), {
        commandExists: () => true,
        capture: () => "",
        which: (name) => name === "bun" ? "C:/Tools/BUN.EXE" : ""
      })
      expect(pathExe.path("bun")).toBe("C:/Tools/BUN.EXE")
    } finally {
      if (previousHome === undefined) delete process.env["HOME"]
      else process.env["HOME"] = previousHome
      if (previousBunInstall === undefined) delete process.env["BUN_INSTALL"]
      else process.env["BUN_INSTALL"] = previousBunInstall
    }
  })

  it("finds agent-browser managed Chrome without invoking a command", () => {
    const root = mkdtempSync(join(tmpdir(), "deps-chrome-"))
    const previousHome = process.env["HOME"]
    const executable = join(root, ".agent-browser", "browsers", "chrome-148.0.0.0", "chrome")
    const captures: Array<[string, ReadonlyArray<string>]> = []
    try {
      mkdirSync(join(executable, ".."), { recursive: true })
      writeFileSync(executable, "#!/bin/sh\n")
      chmodSync(executable, 0o755)
      process.env["HOME"] = root
      const manager = makeDependencyManager(makePlatform("linux"), {
        commandExists: () => false,
        capture: (cmd, args) => {
          captures.push([cmd, args])
          return ""
        },
        which: (name) => (name === executable ? name : "")
      })

      expect(manager.probe("chrome-for-testing")).toEqual({ state: "present", path: executable })
      expect(captures).toEqual([])
    } finally {
      if (previousHome === undefined) delete process.env["HOME"]
      else process.env["HOME"] = previousHome
      rmSync(root, { recursive: true, force: true })
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
