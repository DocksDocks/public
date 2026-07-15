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

describe("workflow model registry", () => {
  it("exposes the closed defaults, ordered profile, strict tools, and deferred availability", () => {
    expect(workflowRegistryView()).toEqual({
      schema: 1,
      profiles: {
        "claude-best": {
          candidates: [
            { company: "anthropic", tool: "claude", model: "fable", effort: "high" },
            { company: "anthropic", tool: "claude", model: "opus", effort: "xhigh" }
          ]
        }
      },
      defaults: {
        orchestrator: "profile:claude-best",
        reviewer: "codex:gpt-5.6-sol@xhigh",
        implementer: "codex:gpt-5.6-sol@xhigh",
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
      exact_target_grammar: "<tool>:<model>@<effort>",
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
          { company: "anthropic", tool: "claude", model: "opus", effort: "xhigh" }
        ]
      },
      reviewer: {
        selector: "codex:gpt-5.6-sol@xhigh",
        candidates: [
          { company: "openai", tool: "codex", model: "gpt-5.6-sol", effort: "xhigh" }
        ]
      },
      implementer: {
        selector: "codex:gpt-5.6-sol@xhigh",
        candidates: [
          { company: "openai", tool: "codex", model: "gpt-5.6-sol", effort: "xhigh" }
        ]
      },
      review: { minimum_score: 90, max_rounds: 3 }
    })
  })

  it("resolves profiles and strict exact targets without treating the default pseudo-value as executable", () => {
    expect(resolveWorkflowSelector("profile:claude-best").candidates.map(({ model }) => model)).toEqual([
      "fable",
      "opus"
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

    for (const invalid of [
      "",
      " profile:claude-best",
      "profile:claude-best ",
      "profile:missing",
      "claude:default@high",
      "claude:unknown@high",
      "claude:fable@ultra",
      "codex:gpt-5.6-sol@extreme",
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
    expect(updated.implementer.selector).toBe("codex:gpt-5.6-sol@xhigh")
    expect(updated.review).toEqual({ minimum_score: 80, max_rounds: 5 })
  })

  it("rejects malformed, open, and internally inconsistent deployed records", () => {
    const valid = defaultWorkflowRecord()
    expect(parseWorkflowRecord(valid)).toEqual(valid)

    expect(() => parseWorkflowRecord({ ...valid, extra: true })).toThrow(/record/i)
    expect(() => parseWorkflowRecord({ ...valid, schema: 2 })).toThrow(/record/i)
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
      `${WORKFLOW_RECORD_PREFIX}{"implementer":{"candidates":[{"company":"openai","effort":"xhigh","model":"gpt-5.6-sol","tool":"codex"}],"selector":"codex:gpt-5.6-sol@xhigh"},"orchestrator":{"candidates":[{"company":"anthropic","effort":"high","model":"fable","tool":"claude"},{"company":"anthropic","effort":"xhigh","model":"opus","tool":"claude"}],"selector":"profile:claude-best"},"review":{"max_rounds":3,"minimum_score":90},"reviewer":{"candidates":[{"company":"openai","effort":"xhigh","model":"gpt-5.6-sol","tool":"codex"}],"selector":"codex:gpt-5.6-sol@xhigh"},"schema":1}`
    )
  })
})
