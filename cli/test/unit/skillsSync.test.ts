import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readlinkSync,
  rmSync,
  writeFileSync
} from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join, relative, resolve } from "node:path"
import type * as FsModule from "node:fs"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type * as ExecModule from "../../src/engine-native/exec"

type SymlinkSync = (target: string, path: string, type?: "dir" | "file" | "junction") => void

const mocks = vi.hoisted(() => ({
  manifest: "acme/demo\n",
  payloadText: vi.fn<(path: string) => string>(),
  realSymlinkSync: undefined as SymlinkSync | undefined,
  spawnProcess: vi.fn(),
  symlinkSync: vi.fn<SymlinkSync>()
}))

vi.mock("node:fs", async () => {
  const actual = await vi.importActual<typeof FsModule>("node:fs")
  mocks.realSymlinkSync = actual.symlinkSync
  return { ...actual, symlinkSync: mocks.symlinkSync }
})

vi.mock("../../src/payload", () => ({ payloadText: mocks.payloadText }))
vi.mock("../../src/engine-native/exec", async () => {
  const actual = await vi.importActual<typeof ExecModule>("../../src/engine-native/exec")
  return { ...actual, spawnProcess: mocks.spawnProcess }
})

import type { Ctx } from "../../src/engine-native"
import { COPY_MARKER, linkOrCopy, skillsSync } from "../../src/engine-native/skillsSync"
import { makeDependencyManager, makeEngineServices, makePlatform } from "../../src/engine-native/services"

const roots: Array<string> = []

function makeRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "docks-skills-link-"))
  roots.push(root)
  return root
}

function makeCtx(
  root: string,
  output: { stderr: Array<string>; stdout: Array<string> },
  options: { dryRun?: boolean; prune?: boolean } = {}
): Ctx {
  const platform = makePlatform("linux")
  const services = {
    ...makeEngineServices({
      sinks: {
        stderr: (chunk) => output.stderr.push(chunk),
        stdout: (chunk) => output.stdout.push(chunk)
      }
    }),
    deps: makeDependencyManager(platform, {
      commandExists: (name) => name === "npx",
      capture: async () => "",
      which: (name) => (name === "npx" ? "/usr/bin/npx" : "")
    }),
    platform
  }
  return {
    home: root,
    agentsDir: join(root, ".agents"),
    dryRun: options.dryRun ?? false,
    prune: options.prune ?? false,
    verbose: false,
    services,
    nextStepTriggers: { skillsRestart: false }
  } as Ctx
}

function createCanonical(root: string, base = "demo"): string {
  const canonical = join(root, ".agents", "skills", base)
  mkdirSync(canonical, { recursive: true })
  writeFileSync(join(canonical, "SKILL.md"), `# ${base}\n`)
  return canonical
}

describe("skills platform behavior", () => {
  beforeEach(() => {
    mocks.manifest = "acme/demo\n"
    mocks.payloadText.mockReset().mockImplementation((path) => {
      if (path === "SoT/.agents/skills.txt") return mocks.manifest
      if (path === "SoT/toolchain.json") return '{"tools":{"skills-cli":{"verified":"1.5.15"}}}'
      throw new Error(`Unexpected payload: ${path}`)
    })
    mocks.spawnProcess.mockReset().mockResolvedValue({ error: undefined, exitCode: 0, stdout: "", stderr: "" })
    mocks.symlinkSync.mockReset().mockImplementation((target, path, type) => {
      if (mocks.realSymlinkSync === undefined) throw new Error("real symlinkSync unavailable")
      mocks.realSymlinkSync(target, path, type)
    })
  })

  afterEach(() => {
    for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
  })

  it("creates a real symlink with the relative target", () => {
    const root = makeRoot()
    const target = createCanonical(root)
    const link = join(root, ".claude", "skills", "demo")
    mkdirSync(dirname(link), { recursive: true })
    const relativeTarget = relative(dirname(link), target)

    expect(linkOrCopy(relativeTarget, link, ["symlink"])).toBe("symlink")
    expect(lstatSync(link).isSymbolicLink()).toBe(true)
    expect(readlinkSync(link)).toBe(relativeTarget)
    expect(mocks.symlinkSync).toHaveBeenCalledWith(relativeTarget, link)
  })

  it("copies a populated directory after linking fails and warns that a later sync restores a link", async () => {
    const root = makeRoot()
    const target = createCanonical(root)
    const link = join(root, "links", "demo")
    mkdirSync(dirname(link), { recursive: true })
    mocks.symlinkSync.mockImplementation(() => {
      throw new Error("linking unavailable")
    })

    expect(linkOrCopy(relative(dirname(link), target), link, ["symlink"])).toBe("copy")
    expect(readFileSync(join(link, "SKILL.md"), "utf8")).toBe("# demo\n")
    expect(existsSync(join(link, COPY_MARKER))).toBe(true)

    const syncRoot = makeRoot()
    createCanonical(syncRoot)
    const output = { stderr: [] as Array<string>, stdout: [] as Array<string> }
    await skillsSync(makeCtx(syncRoot, output))
    const copiedEntry = join(syncRoot, ".claude", "skills", "demo")
    expect(readFileSync(join(copiedEntry, "SKILL.md"), "utf8")).toBe("# demo\n")
    expect(existsSync(join(copiedEntry, COPY_MARKER))).toBe(true)
    expect(output.stderr.join("")).toContain("created copy fallback")
    expect(output.stderr.join("")).toContain("a later sync will restore a real link once linking works")
  })

  it("falls through from a failed symlink to an absolute-target junction", () => {
    const root = makeRoot()
    const target = createCanonical(root)
    const link = join(root, ".claude", "skills", "demo")
    mkdirSync(dirname(link), { recursive: true })
    const relativeTarget = relative(dirname(link), target)
    let attempts = 0
    mocks.symlinkSync.mockImplementation((nextTarget, nextLink) => {
      attempts++
      if (attempts === 1) throw new Error("symlink denied")
      if (mocks.realSymlinkSync === undefined) throw new Error("real symlinkSync unavailable")
      mocks.realSymlinkSync(nextTarget, nextLink)
    })

    expect(linkOrCopy(relativeTarget, link, ["symlink", "junction"])).toBe("junction")
    expect(mocks.symlinkSync).toHaveBeenNthCalledWith(1, relativeTarget, link)
    expect(mocks.symlinkSync).toHaveBeenNthCalledWith(2, resolve(target), link, "junction")
    expect(lstatSync(link).isSymbolicLink()).toBe(true)
  })

  it("returns failed only when the final copy cannot be created", () => {
    const root = makeRoot()
    const link = join(root, "links", "missing")
    mkdirSync(dirname(link), { recursive: true })
    mocks.symlinkSync.mockImplementation(() => {
      throw new Error("linking unavailable")
    })

    expect(linkOrCopy("../missing-target", link, ["symlink"])).toBe("failed")
    expect(existsSync(link)).toBe(false)
  })

  it("heals a marked copy back to a link but leaves an unmarked real directory alone", async () => {
    const healedRoot = makeRoot()
    const canonical = createCanonical(healedRoot)
    const copiedEntry = join(healedRoot, ".claude", "skills", "demo")
    mkdirSync(copiedEntry, { recursive: true })
    writeFileSync(join(copiedEntry, "old.txt"), "copied\n")
    writeFileSync(join(copiedEntry, COPY_MARKER), "")
    const healedOutput = { stderr: [] as Array<string>, stdout: [] as Array<string> }

    await skillsSync(makeCtx(healedRoot, healedOutput))
    expect(lstatSync(copiedEntry).isSymbolicLink()).toBe(true)
    expect(readlinkSync(copiedEntry)).toBe(relative(dirname(copiedEntry), canonical))
    expect(existsSync(join(copiedEntry, "old.txt"))).toBe(false)

    const preservedRoot = makeRoot()
    createCanonical(preservedRoot)
    const realEntry = join(preservedRoot, ".claude", "skills", "demo")
    mkdirSync(realEntry, { recursive: true })
    writeFileSync(join(realEntry, "user.txt"), "keep\n")
    const preservedOutput = { stderr: [] as Array<string>, stdout: [] as Array<string> }

    await skillsSync(makeCtx(preservedRoot, preservedOutput))
    expect(lstatSync(realEntry).isDirectory()).toBe(true)
    expect(readFileSync(join(realEntry, "user.txt"), "utf8")).toBe("keep\n")
    expect(preservedOutput.stderr.join("")).toContain(
      "~/.claude/skills/demo exists as a real path (not a symlink) — leaving alone; remove manually if it's stale"
    )
  })

  it("prunes only managed Claude entries and reports them during dry-run", async () => {
    const root = makeRoot()
    mocks.manifest = ""
    const snapshot = join(root, ".agents", ".kit-managed-skills")
    mkdirSync(dirname(snapshot), { recursive: true })
    writeFileSync(snapshot, "acme/managed\nacme/user\n")
    const managedEntry = join(root, ".claude", "skills", "managed")
    const userEntry = join(root, ".claude", "skills", "user")
    mkdirSync(managedEntry, { recursive: true })
    mkdirSync(userEntry, { recursive: true })
    writeFileSync(join(managedEntry, COPY_MARKER), "")
    writeFileSync(join(userEntry, "user.txt"), "keep\n")
    const output = { stderr: [] as Array<string>, stdout: [] as Array<string> }

    await skillsSync(makeCtx(root, output, { prune: true }))
    expect(existsSync(managedEntry)).toBe(false)
    expect(readFileSync(join(userEntry, "user.txt"), "utf8")).toBe("keep\n")
    expect(mocks.spawnProcess).toHaveBeenCalledTimes(2)

    const dryRoot = makeRoot()
    const drySnapshot = join(dryRoot, ".agents", ".kit-managed-skills")
    mkdirSync(dirname(drySnapshot), { recursive: true })
    writeFileSync(drySnapshot, "acme/managed\n")
    const dryManagedEntry = join(dryRoot, ".claude", "skills", "managed")
    mkdirSync(dryManagedEntry, { recursive: true })
    writeFileSync(join(dryManagedEntry, COPY_MARKER), "")
    const dryOutput = { stderr: [] as Array<string>, stdout: [] as Array<string> }

    await skillsSync(makeCtx(dryRoot, dryOutput, { dryRun: true, prune: true }))
    expect(existsSync(dryManagedEntry)).toBe(true)
    expect(dryOutput.stdout.join("")).toContain(
      "[dry-run] kit-managed Claude skill entry — would remove: ~/.claude/skills/managed"
    )
  })
})
