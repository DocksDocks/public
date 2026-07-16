import {
  CLAUDE_EFFORT_LEVELS,
  CODEX_REASONING_EFFORTS
} from "./efforts"
import { payloadText } from "./payload"

export type WorkflowTool = "claude" | "codex"
export type WorkflowCompany = "anthropic" | "openai"
export type WorkflowRoleName = "orchestrator" | "reviewer" | "implementer"
export type WorkflowBoundName = "minimum_score" | "max_rounds"
export type WorkflowServiceTier = "fast"

export interface WorkflowCandidate {
  readonly company: WorkflowCompany
  readonly tool: WorkflowTool
  readonly model: string
  readonly effort: string
  readonly service_tier?: WorkflowServiceTier
}

export interface WorkflowRole {
  readonly selector: string
  readonly candidates: ReadonlyArray<WorkflowCandidate>
}

export interface WorkflowRecordV1 {
  readonly schema: 1
  readonly orchestrator: WorkflowRole
  readonly reviewer: WorkflowRole
  readonly implementer: WorkflowRole
  readonly review: {
    readonly minimum_score: number
    readonly max_rounds: number
  }
}

export interface WorkflowRecordV2 {
  readonly schema: 2
  readonly orchestrator: WorkflowRole
  readonly reviewer: WorkflowRole
  readonly implementer: WorkflowRole
  readonly review: {
    readonly minimum_score: number
    readonly max_rounds: number
  }
}

export type WorkflowRecord = WorkflowRecordV1 | WorkflowRecordV2

export interface WorkflowOverrides {
  readonly orchestrator?: string
  readonly reviewer?: string
  readonly implementer?: string
  readonly minimumScore?: string
  readonly maxRounds?: string
}

interface WorkflowProfile {
  readonly candidates: ReadonlyArray<WorkflowCandidate>
}

interface WorkflowRegistryCore {
  readonly schema: 2
  readonly profiles: Readonly<Record<string, WorkflowProfile>>
  readonly defaults: {
    readonly orchestrator: string
    readonly reviewer: string
    readonly implementer: string
    readonly review: {
      readonly minimum_score: number
      readonly max_rounds: number
    }
  }
  readonly exact_target_grammar: "<tool>:<model>@<effort>[+fast]"
  readonly availability: "checked_when_used"
}

export interface WorkflowRegistryView extends WorkflowRegistryCore {
  readonly tools: Readonly<Record<WorkflowTool, {
    readonly models: ReadonlyArray<string>
    readonly efforts: ReadonlyArray<string>
  }>>
}

type UnknownRecord = Record<string, unknown>

export const WORKFLOW_RECORD_PREFIX = "Docks-workflow-models: "

const TOOL_COMPANIES: Readonly<Record<WorkflowTool, WorkflowCompany>> = {
  claude: "anthropic",
  codex: "openai"
}

const isRecord = (value: unknown): value is UnknownRecord =>
  typeof value === "object" && value !== null && !Array.isArray(value)

function hasExactKeys(value: UnknownRecord, keys: ReadonlyArray<string>): boolean {
  const actual = Object.keys(value).sort()
  return actual.length === keys.length && keys.every((key, index) => actual[index] === key)
}

function expectRecord(value: unknown, label: string, keys: ReadonlyArray<string>): UnknownRecord {
  if (!isRecord(value) || !hasExactKeys(value, [...keys].sort())) {
    throw new Error(`${label} must be a closed record`)
  }
  return value
}

function parseManifest(): UnknownRecord {
  const parsed = JSON.parse(payloadText("SoT/models.json")) as unknown
  if (!isRecord(parsed)) throw new Error("Embedded model catalog must be an object")
  return parsed
}

function toolModels(manifest: UnknownRecord, tool: WorkflowTool): ReadonlyArray<string> {
  const entry = manifest[tool]
  if (!isRecord(entry) || !Array.isArray(entry["models"])) {
    throw new Error(`Embedded ${tool} model catalog is invalid`)
  }
  const models = entry["models"].map((item) => {
    if (!isRecord(item) || typeof item["id"] !== "string") {
      throw new Error(`Embedded ${tool} model entry is invalid`)
    }
    return item["id"]
  })
  return models.filter((model) => model !== "default")
}

const toolEfforts = (tool: WorkflowTool): ReadonlyArray<string> =>
  tool === "claude" ? CLAUDE_EFFORT_LEVELS : CODEX_REASONING_EFFORTS

function parseCandidate(
  value: unknown,
  label: string,
  tools: WorkflowRegistryView["tools"],
  allowServiceTier: boolean
): WorkflowCandidate {
  const serviceTier = isRecord(value) ? value["service_tier"] : undefined
  const keys = serviceTier === undefined
    ? ["company", "effort", "model", "tool"]
    : ["company", "effort", "model", "service_tier", "tool"]
  const candidate = expectRecord(value, label, keys)
  const tool = candidate["tool"]
  if (tool !== "claude" && tool !== "codex") throw new Error(`${label} has an invalid tool`)
  const company = candidate["company"]
  const expectedCompany = TOOL_COMPANIES[tool]
  if (company !== expectedCompany) throw new Error(`${label} has an invalid company`)
  const model = candidate["model"]
  if (typeof model !== "string" || !tools[tool].models.includes(model)) {
    throw new Error(`${label} has an unverified ${tool} model`)
  }
  const effort = candidate["effort"]
  if (typeof effort !== "string" || !tools[tool].efforts.includes(effort)) {
    throw new Error(`${label} has an unverified ${tool} effort`)
  }
  if (serviceTier !== undefined) {
    if (!allowServiceTier) throw new Error(`${label} requires workflow record schema 2 for a service tier`)
    if (tool !== "codex" || serviceTier !== "fast") throw new Error(`${label} has an invalid service tier`)
    return { company: expectedCompany, tool, model, effort, service_tier: "fast" }
  }
  return { company: expectedCompany, tool, model, effort }
}

function parseCandidates(
  value: unknown,
  label: string,
  tools: WorkflowRegistryView["tools"],
  allowServiceTier = false
): ReadonlyArray<WorkflowCandidate> {
  if (!Array.isArray(value) || value.length < 1 || value.length > 3) {
    throw new Error(`${label} must contain one to three candidates`)
  }
  return value.map((candidate, index) =>
    parseCandidate(candidate, `${label}[${index}]`, tools, allowServiceTier)
  )
}

function parseNumericBound(name: WorkflowBoundName, value: unknown): number {
  const [minimum, maximum] = name === "minimum_score" ? [0, 100] : [1, 10]
  if (typeof value !== "number" || !Number.isInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${name} must be an integer in ${minimum}..${maximum}`)
  }
  return value
}

function resolveSelector(
  selector: string,
  registry: Pick<WorkflowRegistryView, "profiles" | "tools">
): WorkflowRole {
  const profileMatch = /^profile:([A-Za-z0-9._-]+)$/.exec(selector)
  if (profileMatch !== null) {
    const profileName = profileMatch[1]!
    const profile = registry.profiles[profileName]
    if (profile === undefined) throw new Error(`Unknown workflow profile '${profileName}'`)
    return { selector, candidates: profile.candidates }
  }

  const exactMatch = /^(claude|codex):([A-Za-z0-9._-]+)@([A-Za-z0-9._-]+)(\+fast)?$/.exec(selector)
  if (exactMatch === null) {
    throw new Error(
      `Invalid workflow selector '${selector}' — expected profile:<name> or <tool>:<model>@<effort>[+fast]`
    )
  }
  const tool = exactMatch[1] as WorkflowTool
  const model = exactMatch[2]!
  const effort = exactMatch[3]!
  const fast = exactMatch[4] !== undefined
  if (!registry.tools[tool].models.includes(model)) {
    throw new Error(`Unknown ${tool} workflow model '${model}'`)
  }
  if (!registry.tools[tool].efforts.includes(effort)) {
    throw new Error(`Unknown ${tool} workflow effort '${effort}'`)
  }
  if (fast && tool !== "codex") {
    throw new Error(`Invalid workflow selector '${selector}' — Fast is available only for Codex selectors`)
  }
  const candidate: WorkflowCandidate = { company: TOOL_COMPANIES[tool], tool, model, effort }
  return {
    selector,
    candidates: [fast ? { ...candidate, service_tier: "fast" } : candidate]
  }
}

function loadWorkflowRegistry(): WorkflowRegistryView {
  const manifest = parseManifest()
  const tools: WorkflowRegistryView["tools"] = {
    claude: { models: toolModels(manifest, "claude"), efforts: toolEfforts("claude") },
    codex: { models: toolModels(manifest, "codex"), efforts: toolEfforts("codex") }
  }
  const workflow = expectRecord(
    manifest["workflow"],
    "Embedded workflow registry",
    ["availability", "defaults", "exact_target_grammar", "profiles", "schema"]
  )
  if (workflow["schema"] !== 2) throw new Error("Embedded workflow registry schema must be 2")
  if (workflow["exact_target_grammar"] !== "<tool>:<model>@<effort>[+fast]") {
    throw new Error("Embedded workflow exact-target grammar is invalid")
  }
  if (workflow["availability"] !== "checked_when_used") {
    throw new Error("Embedded workflow availability contract is invalid")
  }

  const rawProfiles = workflow["profiles"]
  if (!isRecord(rawProfiles) || Object.keys(rawProfiles).length === 0) {
    throw new Error("Embedded workflow profiles must be a nonempty record")
  }
  const profiles: Record<string, WorkflowProfile> = {}
  for (const [name, rawProfile] of Object.entries(rawProfiles)) {
    if (!/^[A-Za-z0-9._-]+$/.test(name)) throw new Error(`Invalid workflow profile name '${name}'`)
    const profile = expectRecord(rawProfile, `Workflow profile '${name}'`, ["candidates"])
    profiles[name] = {
      candidates: parseCandidates(profile["candidates"], `Workflow profile '${name}' candidates`, tools)
    }
  }

  const rawDefaults = expectRecord(
    workflow["defaults"],
    "Embedded workflow defaults",
    ["implementer", "orchestrator", "review", "reviewer"]
  )
  const rawReview = expectRecord(
    rawDefaults["review"],
    "Embedded workflow review defaults",
    ["max_rounds", "minimum_score"]
  )
  for (const role of ["orchestrator", "reviewer", "implementer"] as const) {
    if (typeof rawDefaults[role] !== "string") throw new Error(`Embedded workflow ${role} default is invalid`)
  }
  const registry: WorkflowRegistryView = {
    schema: 2,
    profiles,
    defaults: {
      orchestrator: rawDefaults["orchestrator"] as string,
      reviewer: rawDefaults["reviewer"] as string,
      implementer: rawDefaults["implementer"] as string,
      review: {
        minimum_score: parseNumericBound("minimum_score", rawReview["minimum_score"]),
        max_rounds: parseNumericBound("max_rounds", rawReview["max_rounds"])
      }
    },
    tools,
    exact_target_grammar: "<tool>:<model>@<effort>[+fast]",
    availability: "checked_when_used"
  }
  resolveSelector(registry.defaults.orchestrator, registry)
  resolveSelector(registry.defaults.reviewer, registry)
  resolveSelector(registry.defaults.implementer, registry)
  return registry
}

export function workflowRegistryView(): WorkflowRegistryView {
  return loadWorkflowRegistry()
}

export function resolveWorkflowSelector(selector: string): WorkflowRole {
  return resolveSelector(selector, loadWorkflowRegistry())
}

export function parseWorkflowBound(name: WorkflowBoundName, value: string): number {
  if (!/^[0-9]+$/.test(value)) {
    const range = name === "minimum_score" ? "0..100" : "1..10"
    throw new Error(`${name} must be a base-10 integer in ${range}`)
  }
  return parseNumericBound(name, Number(value))
}

export function defaultWorkflowRecord(): WorkflowRecordV1 {
  const registry = loadWorkflowRegistry()
  return {
    schema: 1,
    orchestrator: resolveSelector(registry.defaults.orchestrator, registry),
    reviewer: resolveSelector(registry.defaults.reviewer, registry),
    implementer: resolveSelector(registry.defaults.implementer, registry),
    review: registry.defaults.review
  }
}

function parseRole(
  value: unknown,
  name: WorkflowRoleName,
  registry: WorkflowRegistryView,
  schema: 1 | 2
): WorkflowRole {
  const role = expectRecord(value, `Workflow ${name} role`, ["candidates", "selector"])
  if (typeof role["selector"] !== "string") throw new Error(`Workflow ${name} selector is invalid`)
  const resolved = resolveSelector(role["selector"], registry)
  const candidates = parseCandidates(
    role["candidates"],
    `Workflow ${name} candidates`,
    registry.tools,
    schema === 2
  )
  if (compactJcs(candidates) !== compactJcs(resolved.candidates)) {
    throw new Error(`Workflow ${name} candidates do not match its selector`)
  }
  return resolved
}

function recordUsesFast(roles: ReadonlyArray<WorkflowRole>): boolean {
  return roles.some((role) => role.candidates.some((candidate) => candidate.service_tier === "fast"))
}

export function parseWorkflowRecord(value: unknown): WorkflowRecord {
  const record = expectRecord(
    value,
    "Workflow record",
    ["implementer", "orchestrator", "review", "reviewer", "schema"]
  )
  const schema = record["schema"]
  if (schema !== 1 && schema !== 2) throw new Error("Workflow record schema must be 1 or 2")
  const registry = loadWorkflowRegistry()
  const review = expectRecord(record["review"], "Workflow record review", ["max_rounds", "minimum_score"])
  const orchestrator = parseRole(record["orchestrator"], "orchestrator", registry, schema)
  const reviewer = parseRole(record["reviewer"], "reviewer", registry, schema)
  const implementer = parseRole(record["implementer"], "implementer", registry, schema)
  const parsed = {
    orchestrator,
    reviewer,
    implementer,
    review: {
      minimum_score: parseNumericBound("minimum_score", review["minimum_score"]),
      max_rounds: parseNumericBound("max_rounds", review["max_rounds"])
    }
  }
  if (schema === 2 && !recordUsesFast([orchestrator, reviewer, implementer])) {
    throw new Error("Workflow record schema 2 requires a Fast service tier")
  }
  return schema === 2 ? { schema: 2, ...parsed } : { schema: 1, ...parsed }
}

export function buildWorkflowRecord(
  overrides: WorkflowOverrides,
  base: WorkflowRecord = defaultWorkflowRecord()
): WorkflowRecord {
  const current = parseWorkflowRecord(base)
  const orchestrator = overrides.orchestrator === undefined
      ? current.orchestrator
      : resolveWorkflowSelector(overrides.orchestrator)
  const reviewer = overrides.reviewer === undefined
      ? current.reviewer
      : resolveWorkflowSelector(overrides.reviewer)
  const implementer = overrides.implementer === undefined
      ? current.implementer
      : resolveWorkflowSelector(overrides.implementer)
  const next = {
    orchestrator,
    reviewer,
    implementer,
    review: {
      minimum_score: overrides.minimumScore === undefined
        ? current.review.minimum_score
        : parseWorkflowBound("minimum_score", overrides.minimumScore),
      max_rounds: overrides.maxRounds === undefined
        ? current.review.max_rounds
        : parseWorkflowBound("max_rounds", overrides.maxRounds)
    }
  }
  return recordUsesFast([orchestrator, reviewer, implementer])
    ? { schema: 2, ...next }
    : { schema: 1, ...next }
}

function canonicalValue(value: unknown): unknown {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("JCS cannot encode a non-finite number")
    return value
  }
  if (Array.isArray(value)) return value.map(canonicalValue)
  if (isRecord(value)) {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
        .map(([key, item]) => [key, canonicalValue(item)])
    )
  }
  throw new Error("JCS can encode only JSON values")
}

export function compactJcs(value: unknown): string {
  return JSON.stringify(canonicalValue(value))
}

export function renderWorkflowRecordLine(record: WorkflowRecord): string {
  return `${WORKFLOW_RECORD_PREFIX}${compactJcs(parseWorkflowRecord(record))}`
}

export function workflowRegistryJson(): string {
  return JSON.stringify(workflowRegistryView(), null, 2)
}

export function workflowCatalog(): string {
  const registry = workflowRegistryView()
  const profileLines = Object.entries(registry.profiles).flatMap(([name, profile]) => [
    `  profile:${name}`,
    ...profile.candidates.map(({ tool, model, effort }) => `    ${tool}:${model}@${effort}`)
  ])
  return [
    "Workflow model registry:",
    "Profiles:",
    ...profileLines,
    "Defaults:",
    `  orchestrator  ${registry.defaults.orchestrator}`,
    `  reviewer      ${registry.defaults.reviewer}`,
    `  implementer   ${registry.defaults.implementer}`,
    `  review        minimum score ${registry.defaults.review.minimum_score}; maximum rounds ${registry.defaults.review.max_rounds}`,
    `Exact targets: ${registry.exact_target_grammar}`,
    "Fast: append +fast to a Codex exact target. Without +fast, Codex roles use Standard.",
    "Compatibility: +fast requires a Docks consumer that supports workflow record schema 2.",
    "Availability: checked when used by Docks; docks-kit does not probe providers."
  ].join("\n")
}
