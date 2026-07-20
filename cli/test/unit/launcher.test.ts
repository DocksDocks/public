import { cpSync, chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { spawnSync } from "node:child_process"
import { afterEach, describe, expect, it } from "vitest"

const REPO_DIR = resolve(import.meta.dirname, "..", "..", "..")
const CURRENT_VERSION = (JSON.parse(readFileSync(join(REPO_DIR, "package.json"), "utf8")) as { version: string }).version
const roots: Array<string> = []

function launcherFixture(binaryName: string, binaryVersion: string): { root: string; binDir: string } {
  const root = mkdtempSync(join(tmpdir(), "docks-launcher-"))
  roots.push(root)
  const binDir = join(root, "test-bin")
  mkdirSync(join(root, "cli", "dist"), { recursive: true })
  mkdirSync(join(root, "cli", "src"), { recursive: true })
  mkdirSync(join(root, "node_modules", "@effect", "cli"), { recursive: true })
  mkdirSync(binDir, { recursive: true })
  cpSync(join(REPO_DIR, "docks-kit"), join(root, "docks-kit"))
  cpSync(join(REPO_DIR, "package.json"), join(root, "package.json"))
  chmodSync(join(root, "docks-kit"), 0o755)
  writeFileSync(join(root, "cli", "src", "main.ts"), "// launcher test fixture\n")

  const binary = join(root, "cli", "dist", binaryName)
  writeFileSync(binary, `#!/bin/bash
if [[ "\${1:-}" == "--version" ]]; then
  printf '%s\\n' '${binaryVersion}'
else
  printf 'compiled:%s\\n' "$*"
fi
`)
  chmodSync(binary, 0o755)

  const bun = join(binDir, "bun")
  writeFileSync(bun, `#!/bin/bash
if [[ "\${1:-}" == "--version" ]]; then
  printf '%s\\n' '1.3.14'
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
  return spawnSync(join(fixture.root, "docks-kit"), args, {
    encoding: "utf8",
    env: {
      ...process.env,
      HOME: fixture.root,
      PATH: `${fixture.binDir}:${process.env.PATH ?? ""}`,
      FAKE_UNAME_S: uname.system,
      FAKE_UNAME_M: uname.machine
    }
  })
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe("checkout launcher binary selection", () => {
  it("falls through to the current checkout source when dist is stale", () => {
    const fixture = launcherFixture("docks-kit-linux-x64", "0.4.0")
    const platform = { system: "Linux", machine: "x86_64" }

    const version = runLauncher(fixture, platform, ["--version"])
    const workflow = runLauncher(fixture, platform, ["models", "workflow", "--json"])

    expect(version.status).toBe(0)
    expect(version.stdout.trim()).toBe(CURRENT_VERSION)
    expect(workflow.status).toBe(0)
    expect(workflow.stdout.trim()).toBe("source:models workflow --json")
    expect(workflow.stderr).toContain("ignoring stale cli/dist/docks-kit-linux-x64 0.4.0; checkout is")
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
    expect(result.stderr).toContain("supports only Linux and macOS on x64 or arm64")
    expect(result.stderr).not.toContain("source:")
  })
})
