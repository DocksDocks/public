import { spawnSync } from "node:child_process"
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { delimiter, join, resolve } from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import { hostOs } from "../../src/engine-native/os"
import { childEnv } from "../lib/goldenResources"

const REPO_DIR = resolve(import.meta.dirname, "..", "..", "..")
const roots: Array<string> = []
const WINDOWS_LAUNCHER_APPLIES = hostOs().id === "windows"
const pwshProbe = spawnSync("pwsh", ["-NoProfile", "-NonInteractive", "-Command", "exit 0"], { encoding: "utf8" })
const pwshExecutable = pwshProbe.status === 0 ? "pwsh" : null
const launcherSuiteLabel = !WINDOWS_LAUNCHER_APPLIES
  ? "checkout PowerShell launcher binary selection (skipped: docks-kit.ps1 is a Windows artifact and does not apply to this host)"
  : pwshExecutable === null
    ? "checkout PowerShell launcher binary selection (skipped: docks-kit.ps1 requires a resolvable pwsh interpreter)"
    : "checkout PowerShell launcher binary selection"

interface LauncherFixture {
  readonly root: string
  readonly binDir: string
}

function launcherFixture(options: {
  readonly binaryName: string
  readonly checkoutVersion: string | number
  readonly binary: "bun" | "unparseable"
}): LauncherFixture {
  const root = mkdtempSync(join(tmpdir(), "docks-launcher-windows-"))
  roots.push(root)
  const binDir = join(root, "test-bin")
  const distDir = join(root, "cli", "dist")
  mkdirSync(distDir, { recursive: true })
  mkdirSync(join(root, "cli", "src"), { recursive: true })
  mkdirSync(join(root, "node_modules", "effect"), { recursive: true })
  mkdirSync(binDir, { recursive: true })

  copyFileSync(join(REPO_DIR, "docks-kit.ps1"), join(root, "docks-kit.ps1"))
  writeFileSync(join(root, "package.json"), `${JSON.stringify({ version: options.checkoutVersion }, null, 2)}\n`)
  writeFileSync(
    join(root, "cli", "src", "main.ts"),
    "console.log(`source:${Bun.argv.slice(2).join(\" \")}`)\n"
  )
  copyFileSync(process.execPath, join(binDir, "bun.exe"))

  const binaryPath = join(distDir, options.binaryName)
  if (options.binary === "bun") {
    copyFileSync(process.execPath, binaryPath)
  } else {
    const whereExecutable = join(process.env.SystemRoot ?? "C:\\Windows", "System32", "where.exe")
    if (!existsSync(whereExecutable)) throw new Error(`required Windows executable not found: ${whereExecutable}`)
    copyFileSync(whereExecutable, binaryPath)
  }

  return { root, binDir }
}

function runLauncher(
  fixture: LauncherFixture,
  architecture: { readonly native: string; readonly wow64?: string },
  args: ReadonlyArray<string>
) {
  if (pwshExecutable === null) throw new Error("docks-kit.ps1 requires a resolvable pwsh interpreter")
  const literal = (value: string): string => `'${value.replaceAll("'", "''")}'`
  // Assign the two architecture variables inside the session rather than in the
  // spawn environment: the case under test owns them, and an in-session
  // assignment cannot be dropped or overridden by however the host merges an
  // environment block. `exit $LASTEXITCODE` forwards the launcher's own status.
  const command = [
    `$env:PROCESSOR_ARCHITECTURE=${literal(architecture.native)}`,
    `$env:PROCESSOR_ARCHITEW6432=${literal(architecture.wow64 ?? "")}`,
    `& ${[join(fixture.root, "docks-kit.ps1"), ...args].map(literal).join(" ")}`,
    "exit $LASTEXITCODE"
  ].join("; ")
  return spawnSync(pwshExecutable, ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", command], {
    encoding: "utf8",
    env: childEnv({
      HOME: fixture.root,
      USERPROFILE: fixture.root,
      BUN_INSTALL: join(fixture.root, ".bun"),
      PATH: [fixture.binDir, process.env.PATH ?? ""].join(delimiter)
    })
  })
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe.skipIf(!WINDOWS_LAUNCHER_APPLIES || pwshExecutable === null)(launcherSuiteLabel, () => {
  it.each([
    ["AMD64", "", "docks-kit-windows-x64.exe"],
    ["ARM64", "", "docks-kit-windows-arm64.exe"],
    ["x86", "AMD64", "docks-kit-windows-x64.exe"]
  ])(
    "keeps a version-matching %s/%s release binary on the fast path as %s",
    (native, wow64, binaryName) => {
      const runtimeVersion = spawnSync(process.execPath, ["--version"], { encoding: "utf8" }).stdout.trim()
      const fixture = launcherFixture({ binaryName, checkoutVersion: runtimeVersion, binary: "bun" })
      const result = runLauncher(fixture, { native, wow64 }, ["--version"])

      expect(result.status, result.stderr).toBe(0)
      expect(result.stdout.trim()).toBe(runtimeVersion)
      expect(result.stdout).not.toContain("source:")
      expect(result.stderr).toBe("")
    }
  )

  it("falls through to Bun source on AMD64 when the compiled binary is stale", () => {
    const fixture = launcherFixture({
      binaryName: "docks-kit-windows-x64.exe",
      checkoutVersion: "checkout-version",
      binary: "bun"
    })
    const result = runLauncher(fixture, { native: "AMD64" }, ["probe"])

    expect(result.status, result.stderr).toBe(0)
    expect(result.stdout.trim()).toBe("source:probe")
    expect(result.stderr).toContain("ignoring stale cli/dist/docks-kit-windows-x64.exe")
  })

  it("falls through to Bun source on AMD64 when the compiled binary version is unparseable", () => {
    const fixture = launcherFixture({
      binaryName: "docks-kit-windows-x64.exe",
      checkoutVersion: "checkout-version",
      binary: "unparseable"
    })
    const result = runLauncher(fixture, { native: "AMD64" }, ["probe"])

    expect(result.status, result.stderr).toBe(0)
    expect(result.stdout.trim()).toBe("source:probe")
    expect(result.stderr).toContain("docks-kit-windows-x64.exe <unknown>; checkout is checkout-version")
  })

  it("falls through to Bun source on AMD64 when the checkout version is unparseable", () => {
    const fixture = launcherFixture({
      binaryName: "docks-kit-windows-x64.exe",
      checkoutVersion: 7,
      binary: "bun"
    })
    const result = runLauncher(fixture, { native: "AMD64" }, ["probe"])

    expect(result.status, result.stderr).toBe(0)
    expect(result.stdout.trim()).toBe("source:probe")
    expect(result.stderr).toContain("checkout is <unknown>")
  })

  it("rejects the injected x86 processor architecture before the Bun source fallback", () => {
    const fixture = launcherFixture({
      binaryName: "docks-kit-windows-x64.exe",
      checkoutVersion: "checkout-version",
      binary: "bun"
    })
    const result = runLauncher(fixture, { native: "x86" }, ["probe"])

    expect(result.status).toBe(1)
    expect(result.stdout).toBe("")
    expect(result.stderr).toContain("unsupported host Windows-x86")
    expect(result.stderr).toContain("supports Linux, macOS, and Windows on x64 or arm64")
    expect(result.stderr).not.toContain("source:")
  })
})
