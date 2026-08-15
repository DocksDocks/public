import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, expect, it, vi } from "vitest"
import {
  DEPENDENCIES,
  resolveDependency,
  resolvePath,
  type ProbeExecutor
} from "../../src/engine-native/deps"
import { capture, which } from "../../src/engine-native/exec"
import { makeDependencyManager, makePlatform } from "../../src/engine-native/services"

describe("DependencyManager registry", () => {
  it("captures successful stdout and strips only trailing newlines", async () => {
    await expect(capture(process.execPath, ["-e", 'process.stdout.write(" kept  \\r\\n\\n")'])).resolves.toBe(" kept  ")
  })

  it("returns empty output for a non-zero exit", async () => {
    await expect(
      capture(process.execPath, ["-e", 'process.stdout.write("discarded"); process.exitCode = 7'])
    ).resolves.toBe("")
  })

  it("returns empty output for a spawn error", async () => {
    await expect(capture("docks-kit-command-that-does-not-exist", [])).resolves.toBe("")
  })

  it("returns empty output when spawn rejects invalid arguments synchronously", async () => {
    await expect(capture("\0", [])).resolves.toBe("")
  })

  it("resolves bare POSIX tools and Windows command shims from a real PATH directory", () => {
    const directory = mkdtempSync(join(tmpdir(), "docks-exec-"))
    const previousPath = process.env["PATH"]
    const posixTool = join(directory, "docks-posix-tool")
    const windowsTool = join(directory, "docks-windows-tool.cmd")
    const firstWindowsTool = join(directory, "docks-windows-first.exe")
    const laterWindowsTool = join(directory, "docks-windows-first.cmd")
    try {
      writeFileSync(posixTool, "#!/bin/sh\nexit 0\n")
      chmodSync(posixTool, 0o755)
      writeFileSync(windowsTool, "@echo off\r\n")
      chmodSync(windowsTool, 0o644)
      writeFileSync(firstWindowsTool, "")
      writeFileSync(laterWindowsTool, "")
      chmodSync(firstWindowsTool, 0o644)
      chmodSync(laterWindowsTool, 0o644)
      process.env["PATH"] = directory

      expect(which("docks-posix-tool", [""])).toBe(posixTool)
      expect(which("docks-windows-tool", [".exe", ".cmd", ".bat", ""])).toBe(windowsTool)
      expect(which(join(directory, "docks-windows-tool"), [".exe", ".cmd", ".bat", ""])).toBe(windowsTool)
      expect(which("docks-windows-first", [".exe", ".cmd", ".bat", ""])).toBe(firstWindowsTool)
    } finally {
      if (previousPath === undefined) delete process.env["PATH"]
      else process.env["PATH"] = previousPath
      rmSync(directory, { recursive: true, force: true })
    }
  })

  it("preserves a resolved Windows shim path in dependency probes", async () => {
    const executable = "C:/tools/npm.cmd"
    const exec: ProbeExecutor = {
      commandExists: () => true,
      capture: async () => "",
      which: (name) => (name === "npm" ? executable : "")
    }

    expect(resolveDependency(DEPENDENCIES.npm, exec, "win32")).toEqual({
      state: "present",
      path: executable
    })
    await expect(resolvePath(DEPENDENCIES.npm, exec, "win32")).resolves.toBe(executable)
  })

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

  it("shares one in-flight npm global listing across concurrent version probes", async () => {
    const captures: Array<[string, ReadonlyArray<string>]> = []
    const listing = Promise.withResolvers<string>()
    const manager = makeDependencyManager(makePlatform("linux"), {
      commandExists: () => true,
      capture: async (cmd, args) => {
        captures.push([cmd, args])
        return await listing.promise
      },
      which: (name) => `/stub/${name}`
    })

    const first = manager.version("intelephense")
    const second = manager.version("intelephense")
    expect(captures).toEqual([["npm", ["ls", "-g", "--depth=0", "--json"]]])

    listing.resolve('{"dependencies":{"intelephense":{"version":"1.18.4"}}}')
    await expect(Promise.all([first, second])).resolves.toEqual(["1.18.4", "1.18.4"])
    await expect(manager.version("intelephense")).resolves.toBe("1.18.4")
    expect(captures).toEqual([["npm", ["ls", "-g", "--depth=0", "--json"]]])
  })

  it("reports no intelephense version when npm is absent", async () => {
    const captures: Array<[string, ReadonlyArray<string>]> = []
    const manager = makeDependencyManager(makePlatform("linux"), {
      commandExists: (name) => name !== "npm",
      capture: async (cmd, args) => {
        captures.push([cmd, args])
        return ""
      },
      which: (name) => (name !== "npm" ? `/stub/${name}` : "")
    })
    await expect(manager.version("intelephense")).resolves.toBe("")
    expect(captures).toEqual([])
  })

  it("does not capture a Bun version when Bun is absent", async () => {
    const capture = vi.fn(async () => "")
    const exec: ProbeExecutor = {
      commandExists: () => false,
      capture,
      which: () => ""
    }
    const version = DEPENDENCIES.bun.version
    if (version === undefined) throw new Error("Bun version probe is not registered")

    await expect(version(exec)).resolves.toBe("")
    expect(capture).not.toHaveBeenCalled()
  })

  it("uses the resolved BUN_INSTALL executable for the Bun version probe", async () => {
    const previousHome = process.env["HOME"]
    const previousBunInstall = process.env["BUN_INSTALL"]
    const calls: Array<[string, ReadonlyArray<string>]> = []
    try {
      process.env["HOME"] = "/fixture-home"
      process.env["BUN_INSTALL"] = "/custom-bun"
      const manager = makeDependencyManager(makePlatform("linux"), {
        commandExists: () => false,
        capture: async (cmd, args) => {
          calls.push([cmd, args])
          return "1.3.14"
        },
        which: (name) => (name === "/custom-bun/bin/bun" ? name : "")
      })

      await expect(manager.version("bun")).resolves.toBe("1.3.14")
      expect(calls).toEqual([["/custom-bun/bin/bun", ["--version"]]])
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
        capture: async () => "",
        which: (name) => (name === "bun" ? "relative/bin/bun" : name === "relative-bun/bin/bun" || name === fallback ? name : "")
      })
      expect(withFallback.probe("bun")).toEqual({ state: "present", path: fallback })

      const onlyRelative = makeDependencyManager(makePlatform("linux"), {
        commandExists: () => true,
        capture: async () => "",
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
      capture: async () => "9.9.9",
      which: (name) => `/stub/${name}`
    })
    expect(manager.probe("git")).toEqual({ state: "present", path: "/stub/git" })
  })
})
