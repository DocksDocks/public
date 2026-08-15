import type * as FsModule from "node:fs"
import type * as OsModule from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => {
  const ownerUid = process.getuid?.() ?? -1
  const entries: Array<{ name: string; isDirectory: () => boolean }> = []
  const stats = new Map<string, { uid: number; mtimeMs: number }>()
  const ownerFiles = new Map<string, string>()
  const lstatSync = vi.fn((path: string) => {
    const stat = stats.get(path)
    if (stat === undefined) throw Object.assign(new Error("missing stat"), { code: "ENOENT" })
    return stat
  })
  const mkdtempSync = vi.fn((prefix: string) => `${prefix}created`)
  const readFileSync = vi.fn((path: string) => {
    const content = ownerFiles.get(path)
    if (content === undefined) throw Object.assign(new Error("missing owner"), { code: "ENOENT" })
    return content
  })
  const readdirSync = vi.fn(() => entries)
  const rmSync = vi.fn()
  const writeFileSync = vi.fn()
  return {
    entries,
    lstatSync,
    mkdtempSync,
    ownerFiles,
    ownerUid,
    readFileSync,
    readdirSync,
    rmSync,
    stats,
    writeFileSync
  }
})

vi.mock("node:fs", async () => {
  const actual = await vi.importActual<typeof FsModule>("node:fs")
  return {
    ...actual,
    lstatSync: mocks.lstatSync,
    mkdtempSync: mocks.mkdtempSync,
    readFileSync: mocks.readFileSync,
    readdirSync: mocks.readdirSync,
    rmSync: mocks.rmSync,
    writeFileSync: mocks.writeFileSync
  }
})
vi.mock("node:os", async () => {
  const actual = await vi.importActual<typeof OsModule>("node:os")
  return { ...actual, tmpdir: () => "/golden-test-tmp" }
})

import {
  cleanupTemporaryDirs,
  makeStubDir,
  sweepStaleTemporaryDirs,
  temporaryDir
} from "../lib/goldenResources"

const NOW_MS = 10 * 60 * 60 * 1000
const nativeGetuid = process.getuid

function addDirectory(
  name: string,
  options: { mtimeMs: number; ownerPid?: number; uid?: number }
): string {
  const path = join("/golden-test-tmp", name)
  const uid = options.uid ?? mocks.ownerUid
  mocks.entries.push({ name, isDirectory: () => true })
  mocks.stats.set(path, { uid, mtimeMs: options.mtimeMs })
  if (options.ownerPid !== undefined) {
    const ownerPath = `${path}.owner-pid`
    mocks.ownerFiles.set(ownerPath, `${options.ownerPid}\n`)
    mocks.stats.set(ownerPath, { uid, mtimeMs: options.mtimeMs })
  }
  return path
}

function addOrphanOwnerMarker(directoryName: string, ownerPid: number, mtimeMs: number): string {
  const name = `${directoryName}.owner-pid`
  const path = join("/golden-test-tmp", name)
  mocks.entries.push({ name, isDirectory: () => false })
  mocks.ownerFiles.set(path, `${ownerPid}\n`)
  mocks.stats.set(path, { uid: mocks.ownerUid, mtimeMs })
  return path
}

beforeEach(() => {
  Object.defineProperty(process, "getuid", {
    configurable: true,
    value: () => mocks.ownerUid
  })
  vi.clearAllMocks()
  mocks.entries.length = 0
  mocks.ownerFiles.clear()
  mocks.stats.clear()
  mocks.rmSync.mockImplementation(() => undefined)
})

afterEach(() => {
  vi.restoreAllMocks()
  if (nativeGetuid === undefined) {
    Reflect.deleteProperty(process, "getuid")
  } else {
    Object.defineProperty(process, "getuid", {
      configurable: true,
      value: nativeGetuid
    })
  }
})

describe("golden temporary resources", () => {
  it("spares live and protected owners and removes a dead owner", () => {
    const alivePid = 41_001
    const deadPid = 41_002
    const protectedPid = 41_003
    const alivePath = addDirectory("golden-home-alive", {
      mtimeMs: NOW_MS - 2 * 60 * 60 * 1000,
      ownerPid: alivePid
    })
    const deadPath = addDirectory("golden-home-dead", {
      mtimeMs: NOW_MS - 30 * 60 * 1000,
      ownerPid: deadPid
    })
    const protectedPath = addDirectory("golden-home-protected", {
      mtimeMs: NOW_MS - 2 * 60 * 60 * 1000,
      ownerPid: protectedPid
    })
    const kill = vi.spyOn(process, "kill").mockImplementation((pid) => {
      if (pid === deadPid) throw Object.assign(new Error("process missing"), { code: "ESRCH" })
      if (pid === protectedPid) throw Object.assign(new Error("process protected"), { code: "EPERM" })
      return true
    })

    sweepStaleTemporaryDirs(NOW_MS)

    expect(kill).toHaveBeenCalledWith(alivePid, 0)
    expect(kill).toHaveBeenCalledWith(deadPid, 0)
    expect(kill).toHaveBeenCalledWith(protectedPid, 0)
    expect(mocks.rmSync).not.toHaveBeenCalledWith(alivePath, expect.anything())
    expect(mocks.rmSync).not.toHaveBeenCalledWith(protectedPath, expect.anything())
    expect(mocks.rmSync).toHaveBeenCalledWith(deadPath, { recursive: true, force: true })
    expect(mocks.rmSync).toHaveBeenCalledWith(`${deadPath}.owner-pid`, { force: true })
  })

  it("sweeps dead owners when the host has no numeric user id", () => {
    const deadPid = 41_006
    const deadPath = addDirectory("golden-home-windows-dead", {
      mtimeMs: NOW_MS - 30 * 60 * 1000,
      ownerPid: deadPid
    })
    vi.spyOn(process, "getuid").mockImplementation(() => undefined as never)
    vi.spyOn(process, "kill").mockImplementation(() => {
      throw Object.assign(new Error("process missing"), { code: "ESRCH" })
    })

    sweepStaleTemporaryDirs(NOW_MS)

    expect(mocks.rmSync).toHaveBeenCalledWith(deadPath, { recursive: true, force: true })
    expect(mocks.rmSync).toHaveBeenCalledWith(`${deadPath}.owner-pid`, { force: true })
  })

  it("uses age only when no readable owner marker exists", () => {
    const youngPath = addDirectory("golden-home-young-orphan", {
      mtimeMs: NOW_MS - 30 * 60 * 1000
    })
    const oldPath = addDirectory("golden-home-old-orphan", {
      mtimeMs: NOW_MS - 2 * 60 * 60 * 1000
    })

    sweepStaleTemporaryDirs(NOW_MS)

    expect(mocks.rmSync).not.toHaveBeenCalledWith(youngPath, expect.anything())
    expect(mocks.rmSync).toHaveBeenCalledWith(oldPath, { recursive: true, force: true })
  })

  it("removes dead orphan markers and spares live orphan markers", () => {
    const alivePid = 41_004
    const deadPid = 41_005
    const aliveMarker = addOrphanOwnerMarker(
      "golden-fixture-alive",
      alivePid,
      NOW_MS - 2 * 60 * 60 * 1000
    )
    const deadMarker = addOrphanOwnerMarker(
      "golden-fixture-dead",
      deadPid,
      NOW_MS - 2 * 60 * 60 * 1000
    )
    vi.spyOn(process, "kill").mockImplementation((pid) => {
      if (pid === deadPid) throw Object.assign(new Error("process missing"), { code: "ESRCH" })
      return true
    })

    sweepStaleTemporaryDirs(NOW_MS)

    expect(mocks.rmSync).not.toHaveBeenCalledWith(aliveMarker, expect.anything())
    expect(mocks.rmSync).toHaveBeenCalledWith(deadMarker, { force: true })
  })

  it("records its owner, protects its directory, and cleans both resources", () => {
    const path = temporaryDir("golden-mask-")
    addDirectory("golden-mask-created", {
      mtimeMs: NOW_MS - 2 * 60 * 60 * 1000
    })

    sweepStaleTemporaryDirs(NOW_MS)

    expect(mocks.writeFileSync).toHaveBeenCalledWith(`${path}.owner-pid`, `${process.pid}\n`)
    expect(mocks.rmSync).not.toHaveBeenCalledWith(path, expect.anything())

    cleanupTemporaryDirs()

    expect(mocks.rmSync).toHaveBeenCalledWith(path, { recursive: true, force: true })
    expect(mocks.rmSync).toHaveBeenCalledWith(`${path}.owner-pid`, { force: true })
  })

  it("skips foreign directories and continues after a removal failure", () => {
    const deadPid = 41_003
    const ownedPath = addDirectory("golden-home-owned", {
      mtimeMs: NOW_MS,
      ownerPid: deadPid
    })
    const foreignPath = addDirectory("golden-home-foreign", {
      mtimeMs: NOW_MS - 2 * 60 * 60 * 1000,
      uid: mocks.ownerUid + 1
    })
    vi.spyOn(process, "kill").mockImplementation(() => {
      throw Object.assign(new Error("process missing"), { code: "ESRCH" })
    })
    mocks.rmSync.mockImplementation((path) => {
      if (path === ownedPath) throw Object.assign(new Error("removal denied"), { code: "EACCES" })
    })

    sweepStaleTemporaryDirs(NOW_MS)

    expect(mocks.rmSync).toHaveBeenCalledTimes(1)
    expect(mocks.lstatSync).toHaveBeenCalledWith(foreignPath)
  })

  it("rejects unknown stub override names", () => {
    expect(() => makeStubDir({ claud: "exit 0" })).toThrow("Unknown golden stub override(s): claud")
  })
})
