import { describe, expect, it } from "vitest"
import {
  packageManagerForHome,
  packageUpdateResult,
  resolveGlobalPackageHome,
  updateSyncArgs
} from "../../src/commands/update"

describe("update chained sync", () => {
  it("uses the fresh package entrypoint and skips refresh-only plugin work", () => {
    expect(updateSyncArgs("/kit")).toEqual([
      "/kit/cli/src/main.ts",
      "sync",
      "--skip-plugin-refresh"
    ])
  })
})

describe("package update target", () => {
  it("resolves the npm global package root that the selected manager writes", () => {
    const capture = (command: string, args: ReadonlyArray<string>) => {
      expect(command).toBe("npm")
      expect(args).toEqual(["root", "-g"])
      return { status: 0, stdout: "/new-prefix/lib/node_modules\n" }
    }

    expect(resolveGlobalPackageHome("npm", capture)).toEqual({
      ok: true,
      home: "/new-prefix/lib/node_modules/docks-kit"
    })
  })

  it("resolves the Bun global package root that the selected manager reports", () => {
    const capture = (command: string, args: ReadonlyArray<string>) => {
      expect(command).toBe("bun")
      expect(args).toEqual(["pm", "-g", "ls"])
      return {
        status: 0,
        stdout: "/new-bun/install/global node_modules (1)\n└── docks-kit@0.15.1\n"
      }
    }

    expect(resolveGlobalPackageHome("bun", capture)).toEqual({
      ok: true,
      home: "/new-bun/install/global/node_modules/docks-kit"
    })
  })

  it("does not classify a POSIX filename containing a backslash as a Bun install", () => {
    expect(packageManagerForHome("/tmp/package\\.bun\\node_modules/docks-kit", {})).toBe("npm")
  })
})

describe("package update result", () => {
  it.each([
    [
      "the same root and the same version",
      "0.14.3",
      "0.14.3",
      true,
      { alreadyCurrent: true, message: "Already at the latest version (0.14.3)." }
    ],
    [
      "the same root and different versions",
      "0.14.2",
      "0.14.3",
      true,
      { alreadyCurrent: false, message: "Updated 0.14.2 -> 0.14.3." }
    ],
    [
      "different roots and the same version",
      "0.14.3",
      "0.14.3",
      false,
      {
        alreadyCurrent: false,
        message: "Installed 0.14.3 in the selected global package root."
      }
    ],
    [
      "different roots and different versions",
      "0.14.2",
      "0.14.3",
      false,
      {
        alreadyCurrent: false,
        message: "Installed 0.14.3 in the selected global package root."
      }
    ],
    ["a missing before version", "", "0.14.3", false, { alreadyCurrent: false, message: "" }],
    ["a missing after version", "0.14.2", "", false, { alreadyCurrent: false, message: "" }]
  ] as const)(
    "reports %s",
    (_case, before, after, samePackageRoot, expected) => {
      const result = packageUpdateResult(before, after, samePackageRoot)

      expect(result).toEqual(expected)
      if (!samePackageRoot && before !== "" && after !== "") {
        expect(result.message).not.toContain("Updated")
      }
    }
  )
})
