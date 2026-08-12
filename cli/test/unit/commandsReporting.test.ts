import { spawnSync } from "node:child_process"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { afterEach, describe, expect, it } from "vitest"

const REPO_DIR = resolve(import.meta.dirname, "..", "..", "..")
const CLI = join(REPO_DIR, "cli", "src", "main.ts")
const temporaryDirectories = new Array<string>()

const temporaryDirectory = (prefix: string): string => {
  const directory = mkdtempSync(join(tmpdir(), prefix))
  temporaryDirectories.push(directory)
  return directory
}

const runCli = (
  args: ReadonlyArray<string>,
  home: string,
  environment: NodeJS.ProcessEnv = {}
) =>
  spawnSync("bun", [CLI, ...args], {
    encoding: "utf8",
    env: {
      ...process.env,
      HOME: home,
      AGENTS_DIR: join(home, ".agents"),
      DOCKS_KIT_ENGINE: "",
      DOCKS_KIT_HOME: REPO_DIR,
      ...environment
    }
  })

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})

describe("command reporting", () => {
  it("rejects explicitly empty and blank models instead of treating them as read requests", () => {
    for (const value of ["", "   "]) {
      const result = runCli(
        ["model", "claude", value],
        temporaryDirectory("docks-model-empty-")
      )

      expect(result.status).toBe(2)
      expect(`${result.stdout}\n${result.stderr}`).toContain("Model value must not be empty or blank")
    }
  })

  it("reports malformed deployed Claude settings as JSON data with a failing exit", () => {
    const home = temporaryDirectory("docks-status-malformed-")
    mkdirSync(join(home, ".claude"), { recursive: true })
    writeFileSync(join(home, ".claude", "settings.json"), "{not-json\n")

    const result = runCli(["status", "--json"], home)
    const output = JSON.parse(result.stdout) as {
      deployment: { claude: { state: string; diagnostic: string } }
      drift: Array<{ setting: string; deployed: string }>
      diagnostics: Array<{ source: string; message: string; exitCode: number }>
    }

    expect(result.status).toBe(1)
    expect(output.deployment.claude.state).toBe("malformed")
    expect(output.deployment.claude.diagnostic).toContain("invalid JSON")
    expect(output.drift).toContainEqual(
      expect.objectContaining({ setting: "claude.settings", deployed: "(malformed)" })
    )
    expect(output.diagnostics).toContainEqual(
      expect.objectContaining({ source: "claude.settings", exitCode: 1 })
    )
    expect(result.stderr).not.toContain("SyntaxError")
  })

  it("models an absent Claude deployment separately from unset settings", () => {
    const result = runCli(["status", "--json"], temporaryDirectory("docks-status-absent-"))
    const output = JSON.parse(result.stdout) as {
      deployment: { claude: { state: string } }
      drift: Array<{ setting: string; deployed: string }>
    }

    expect(output.deployment.claude.state).toBe("absent")
    expect(output.drift).toContainEqual({
      setting: "claude.settings",
      deployed: "(absent)",
      sot: "present",
      drifted: true
    })
    expect(output.drift.some((row) => row.setting === "claude.model")).toBe(false)
  })

  it("preserves an empty Claude plugin occurrence for engine validation", () => {
    const result = runCli(
      ["sync", "claude", "--claude-plugin=", "--dry-run"],
      temporaryDirectory("docks-plugin-empty-")
    )

    expect(result.status).toBe(2)
    expect(`${result.stdout}\n${result.stderr}`).toContain("Invalid Claude plugin ''")
  })

  it.each([
    ["--claude-model", "Invalid Claude model ''"],
    ["--claude-effort", "Invalid Claude effort ''"],
    ["--claude-compact-window", "--claude-compact-window expects a token count"],
    ["--claude-advisor", "Invalid Claude advisor state ''"]
  ])("preserves an empty %s occurrence for engine validation", (flag, expectedDiagnostic) => {
    const result = runCli(
      ["sync", "claude", `${flag}=`, "--dry-run"],
      temporaryDirectory("docks-modifier-empty-")
    )

    expect(result.status).toBe(2)
    expect(`${result.stdout}\n${result.stderr}`).toContain(expectedDiagnostic)
  })

  it("renders the Claude-specific model acceptance rule", () => {
    const result = runCli(["models", "claude"], temporaryDirectory("docks-models-rule-"))

    expect(result.status).toBe(0)
    expect(result.stdout).toContain("full claude-* model IDs outside the catalog")
    expect(result.stdout).not.toContain("well-formed IDs outside the catalog")
  })

  it("reports engine capture failure in human and JSON status output with its exit status", () => {
    const home = temporaryDirectory("docks-status-capture-home-")
    const incompleteKit = temporaryDirectory("docks-status-capture-kit-")
    writeFileSync(join(incompleteKit, "package.json"), '{"name":"docks-kit","version":"0.0.0"}\n')
    const environment = { DOCKS_KIT_HOME: incompleteKit }

    const jsonResult = runCli(["status", "--json"], home, environment)
    const output = JSON.parse(jsonResult.stdout) as {
      toolchain: { state: string; diagnostic: string; exitCode: number }
      diagnostics: Array<{ source: string; message: string; exitCode: number }>
    }
    expect(jsonResult.status).toBe(1)
    expect(output.toolchain).toEqual(
      expect.objectContaining({ state: "failed", exitCode: 1 })
    )
    expect(output.toolchain.diagnostic).toContain("engine capture failed for 'toolchain check'")
    expect(output.diagnostics).toContainEqual(
      expect.objectContaining({ source: "toolchain", exitCode: 1 })
    )

    const humanResult = runCli(["status"], home, environment)
    expect(humanResult.status).toBe(1)
    expect(humanResult.stdout).toContain("ERROR: engine capture failed for 'toolchain check'")
  })
})
