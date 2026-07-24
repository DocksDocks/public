import { spawnSync } from "node:child_process"
import { existsSync, mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { describe, expect, it } from "vitest"

const REPO_DIR = resolve(import.meta.dirname, "..", "..", "..")
const CLI = join(REPO_DIR, "cli", "src", "main.ts")
const LEGACY_FLAGS = [
  "--model-orchestrator=claude:fable@high",
  "--model-reviewer=codex:gpt-5.6-sol@high",
  "--model-implementer=codex:gpt-5.6-sol@high",
  "--review-min-score=80",
  "--review-max-rounds=2"
]

describe("removed workflow configuration surface", () => {
  it("rejects the former workflow model registry selector", () => {
    for (const args of [["models", "workflow"], ["models", "workflow", "--json"]]) {
      const result = spawnSync("bun", [CLI, ...args], { encoding: "utf8" })
      expect(result.status, args.join(" ")).not.toBe(0)
      expect(`${result.stdout}\n${result.stderr}`, args.join(" ")).not.toContain("Workflow model registry")
    }
  })

  it("rejects former root overrides without writing prompt files", () => {
    const home = mkdtempSync(join(tmpdir(), "workflow-removal-"))
    try {
      for (const flag of LEGACY_FLAGS) {
        const result = spawnSync("bun", [CLI, flag], {
          encoding: "utf8",
          env: { ...process.env, HOME: home, AGENTS_DIR: join(home, ".agents") }
        })
        expect(result.status, flag).not.toBe(0)
      }
      expect(existsSync(join(home, ".claude", "CLAUDE.md"))).toBe(false)
      expect(existsSync(join(home, ".codex", "AGENTS.md"))).toBe(false)
    } finally {
      rmSync(home, { recursive: true, force: true })
    }
  }, 15_000)

  it("rejects the former native workflow command", () => {
    const home = mkdtempSync(join(tmpdir(), "workflow-native-removal-"))
    try {
      const result = spawnSync("bun", [CLI, "workflow", LEGACY_FLAGS[1]!], {
        encoding: "utf8",
        env: {
          ...process.env,
          HOME: home,
          AGENTS_DIR: join(home, ".agents"),
          DOCKS_KIT_ENGINE: "native-raw"
        }
      })
      expect(result.status).toBe(2)
      expect(`${result.stdout}\n${result.stderr}`).toContain("Unknown arg: workflow")
      expect(existsSync(join(home, ".claude", "CLAUDE.md"))).toBe(false)
      expect(existsSync(join(home, ".codex", "AGENTS.md"))).toBe(false)
    } finally {
      rmSync(home, { recursive: true, force: true })
    }
  })

  it("omits former workflow override flags from root help", () => {
    const result = spawnSync("bun", [CLI, "--help"], { encoding: "utf8" })
    expect(result.status).toBe(0)
    for (const flag of LEGACY_FLAGS.map((value) => value.slice(0, value.indexOf("=")))) {
      expect(result.stdout).not.toContain(flag)
    }
  })
})
