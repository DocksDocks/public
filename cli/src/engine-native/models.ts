/**
 * Model-catalog helpers: manifest listing plus Claude/Codex model validation.
 * Message strings are covered by the golden suites.
 */
import type { Ctx } from "./index"
import { isObject, parseJson, type Json } from "./jq"
import { payloadDisplayPath, payloadText } from "../payload"

function catalog(): Json | undefined {
  try {
    return parseJson(payloadText("SoT/models.json"))
  } catch {
    return undefined
  }
}

function toolEntry(tool: string): { [k: string]: Json } | undefined {
  const doc = catalog()
  if (doc === undefined || !isObject(doc)) return undefined
  const entry = doc[tool]
  return entry !== undefined && isObject(entry) ? entry : undefined
}

function modelEntries(tool: string): Array<{ [k: string]: Json }> {
  const entry = toolEntry(tool)
  const models = entry?.["models"]
  return Array.isArray(models) ? models.filter(isObject) : []
}

export function modelsFromManifest(tool: string): Array<string> {
  return modelEntries(tool)
    .map((m) => m["id"])
    .filter((id): id is string => typeof id === "string")
}

export function printModels(ctx: Ctx, tool: string): void {
  const { echo, warn } = ctx.services.logger
  const entry = toolEntry(tool)
  if (entry === undefined) {
    warn(`Model catalog unavailable (${payloadDisplayPath("SoT/models.json", ctx.repoDir)})`)
    return
  }
  const verified = typeof entry["verified"] === "string" ? entry["verified"] : "?"
  const lines = [`Available ${tool} models (kit-verified ${verified} — SoT/models.json):`]
  for (const m of modelEntries(tool)) {
    const note = typeof m["note"] === "string" ? `  — ${m["note"]}` : ""
    lines.push(`  ${String(m["id"] ?? "")}${note}`)
  }
  if (tool === "claude") lines.push("  (full claude-* model IDs outside the catalog are accepted with a warning)")
  if (tool === "codex") lines.push("  (well-formed IDs outside the catalog are accepted with a warning)")
  for (const line of lines) echo(line)
}

export function validateClaudeModel(ctx: Ctx, m: string): boolean {
  if (m === "") return false
  if (modelsFromManifest("claude").includes(m)) return true
  if (m.startsWith("claude-")) {
    ctx.services.logger.warn(`Claude model '${m}' is not in the kit-verified catalog (SoT/models.json) — applying anyway`)
    return true
  }
  return false
}

export function validateCodexModel(ctx: Ctx, m: string): boolean {
  if (!/^[A-Za-z0-9._-]+$/.test(m)) return false
  if (!modelsFromManifest("codex").includes(m)) {
    ctx.services.logger.warn(
      `Codex model '${m}' is not in the kit-verified catalog (SoT/models.json) — applying anyway (check ~/.codex/config.toml if Codex rejects it)`
    )
  }
  return true
}
