import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { spawnProcess } from "../../src/engine-native/exec"
import { hostOs } from "../../src/engine-native/os"

/** A PATH holding one suffixed shim, so resolution is the same on every host. */
const withShimOnPath = async <A>(name: string, use: () => Promise<A>): Promise<A> => {
  const dir = mkdtempSync(join(tmpdir(), "docks-exec-"))
  const savedPath = process.env["PATH"]
  try {
    const shim = join(dir, name)
    writeFileSync(shim, "")
    chmodSync(shim, 0o755)
    process.env["PATH"] = dir
    return await use()
  } finally {
    process.env["PATH"] = savedPath
    rmSync(dir, { recursive: true, force: true })
  }
}

describe("spawnProcess host resolution", () => {
  const savedComSpec = process.env["ComSpec"]

  beforeEach(() => {
    process.env["ComSpec"] = "C:\\Windows\\System32\\cmd.exe"
  })

  afterEach(() => {
    if (savedComSpec === undefined) delete process.env["ComSpec"]
    else process.env["ComSpec"] = savedComSpec
  })

  it("refuses a name a suffix host cannot resolve instead of spawning it", async () => {
    const result = await spawnProcess("docks-kit-absent-tool", ["--version"], { host: hostOs("windows") })

    expect(result.exitCode).toBeNull()
    expect(result.stdout).toBe("")
    // A pathless spawn would let the parent's current directory answer.
    expect(result.error?.message).toBe("command not found on PATH: docks-kit-absent-tool")
  })

  it("spawns a resolved suffix shim instead of refusing it", async () => {
    const result = await withShimOnPath("docks-kit-probe.cmd", () =>
      spawnProcess("docks-kit-probe", ["--version"], { host: hostOs("windows") })
    )

    // Host-independent: cmd.exe runs the shim on Windows and is absent on POSIX,
    // so the only shared fact is that resolution did not refuse the name.
    expect(result.error?.message ?? "").not.toContain("command not found on PATH")
  })

  it("hands a POSIX host's command through unchanged", async () => {
    // The running interpreter is absolute and present on every host, so the
    // direct-spawn contract is asserted without a PATH lookup.
    const result = await spawnProcess(process.execPath, ["-e", "process.stdout.write('ok')"], {
      host: hostOs("linux"),
      stdio: ["ignore", "pipe", "pipe"]
    })

    expect(result.exitCode).toBe(0)
    expect(result.stdout).toBe("ok")
    expect(result.error).toBeUndefined()
  })
})
