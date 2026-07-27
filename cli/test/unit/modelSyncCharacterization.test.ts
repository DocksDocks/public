import { readFileSync, rmSync } from "node:fs"
import { join } from "node:path"
import { afterAll, describe, expect, it } from "vitest"

import { modelCatalog } from "../../src/manifests"
import { cleanup, runEngine, runPublicCli } from "../lib/goldenExecution"
import { FIXTURES_DIR, cleanupTemporaryDirs, makeStubDir } from "../lib/goldenResources"

const EXPECTED_CATALOGS = {
  claude: {
    verified: "2026-07-27",
    models: [
      { id: "best", kind: "alias", note: "Fable 5 where the org has access, latest Opus otherwise (Claude Code >=2.1.170)" },
      { id: "opus", kind: "alias", note: "latest Opus — the kit SoT default (Opus 5 on the Anthropic API from Claude Code >=2.1.219; Opus 4.6 on Microsoft Foundry)" },
      { id: "fable", kind: "alias", note: "Fable 5 — advisor opt-in default; needs org access + Claude Code >=2.1.170" },
      { id: "sonnet", kind: "alias", note: "latest Sonnet (currently Sonnet 5)" },
      { id: "haiku", kind: "alias", note: "latest Haiku (currently Haiku 4.5)" },
      { id: "default", kind: "alias", note: "engine pseudo-value: deletes the deployed model key so the account default applies" },
      { id: "claude-fable-5", kind: "id", note: "Fable 5" },
      { id: "claude-opus-5", kind: "id", note: "Opus 5 — needs Claude Code >=2.1.219" },
      { id: "claude-opus-4-8", kind: "id", note: "Opus 4.8" },
      { id: "claude-sonnet-5", kind: "id", note: "Sonnet 5" },
      { id: "claude-haiku-4-5-20251001", kind: "id", note: "Haiku 4.5" }
    ]
  },
  codex: {
    verified: "2026-07-16",
    models: [
      { id: "gpt-5.6-sol", kind: "id", note: "GPT-5.6 Sol — frontier, recommended default; the kit SoT pin" },
      { id: "gpt-5.6-terra", kind: "id", note: "GPT-5.6 Terra — balanced tier" },
      { id: "gpt-5.6-luna", kind: "id", note: "GPT-5.6 Luna — fast/light tier" },
      { id: "gpt-5.5", kind: "id", note: "previous generation" },
      { id: "gpt-5.5-codex", kind: "id", note: "codex-tuned gpt-5.5" },
      { id: "gpt-5.1", kind: "id", note: "previous generation" },
      { id: "gpt-5", kind: "id", note: "previous generation" },
      { id: "gpt-5-codex", kind: "id", note: "codex-tuned gpt-5" }
    ]
  }
} as const

afterAll(cleanupTemporaryDirs)

function deployedText(home: string, path: string): string {
  return readFileSync(join(home, ...path.split("/")), "utf8")
}

describe.sequential("retained model and sync behavior", () => {
  it("keeps the normal Claude and Codex catalogs available without a role registry", () => {
    expect(modelCatalog("claude")).toEqual(EXPECTED_CATALOGS.claude)
    expect(modelCatalog("codex")).toEqual(EXPECTED_CATALOGS.codex)

    const run = runPublicCli(["models", "--json"], "home-fresh", makeStubDir())
    try {
      expect(run.exitCode).toBe(0)
      expect(JSON.parse(run.stdout)).toEqual(EXPECTED_CATALOGS)
      expect(run.stderr).toBe("")
    } finally {
      rmSync(run.home, { recursive: true, force: true })
    }
  })

  it("parses ordinary model and effort modifiers through the public sync command", () => {
    const fixtureClaude = readFileSync(join(FIXTURES_DIR, "home-drift", ".claude", "settings.json"), "utf8")
    const fixtureCodex = readFileSync(join(FIXTURES_DIR, "home-drift", ".codex", "config.toml"), "utf8")
    const run = runPublicCli(
      [
        "sync",
        "claude",
        "codex",
        "--dry-run",
        "--claude-model=opus",
        "--claude-effort=xhigh",
        "--codex-model=gpt-5.5",
        "--codex-effort=ultra"
      ],
      "home-drift",
      makeStubDir()
    )
    try {
      expect(run.exitCode).toBe(0)
      expect(run.stdout).toContain("[dry-run] (--claude-model) set .model=opus")
      expect(run.stdout).toContain("[dry-run] (--claude-effort) set .effortLevel=xhigh")
      expect(run.stdout).toContain('[dry-run] (--codex-model) set model = "gpt-5.5"')
      expect(run.stdout).toContain('[dry-run] (--codex-effort) set model_reasoning_effort = "ultra"')
      expect(deployedText(run.home, ".claude/settings.json")).toBe(fixtureClaude)
      expect(deployedText(run.home, ".codex/config.toml")).toBe(fixtureCodex)
    } finally {
      rmSync(run.home, { recursive: true, force: true })
    }
  })

  it("restores normal SoT model and effort defaults on a flag-less fixture sync", () => {
    const run = runEngine("native", ["sync"], "home-drift", makeStubDir())
    try {
      expect(run.exitCode).toBe(0)

      const claude = JSON.parse(deployedText(run.home, ".claude/settings.json")) as {
        model: string
        effortLevel: string
        env: Record<string, string>
        permissions: { allow: Array<string> }
      }
      expect(claude.model).toBe("opus")
      expect(claude.effortLevel).toBe("high")
      expect(claude.env["MY_CUSTOM_VAR"]).toBe("1")
      expect(claude.permissions.allow).toContain("Bash(my-tool *)")
      expect(claude.permissions.allow).toContain("Read")

      const codex = deployedText(run.home, ".codex/config.toml")
      expect(codex.match(/^model\s*=\s*"([^"]*)"$/m)?.[1]).toBe("gpt-5.6-sol")
      expect(codex.match(/^model_reasoning_effort\s*=\s*"([^"]*)"$/m)?.[1]).toBe("high")
      expect(codex).toMatch(/^custom_user_key = "keepme"$/m)
      expect(codex).toMatch(/^\[user_only\.table\]\nkeep = true$/m)
      expect(codex).not.toMatch(/^use_legacy_landlock\s*=/m)
    } finally {
      cleanup([run])
    }
  })
})
