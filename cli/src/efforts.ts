import { sotClaudeSettings, type Tool } from "./manifests"
import { payloadText } from "./payload"

export const CLAUDE_EFFORT_LEVELS = ["low", "medium", "high", "xhigh"] as const
export const CODEX_REASONING_EFFORTS = [
  "none",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
  "ultra"
] as const
export const CLAUDE_ADVISOR_STATES = ["on", "off", "default"] as const

const VERIFIED = "2026-07-10"
const DEFAULT = "default"

export type ClaudeEffortLevel = typeof CLAUDE_EFFORT_LEVELS[number]
export type CodexReasoningEffort = typeof CODEX_REASONING_EFFORTS[number]
export type ClaudeAdvisorState = typeof CLAUDE_ADVISOR_STATES[number]

const upstreamEfforts = (tool: Tool): ReadonlyArray<string> =>
  tool === "claude" ? CLAUDE_EFFORT_LEVELS : CODEX_REASONING_EFFORTS

export const effortModifierValues = (tool: Tool): ReadonlyArray<string> => [
  ...upstreamEfforts(tool),
  DEFAULT
]

export const isEffortModifierValue = (tool: Tool, value: string): boolean =>
  effortModifierValues(tool).includes(value)

export function validateEffortDefault(tool: Tool, value: unknown): string {
  const toolName = tool === "claude" ? "Claude" : "Codex"
  const setting = tool === "claude" ? "effortLevel" : "model_reasoning_effort"
  if (typeof value !== "string" || value === "") {
    throw new Error(`Embedded SoT ${toolName} ${setting} is missing`)
  }
  if (!upstreamEfforts(tool).includes(value)) {
    throw new Error(`Embedded SoT ${toolName} ${setting} '${value}' is outside the verified catalog`)
  }
  return value
}

function codexSotEffort(): string | undefined {
  return payloadText("SoT/.codex/config.toml").match(/^model_reasoning_effort\s*=\s*"([^"]+)"/m)?.[1]
}

export function sotEffort(tool: Tool): string {
  const value = tool === "claude" ? sotClaudeSettings().effortLevel : codexSotEffort()
  return validateEffortDefault(tool, value)
}

export function resolveEffort(tool: Tool, value: string): string {
  if (value === DEFAULT) return sotEffort(tool)
  if (!upstreamEfforts(tool).includes(value)) {
    throw new Error(`Invalid ${tool} effort '${value}'`)
  }
  return value
}

export function effortCatalog(tool: Tool): string {
  const setting = tool === "claude" ? "effortLevel" : "model_reasoning_effort"
  const lines = [
    `Available ${tool} effort levels (${setting}; verified ${VERIFIED}):`,
    ...upstreamEfforts(tool).map((value) => `  ${value}`),
    `  default  — SoT: ${sotEffort(tool)}`
  ]
  if (tool === "codex") lines.push("  (support is model-dependent)")
  return lines.join("\n")
}

export function advisorCatalog(): string {
  return [
    `Available claude advisor states (advisorModel; verified ${VERIFIED}):`,
    "  on  — set advisorModel: fable",
    "  off  — unset advisorModel",
    "  default  — SoT: off (unset)"
  ].join("\n")
}
