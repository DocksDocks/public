import { cpSync, chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { delimiter, join, resolve } from "node:path"
import { spawnSync } from "node:child_process"
import { afterEach, describe, expect, it } from "vitest"
import { hostOs } from "../../src/engine-native/os/index"

const REPO_DIR = resolve(import.meta.dirname, "..", "..", "..")
const CURRENT_VERSION = (JSON.parse(readFileSync(join(REPO_DIR, "package.json"), "utf8")) as { version: string }).version
const roots: Array<string> = []
const currentHost = hostOs().id
const POSIX_LAUNCHER_APPLIES = currentHost === "linux" || currentHost === "darwin"
const launcherSuiteLabel = POSIX_LAUNCHER_APPLIES
  ? "checkout launcher binary selection"
  : "checkout launcher binary selection (skipped: docks-kit is a POSIX artifact and does not apply to this host)"

function launcherFixture(
  binaryName: string,
  binaryVersion: string | null,
  bunVersion = "1.4.0",
  dependenciesInstalled = true
): { root: string; binDir: string } {
  const root = mkdtempSync(join(tmpdir(), "docks-launcher-"))
  roots.push(root)
  const binDir = join(root, "test-bin")
  mkdirSync(join(root, "cli", "dist"), { recursive: true })
  mkdirSync(join(root, "cli", "src"), { recursive: true })
  if (dependenciesInstalled) mkdirSync(join(root, "node_modules", "effect"), { recursive: true })
  mkdirSync(binDir, { recursive: true })
  cpSync(join(REPO_DIR, "docks-kit"), join(root, "docks-kit"))
  cpSync(join(REPO_DIR, "package.json"), join(root, "package.json"))
  chmodSync(join(root, "docks-kit"), 0o755)
  writeFileSync(join(root, "cli", "src", "main.ts"), "// launcher test fixture\n")

  const binary = join(root, "cli", "dist", binaryName)
  const versionProbe = binaryVersion === null ? ":" : `printf '%s\\n' '${binaryVersion}'`
  writeFileSync(binary, `#!/bin/bash
if [[ "\${1:-}" == "--version" ]]; then
  ${versionProbe}
else
  printf 'compiled:%s\\n' "$*"
fi
`)
  chmodSync(binary, 0o755)

  const bun = join(binDir, "bun")
  writeFileSync(bun, `#!/bin/bash
if [[ "\${1:-}" == "--version" ]]; then
  printf '%s\\n' '${bunVersion}'
elif [[ "\${2:-}" == "--version" ]]; then
  printf '%s\\n' '${CURRENT_VERSION}'
else
  shift
  printf 'source:%s\\n' "$*"
fi
`)
  chmodSync(bun, 0o755)

  const uname = join(binDir, "uname")
  writeFileSync(uname, `#!/bin/bash
case "\${1:-}" in
  -s) printf '%s\\n' "\${FAKE_UNAME_S}" ;;
  -m) printf '%s\\n' "\${FAKE_UNAME_M}" ;;
  *) exit 2 ;;
esac
`)
  chmodSync(uname, 0o755)
  return { root, binDir }
}

function runLauncher(
  fixture: { root: string; binDir: string },
  uname: { system: string; machine: string },
  args: ReadonlyArray<string>
) {
  return spawnSync("bash", [join(fixture.root, "docks-kit"), ...args], {
    encoding: "utf8",
    env: {
      ...process.env,
      HOME: fixture.root,
      PATH: `${fixture.binDir}${delimiter}${process.env.PATH ?? ""}`,
      FAKE_UNAME_S: uname.system,
      FAKE_UNAME_M: uname.machine
    }
  })
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe.skipIf(!POSIX_LAUNCHER_APPLIES)(launcherSuiteLabel, () => {
  it("falls through to the current checkout source when dist is stale", () => {
    const fixture = launcherFixture("docks-kit-linux-x64", "0.4.0")
    const platform = { system: "Linux", machine: "x86_64" }

    const version = runLauncher(fixture, platform, ["--version"])
    const catalog = runLauncher(fixture, platform, ["models", "claude", "--json"])

    expect(version.status).toBe(0)
    expect(version.stdout.trim()).toBe(CURRENT_VERSION)
    expect(catalog.status).toBe(0)
    expect(catalog.stdout.trim()).toBe("source:models claude --json")
    expect(catalog.stderr).toContain("ignoring stale cli/dist/docks-kit-linux-x64 0.4.0; checkout is")
  })

  it("falls through to source when the compiled binary prints no version", () => {
    const fixture = launcherFixture("docks-kit-linux-x64", null)
    const result = runLauncher(fixture, { system: "Linux", machine: "x86_64" }, ["probe"])

    expect(result.status).toBe(0)
    expect(result.stdout.trim()).toBe("source:probe")
    expect(result.stderr).toContain("ignoring stale cli/dist/docks-kit-linux-x64 <unknown>")
  })

  it.each([
    "1.4.0",
    "1.10.0",
    "2.0.0",
    "1.4.0-canary.1+build",
    "unparseable"
  ])("accepts Bun %s before installing checkout dependencies", (bunVersion) => {
    const fixture = launcherFixture("docks-kit-linux-x64", null, bunVersion, false)
    const result = runLauncher(fixture, { system: "Linux", machine: "x86_64" }, ["probe"])

    expect(result.status).toBe(0)
    expect(result.stdout.trim()).toBe("source:probe")
    expect(result.stderr).toContain("Installing CLI dependencies")
  })

  it("rejects Bun below the floor before installing checkout dependencies", () => {
    const fixture = launcherFixture("docks-kit-linux-x64", null, "1.3.14\r", false)
    const result = runLauncher(fixture, { system: "Linux", machine: "x86_64" }, ["probe"])

    expect(result.status).toBe(1)
    expect(result.stdout).toBe("")
    expect(result.stderr).toContain("Bun 1.3.14 is below the required floor 1.4.0")
    expect(result.stderr).toContain("checkout's lockfile requires Bun 1.4.0 or newer")
    expect(result.stderr).toContain("Run: bun upgrade")
    expect(result.stderr).not.toContain("Installing CLI dependencies")
  })

  it("compares installed Bun against the floor rather than the verified install pin", () => {
    const fixture = launcherFixture("docks-kit-linux-x64", null, "1.4.0", false)
    const launcherPath = join(fixture.root, "docks-kit")
    const launcher = readFileSync(launcherPath, "utf8")
    writeFileSync(launcherPath, launcher.replace('BUN_PIN="1.4.0"', 'BUN_PIN="9.0.0"'))

    const result = runLauncher(fixture, { system: "Linux", machine: "x86_64" }, ["probe"])

    expect(result.status).toBe(0)
    expect(result.stdout.trim()).toBe("source:probe")
  })

  it("fails closed when the checkout version cannot be parsed", () => {
    const fixture = launcherFixture("docks-kit-linux-x64", CURRENT_VERSION)
    const packagePath = join(fixture.root, "package.json")
    const manifest = JSON.parse(readFileSync(packagePath, "utf8")) as Record<string, unknown>
    manifest["version"] = 7
    writeFileSync(packagePath, `${JSON.stringify(manifest, null, 2)}\n`)

    const result = runLauncher(fixture, { system: "Linux", machine: "x86_64" }, ["probe"])

    expect(result.status).toBe(0)
    expect(result.stdout.trim()).toBe("source:probe")
    expect(result.stderr).toContain("checkout is <unknown>")
  })

  it.each([
    ["Linux", "x86_64", "docks-kit-linux-x64"],
    ["Linux", "aarch64", "docks-kit-linux-arm64"],
    ["Darwin", "x86_64", "docks-kit-darwin-x64"],
    ["Darwin", "arm64", "docks-kit-darwin-arm64"]
  ])("keeps a matching %s-%s release binary on the fast path", (system, machine, binaryName) => {
    const fixture = launcherFixture(binaryName, CURRENT_VERSION)
    const result = runLauncher(fixture, { system, machine }, ["probe"])

    expect(result.status).toBe(0)
    expect(result.stdout.trim()).toBe("compiled:probe")
    expect(result.stderr).toBe("")
  })

  it.each([
    ["MINGW64_NT-10.0-19045", "x86_64"],
    ["Linux", "i686"],
    ["FreeBSD", "x86_64"]
  ])("rejects unsupported %s-%s before the Bun source fallback", (system, machine) => {
    const fixture = launcherFixture("docks-kit-linux-x64", CURRENT_VERSION)
    const result = runLauncher(fixture, { system, machine }, ["probe"])

    expect(result.status).toBe(1)
    expect(result.stdout).toBe("")
    expect(result.stderr).toContain(`unsupported host ${system}-${machine}`)
    expect(result.stderr).toContain("this launcher serves Linux and macOS on x64 or arm64")
    expect(result.stderr).toContain("on Windows run docks-kit.ps1 instead")
    expect(result.stderr).not.toContain("source:")
  })
})
