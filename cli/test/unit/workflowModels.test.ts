import { spawnSync } from "node:child_process"
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { describe, expect, it } from "vitest"

import {
  WORKFLOW_RECORD_PREFIX,
  buildWorkflowRecord,
  compactJcs,
  defaultWorkflowRecord,
  parseWorkflowBound,
  parseWorkflowRecord,
  renderWorkflowRecordLine,
  resolveWorkflowSelector,
  workflowRegistryView
} from "../../src/workflowModels"

const REPO_DIR = resolve(import.meta.dirname, "..", "..", "..")
const CLI = join(REPO_DIR, "cli", "src", "main.ts")

describe("workflow model registry", () => {
  it("exposes the closed defaults, ordered profile, strict tools, and deferred availability", () => {
    expect(workflowRegistryView()).toEqual({
      schema: 2,
      profiles: {
        "claude-best": {
          candidates: [
            { company: "anthropic", tool: "claude", model: "fable", effort: "high" },
            { company: "anthropic", tool: "claude", model: "claude-opus-4-8", effort: "xhigh" }
          ]
        }
      },
      defaults: {
        orchestrator: "profile:claude-best",
        reviewer: "codex:gpt-5.6-sol@high",
        implementer: "codex:gpt-5.6-sol@high",
        review: { minimum_score: 90, max_rounds: 3 }
      },
      tools: {
        claude: {
          models: [
            "best",
            "opus",
            "fable",
            "sonnet",
            "haiku",
            "claude-fable-5",
            "claude-opus-4-8",
            "claude-sonnet-5",
            "claude-haiku-4-5-20251001"
          ],
          efforts: ["low", "medium", "high", "xhigh"]
        },
        codex: {
          models: [
            "gpt-5.6-sol",
            "gpt-5.6-terra",
            "gpt-5.6-luna",
            "gpt-5.5",
            "gpt-5.5-codex",
            "gpt-5.1",
            "gpt-5",
            "gpt-5-codex"
          ],
          efforts: ["none", "minimal", "low", "medium", "high", "xhigh", "max", "ultra"]
        }
      },
      exact_target_grammar: "<tool>:<model>@<effort>[+fast]",
      availability: "checked_when_used"
    })
  })

  it("expands defaults to the exact Docks workflow record", () => {
    expect(defaultWorkflowRecord()).toEqual({
      schema: 1,
      orchestrator: {
        selector: "profile:claude-best",
        candidates: [
          { company: "anthropic", tool: "claude", model: "fable", effort: "high" },
          { company: "anthropic", tool: "claude", model: "claude-opus-4-8", effort: "xhigh" }
        ]
      },
      reviewer: {
        selector: "codex:gpt-5.6-sol@high",
        candidates: [
          { company: "openai", tool: "codex", model: "gpt-5.6-sol", effort: "high" }
        ]
      },
      implementer: {
        selector: "codex:gpt-5.6-sol@high",
        candidates: [
          { company: "openai", tool: "codex", model: "gpt-5.6-sol", effort: "high" }
        ]
      },
      review: { minimum_score: 90, max_rounds: 3 }
    })
  })

  it("resolves profiles and strict exact targets without treating the default pseudo-value as executable", () => {
    expect(resolveWorkflowSelector("profile:claude-best").candidates.map(({ model }) => model)).toEqual([
      "fable",
      "claude-opus-4-8"
    ])
    expect(resolveWorkflowSelector("claude:best@high")).toEqual({
      selector: "claude:best@high",
      candidates: [
        { company: "anthropic", tool: "claude", model: "best", effort: "high" }
      ]
    })
    expect(resolveWorkflowSelector("codex:gpt-5.6-terra@ultra")).toEqual({
      selector: "codex:gpt-5.6-terra@ultra",
      candidates: [
        { company: "openai", tool: "codex", model: "gpt-5.6-terra", effort: "ultra" }
      ]
    })
    expect(resolveWorkflowSelector("codex:gpt-5.6-sol@high+fast")).toEqual({
      selector: "codex:gpt-5.6-sol@high+fast",
      candidates: [
        {
          company: "openai",
          tool: "codex",
          model: "gpt-5.6-sol",
          effort: "high",
          service_tier: "fast"
        }
      ]
    })

    for (const invalid of [
      "",
      " profile:claude-best",
      "profile:claude-best ",
      "profile:missing",
      "claude:default@high",
      "claude:unknown@high",
      "claude:fable@ultra",
      "codex:gpt-5.6-sol@extreme",
      "claude:fable@high+fast",
      "profile:claude-best+fast",
      "codex:gpt-5.6-sol@high+default",
      "codex:gpt-5.6-sol@high+fast+fast",
      "codex:gpt-5.6-sol@high-fast",
      "other:gpt-5.6-sol@xhigh",
      "codex:gpt-5.6-sol",
      "codex:gpt-5.6-sol@xhigh@extra"
    ]) {
      expect(() => resolveWorkflowSelector(invalid), invalid).toThrow(/workflow selector|profile|model|effort/i)
    }
  })

  it("accepts only decimal integer review bounds at the documented endpoints", () => {
    expect(parseWorkflowBound("minimum_score", "0")).toBe(0)
    expect(parseWorkflowBound("minimum_score", "100")).toBe(100)
    expect(parseWorkflowBound("max_rounds", "1")).toBe(1)
    expect(parseWorkflowBound("max_rounds", "10")).toBe(10)

    for (const value of ["", "-1", "+1", "1.0", "1e1", " 1", "1 ", "101"]) {
      expect(() => parseWorkflowBound("minimum_score", value), value).toThrow(/minimum_score/)
    }
    for (const value of ["", "0", "11", "-1", "+1", "1.0", "1e1", " 1", "1 "]) {
      expect(() => parseWorkflowBound("max_rounds", value), value).toThrow(/max_rounds/)
    }
  })

  it("merges partial overrides over a complete validated base", () => {
    const base = buildWorkflowRecord({
      reviewer: "codex:gpt-5.6-terra@high",
      minimumScore: "80"
    })
    const updated = buildWorkflowRecord(
      {
        orchestrator: "claude:best@high",
        maxRounds: "5"
      },
      base
    )

    expect(updated.orchestrator.selector).toBe("claude:best@high")
    expect(updated.reviewer.selector).toBe("codex:gpt-5.6-terra@high")
    expect(updated.implementer.selector).toBe("codex:gpt-5.6-sol@high")
    expect(updated.review).toEqual({ minimum_score: 80, max_rounds: 5 })
  })

  it("versions Fast records without letting Fast leak into selectors that omit the suffix", () => {
    const fast = buildWorkflowRecord({
      reviewer: "codex:gpt-5.6-sol@high+fast",
      implementer: "codex:gpt-5.6-sol@high"
    })

    expect(fast.schema).toBe(2)
    expect(fast.reviewer.candidates).toEqual([
      {
        company: "openai",
        tool: "codex",
        model: "gpt-5.6-sol",
        effort: "high",
        service_tier: "fast"
      }
    ])
    expect(fast.implementer.candidates).toEqual([
      { company: "openai", tool: "codex", model: "gpt-5.6-sol", effort: "high" }
    ])
    expect(parseWorkflowRecord(fast)).toEqual(fast)

    const standard = buildWorkflowRecord(
      { reviewer: "codex:gpt-5.6-sol@high" },
      fast
    )
    expect(standard).toEqual(defaultWorkflowRecord())
    expect(standard.schema).toBe(1)
  })

  it("rejects malformed, open, and internally inconsistent deployed records", () => {
    const valid = defaultWorkflowRecord()
    expect(parseWorkflowRecord(valid)).toEqual(valid)

    expect(() => parseWorkflowRecord({ ...valid, extra: true })).toThrow(/record/i)
    expect(() => parseWorkflowRecord({ ...valid, schema: 2 })).toThrow(/service tier|schema/i)
    expect(() => parseWorkflowRecord({
      ...valid,
      reviewer: {
        selector: "codex:gpt-5.6-sol@high+fast",
        candidates: [
          {
            company: "openai",
            tool: "codex",
            model: "gpt-5.6-sol",
            effort: "high",
            service_tier: "fast"
          }
        ]
      }
    })).toThrow(/service tier|schema/i)
    expect(() => parseWorkflowRecord({
      ...valid,
      orchestrator: {
        ...valid.orchestrator,
        candidates: [...valid.orchestrator.candidates].reverse()
      }
    })).toThrow(/orchestrator/i)
    expect(() => parseWorkflowRecord({
      ...valid,
      review: { ...valid.review, minimum_score: 101 }
    })).toThrow(/minimum_score/i)
  })

  it("renders compact lexicographic JCS and the byte-stable instruction line", () => {
    expect(compactJcs({ z: 1, a: { y: 2, b: 3 }, list: [{ d: 4, c: 5 }] })).toBe(
      '{"a":{"b":3,"y":2},"list":[{"c":5,"d":4}],"z":1}'
    )
    expect(renderWorkflowRecordLine(defaultWorkflowRecord())).toBe(
      `${WORKFLOW_RECORD_PREFIX}{"implementer":{"candidates":[{"company":"openai","effort":"high","model":"gpt-5.6-sol","tool":"codex"}],"selector":"codex:gpt-5.6-sol@high"},"orchestrator":{"candidates":[{"company":"anthropic","effort":"high","model":"fable","tool":"claude"},{"company":"anthropic","effort":"xhigh","model":"claude-opus-4-8","tool":"claude"}],"selector":"profile:claude-best"},"review":{"max_rounds":3,"minimum_score":90},"reviewer":{"candidates":[{"company":"openai","effort":"high","model":"gpt-5.6-sol","tool":"codex"}],"selector":"codex:gpt-5.6-sol@high"},"schema":1}`
    )
  })

  it("renders the workflow helper as stable text and machine-readable JSON", () => {
    const json = spawnSync("bun", [CLI, "models", "workflow", "--json"], { encoding: "utf8" })
    expect(json.status).toBe(0)
    expect(JSON.parse(json.stdout)).toEqual(workflowRegistryView())
    expect(json.stderr).toBe("")

    const text = spawnSync("bun", [CLI, "models", "workflow"], { encoding: "utf8" })
    expect(text.status).toBe(0)
    expect(text.stdout).toContain("profile:claude-best")
    expect(text.stdout).toContain("claude:fable@high")
    expect(text.stdout).toContain("claude:claude-opus-4-8@xhigh")
    expect(text.stdout).toContain("<tool>:<model>@<effort>[+fast]")
    expect(text.stdout).toContain("Without +fast, Codex roles use Standard")
    expect(text.stdout).toContain("Availability: checked when used by Docks")
    expect(text.stdout).not.toMatch(/provider-wide fallback|preflight/i)
  })

  it("routes public root overrides to workflow-only deployment", () => {
    const home = mkdtempSync(join(tmpdir(), "workflow-public-cli-"))
    mkdirSync(join(home, ".claude"), { recursive: true })
    mkdirSync(join(home, ".codex"), { recursive: true })
    try {
      const result = spawnSync(
        "bun",
        [
          CLI,
          "--model-reviewer",
          "codex:gpt-5.6-terra@high",
          "--review-min-score=80"
        ],
        {
          encoding: "utf8",
          env: { ...process.env, HOME: home, AGENTS_DIR: join(home, ".agents") }
        }
      )
      expect(result.status).toBe(0)
      expect(result.stdout).toBe("")
      expect(result.stderr).toContain("Workflow models updated")
      expect(result.stderr).not.toContain("Sync complete")

      const claude = readFileSync(join(home, ".claude", "CLAUDE.md"), "utf8")
      const codex = readFileSync(join(home, ".codex", "AGENTS.md"), "utf8")
      const claudeLine = claude.split("\n").find((line) => line.startsWith(WORKFLOW_RECORD_PREFIX))
      const codexLine = codex.split("\n").find((line) => line.startsWith(WORKFLOW_RECORD_PREFIX))
      expect(claudeLine).toBe(codexLine)
      expect(claudeLine).toContain('"minimum_score":80')
      expect(claudeLine).toContain('"model":"gpt-5.6-terra"')
    } finally {
      rmSync(home, { recursive: true, force: true })
    }
  })

  it("deploys quoted-compatible Fast selectors as one schema-2 record without changing standard roles", () => {
    const home = mkdtempSync(join(tmpdir(), "workflow-public-fast-cli-"))
    mkdirSync(join(home, ".claude"), { recursive: true })
    mkdirSync(join(home, ".codex"), { recursive: true })
    try {
      const result = spawnSync(
        "bun",
        [
          CLI,
          "--model-reviewer=codex:gpt-5.6-sol@high+fast",
          "--model-implementer=codex:gpt-5.6-sol@high"
        ],
        {
          encoding: "utf8",
          env: { ...process.env, HOME: home, AGENTS_DIR: join(home, ".agents") }
        }
      )
      expect(result.status).toBe(0)

      const claude = readFileSync(join(home, ".claude", "CLAUDE.md"), "utf8")
      const codex = readFileSync(join(home, ".codex", "AGENTS.md"), "utf8")
      const claudeLine = claude.split("\n").find((line) => line.startsWith(WORKFLOW_RECORD_PREFIX))
      const codexLine = codex.split("\n").find((line) => line.startsWith(WORKFLOW_RECORD_PREFIX))
      expect(claudeLine).toBe(codexLine)

      const record = JSON.parse(claudeLine!.slice(WORKFLOW_RECORD_PREFIX.length))
      expect(record.schema).toBe(2)
      expect(record.reviewer.candidates[0].service_tier).toBe("fast")
      expect(record.implementer.candidates[0]).not.toHaveProperty("service_tier")
    } finally {
      rmSync(home, { recursive: true, force: true })
    }
  })

  it("shows the workflow registry for public bare and explicitly empty root flags", () => {
    for (const args of [
      ["--model-orchestrator"],
      ["--model-reviewer="],
      ["--review-max-rounds"]
    ]) {
      const result = spawnSync("bun", [CLI, ...args], { encoding: "utf8" })
      expect(result.status, args.join(" ")).toBe(2)
      expect(result.stdout, args.join(" ")).toContain("Workflow model registry")
      expect(result.stderr, args.join(" ")).toMatch(/requires a value|must be a base-10 integer/)
    }
  })

  it("lists every workflow override in public root help", () => {
    const result = spawnSync("bun", [CLI, "--help"], { encoding: "utf8" })
    expect(result.status).toBe(0)
    for (const flag of [
      "--model-orchestrator",
      "--model-reviewer",
      "--model-implementer",
      "--review-min-score",
      "--review-max-rounds"
    ]) {
      expect(result.stdout).toContain(flag)
    }
  })
})
