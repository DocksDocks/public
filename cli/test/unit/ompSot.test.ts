import { readFileSync } from "node:fs"
import { join, resolve } from "node:path"
import { describe, expect, it } from "vitest"
import { parse } from "yaml"

const REPO_DIR = resolve(import.meta.dirname, "..", "..", "..")
const OMP_SOT = join(REPO_DIR, "SoT", ".omp")

function readSot(name: string): string {
  return readFileSync(join(OMP_SOT, name), "utf8")
}

function ompConfig(): Record<string, unknown> {
  const parsed = parse(readSot("config.yml")) as unknown
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error("SoT/.omp/config.yml must parse to a mapping")
  }
  return parsed as Record<string, unknown>
}

describe("SoT omp tree", () => {
  it("parses config.yml as a YAML mapping", () => {
    expect(Object.keys(ompConfig()).length).toBeGreaterThan(0)
  })

  it("loads the canonical ~/.agents skills only", () => {
    expect(ompConfig()["skills"]).toEqual({
      enableClaudeUser: false,
      enableCodexUser: false,
      enableAgentsUser: true
    })
  })

  // omp rejects `unexpectedStopDetection: true` with
  // `Valid values: none, mechanical, smart`, so a stale boolean in the SoT
  // would quarantine the deployed global YAML and fail omp startup.
  it("declares the current enum value for unexpected-stop detection", () => {
    expect(ompConfig()["features"]).toEqual({ unexpectedStopDetection: "smart" })
  })

  // `omp config get advisor.subagents` answers `Unknown setting`. A retired key
  // in a kit-managed file would break every omp session on every machine.
  it("declares no retired advisor.subagents key", () => {
    const advisor = ompConfig()["advisor"]
    expect(advisor).toBeTypeOf("object")
    expect(Object.keys(advisor as Record<string, unknown>)).not.toContain("subagents")
  })

  // `setupVersion` is omp's own bookkeeping counter, not configuration. A
  // kit-declared value would reset the deployed marker on every sync.
  it("declares no setupVersion bookkeeping key", () => {
    expect(ompConfig()["setupVersion"]).toBeUndefined()
  })

  it("parses mcp.json as JSON that disables the kit-excluded servers", () => {
    const mcp = JSON.parse(readSot("mcp.json")) as { disabledServers?: unknown }
    expect(mcp.disabledServers).toEqual(["chrome-devtools", "context7:context7", "openaiDeveloperDocs"])
  })

  // pi-intercom's default `npx --no-install tsx` launcher cannot resolve tsx in
  // omp's flat plugin store, so the broker must run under Bun.
  it("parses intercom.json as JSON that runs the broker under Bun", () => {
    const intercom = JSON.parse(readSot("intercom.json")) as { brokerCommand?: unknown }
    expect(intercom.brokerCommand).toBe("bun")
  })

  it("ships AGENTS.md as non-empty global omp guidance", () => {
    expect(readSot("AGENTS.md").startsWith("# Global OMP guidance")).toBe(true)
  })
})
