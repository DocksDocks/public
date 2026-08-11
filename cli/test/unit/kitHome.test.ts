import {
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  writeFileSync
} from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { describe, expect, it } from "vitest"
import { kitHome, resolveKitHome } from "../../src/kitHome"

const createKitRoot = (dir: string, ...nestedDirs: string[]): void => {
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, "package.json"), '{"name":"docks-kit"}')
  for (const nestedDir of nestedDirs) {
    mkdirSync(join(dir, nestedDir), { recursive: true })
  }
}

describe("kitHome", () => {
  it("describes the package-root requirement for invalid DOCKS_KIT_HOME", () => {
    const dir = mkdtempSync(join(tmpdir(), "docks-kit-home-"))
    const previous = process.env["DOCKS_KIT_HOME"]
    process.env["DOCKS_KIT_HOME"] = dir
    try {
      expect(() => kitHome()).toThrow(
        `DOCKS_KIT_HOME=${dir} is not a docks-kit package root (package.json name must be "docks-kit")`
      )
    } finally {
      if (previous === undefined) delete process.env["DOCKS_KIT_HOME"]
      else process.env["DOCKS_KIT_HOME"] = previous
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe("resolveKitHome", () => {
  it("prefers a valid DOCKS_KIT_HOME over every automatic source", () => {
    const dir = realpathSync(mkdtempSync(join(tmpdir(), "docks-kit-resolve-")))
    try {
      const envRoot = join(dir, "env")
      const moduleRoot = join(dir, "module")
      const execRoot = join(dir, "exec")
      const cwdRoot = join(dir, "cwd")
      createKitRoot(envRoot)
      createKitRoot(moduleRoot, "src/runtime")
      createKitRoot(execRoot, "bin")
      createKitRoot(cwdRoot, "work/tree")

      expect(
        resolveKitHome({
          env: envRoot,
          moduleDir: join(moduleRoot, "src", "runtime"),
          execPath: join(execRoot, "bin", "docks-kit"),
          cwd: join(cwdRoot, "work", "tree")
        })
      ).toBe(envRoot)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it("prefers the running install over a checkout the process merely runs inside", () => {
    const dir = realpathSync(mkdtempSync(join(tmpdir(), "docks-kit-resolve-")))
    try {
      const installRoot = join(dir, "install")
      const checkoutRoot = join(dir, "checkout")
      createKitRoot(installRoot, "cli/src")
      createKitRoot(checkoutRoot, "work/tree")

      expect(
        resolveKitHome({
          env: undefined,
          moduleDir: join(installRoot, "cli", "src"),
          execPath: join(dir, "bin", "docks-kit"),
          cwd: join(checkoutRoot, "work", "tree")
        })
      ).toBe(installRoot)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it("prefers the exec path ancestor over a competing cwd kit root", () => {
    const dir = realpathSync(mkdtempSync(join(tmpdir(), "docks-kit-resolve-")))
    try {
      const root = join(dir, "checkout")
      const cwdRoot = join(dir, "outside")
      createKitRoot(root, "cli/dist")
      createKitRoot(cwdRoot, "work/tree")

      expect(
        resolveKitHome({
          env: undefined,
          moduleDir: "/$bunfs/root",
          execPath: join(root, "cli", "dist", "docks-kit-linux-x64"),
          cwd: join(cwdRoot, "work", "tree")
        })
      ).toBe(root)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it("uses cwd only when the running sources are outside a kit root", () => {
    const dir = realpathSync(mkdtempSync(join(tmpdir(), "docks-kit-resolve-")))
    try {
      const cwdRoot = join(dir, "checkout")
      createKitRoot(cwdRoot, "work/tree")

      expect(
        resolveKitHome({
          env: undefined,
          moduleDir: join(dir, "virtual", "module"),
          execPath: join(dir, "bin", "docks-kit"),
          cwd: join(cwdRoot, "work", "tree")
        })
      ).toBe(cwdRoot)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it("skips the module source when the loader leaves it undefined", () => {
    const dir = realpathSync(mkdtempSync(join(tmpdir(), "docks-kit-resolve-")))
    try {
      const execRoot = join(dir, "install")
      createKitRoot(execRoot, "bin")

      expect(
        resolveKitHome({
          env: undefined,
          moduleDir: undefined,
          execPath: join(execRoot, "bin", "docks-kit"),
          cwd: join(dir, "outside")
        })
      ).toBe(execRoot)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it("falls back to the exec path directory when no kit root exists", () => {
    const dir = realpathSync(mkdtempSync(join(tmpdir(), "docks-kit-resolve-")))
    try {
      const execPath = join(dir, "runtime", "docks-kit")

      expect(
        resolveKitHome({
          env: undefined,
          moduleDir: join(dir, "virtual", "module"),
          execPath,
          cwd: join(dir, "work", "tree")
        })
      ).toBe(dirname(execPath))
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it("uses the nearest kit root ancestor", () => {
    const dir = realpathSync(mkdtempSync(join(tmpdir(), "docks-kit-resolve-")))
    try {
      const outerRoot = join(dir, "outer")
      const innerRoot = join(outerRoot, "packages", "inner")
      createKitRoot(outerRoot)
      createKitRoot(innerRoot, "cli/src")

      expect(
        resolveKitHome({
          env: undefined,
          moduleDir: join(innerRoot, "cli", "src"),
          execPath: join(dir, "bin", "docks-kit"),
          cwd: join(dir, "work", "tree")
        })
      ).toBe(innerRoot)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
