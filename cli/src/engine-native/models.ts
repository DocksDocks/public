/**
 * Model-catalog helpers: manifest listing plus Claude/Codex model validation.
 * Message strings are covered by the golden suites.
 */
import type { Ctx } from "./index"
import { isObject, parseJson, type Json } from "./jq"
import { payloadDisplayPath, payloadText } from "../payload"

export interface ModelEntry {
  readonly id: string
  readonly kind: "alias" | "id"
  readonly note?: string
}

export interface ModelCatalog {
  readonly verified: string
  readonly models: ReadonlyArray<ModelEntry>
}

function toolEntry(tool: string): { [k: string]: Json } | undefined {
  const doc = parseJson(payloadText("SoT/models.json"))
  if (doc === undefined || !isObject(doc)) return undefined
  const entry = doc[tool]
  return entry !== undefined && isObject(entry) ? entry : undefined
}

function modelEntries(entry: { [k: string]: Json } | undefined): Array<{ [k: string]: Json }> {
  const models = entry?.["models"]
  return Array.isArray(models) ? models.filter(isObject) : []
}

/**
 * Typed view of one tool's `SoT/models.json` section. An entry whose `id` is not a
 * string or whose `kind` is neither `alias` nor `id` is skipped; a missing section
 * yields `verified: "?"` and no models.
 */
export function modelCatalog(tool: string): ModelCatalog {
  const entry = toolEntry(tool)
  const verified = entry?.["verified"]
  const models: Array<ModelEntry> = []
  for (const m of modelEntries(entry)) {
    const id = m["id"]
    const kind = m["kind"]
    if (typeof id !== "string" || (kind !== "alias" && kind !== "id")) continue
    const note = m["note"]
    models.push(typeof note === "string" ? { id, kind, note } : { id, kind })
  }
  return { verified: typeof verified === "string" ? verified : "?", models }
}

export function printModels(ctx: Ctx, tool: string): void {
  const { echo, warn } = ctx.services.logger
  const entry = toolEntry(tool)
  if (entry === undefined) {
    warn(`Model catalog unavailable (${payloadDisplayPath("SoT/models.json")})`)
    return
  }
  const verified = typeof entry["verified"] === "string" ? entry["verified"] : "?"
  const lines = [`Available ${tool} models (kit-verified ${verified} — SoT/models.json):`]
  for (const m of modelEntries(entry)) {
    const note = typeof m["note"] === "string" ? `  — ${m["note"]}` : ""
    lines.push(`  ${String(m["id"] ?? "")}${note}`)
  }
  if (tool === "claude") lines.push("  (full claude-* model IDs outside the catalog are accepted with a warning)")
  if (tool === "codex") lines.push("  (well-formed IDs outside the catalog are accepted with a warning)")
  for (const line of lines) echo(line)
}

export function validateClaudeModel(ctx: Ctx, m: string): boolean {
  if (m === "") return false
  if (modelCatalog("claude").models.some((entry) => entry.id === m)) return true
  if (m.startsWith("claude-")) {
    ctx.services.logger.warn(`Claude model '${m}' is not in the kit-verified catalog (SoT/models.json) — applying anyway`)
    return true
  }
  return false
}

export function validateCodexModel(ctx: Ctx, m: string): boolean {
  if (!/^[A-Za-z0-9._-]+$/.test(m)) return false
  if (!modelCatalog("codex").models.some((entry) => entry.id === m)) {
    ctx.services.logger.warn(
      `Codex model '${m}' is not in the kit-verified catalog (SoT/models.json) — applying anyway (check ~/.codex/config.toml if Codex rejects it)`
    )
  }
  return true
}
