/**
 * Model-catalog helpers: SoT parsing, listing, and Claude/Codex model validation.
 * Curated message strings are covered by the golden suites.
 */
import type { Ctx } from "./index";
import { isObject, parseJson } from "./jq";
import { payloadDisplayPath, payloadText } from "../payload";
import type { CatalogSource, JsonObject, ResolvedCatalog } from "./sharedTypes";

export type ModelEntry = ResolvedCatalog["models"][number];

export interface ModelCatalog {
  readonly verified: string;
  readonly models: ReadonlyArray<ModelEntry>;
}

const LIVE_SOURCE_LABELS: Record<Exclude<CatalogSource, "curated">, string> = {
  "anthropic-api": "Anthropic API via Claude Code login",
  "codex-cache": "~/.codex/models_cache.json",
  "omp-cli": "omp models --json",
};

function toolEntry(tool: string): JsonObject | undefined {
  const doc = parseJson(payloadText("SoT/models.json"));
  if (doc === undefined || !isObject(doc)) return undefined;
  const entry = doc[tool];
  return entry !== undefined && isObject(entry) ? entry : undefined;
}

function modelEntries(entry: JsonObject | undefined): Array<JsonObject> {
  const models = entry?.["models"];
  return Array.isArray(models) ? models.filter(isObject) : [];
}

/**
 * Typed view of one tool's `SoT/models.json` section. An entry whose `id` is not a
 * string or whose `kind` is neither `alias` nor `id` is skipped; a missing section
 * yields `verified: "?"` and no models.
 */
export function modelCatalog(tool: string): ModelCatalog {
  const entry = toolEntry(tool);
  const verified = entry?.["verified"];
  const models: Array<ModelEntry> = [];
  for (const m of modelEntries(entry)) {
    const id = m["id"];
    const kind = m["kind"];
    if (typeof id !== "string" || (kind !== "alias" && kind !== "id")) continue;
    const note = m["note"];
    models.push(typeof note === "string" ? { id, kind, note } : { id, kind });
  }
  return { verified: typeof verified === "string" ? verified : "?", models };
}

export function printModels(ctx: Ctx, catalog: ResolvedCatalog): void {
  const { echo, warn } = ctx.services.logger;
  const { tool, models, source, verified, fetchedAt } = catalog;
  if (source === "curated" && models.length === 0) {
    warn(`Model catalog unavailable (${payloadDisplayPath("SoT/models.json")})`);
    return;
  }
  const header =
    source === "curated"
      ? `Available ${tool} models (kit-verified ${verified} — SoT/models.json):`
      : `Available ${tool} models (live — ${LIVE_SOURCE_LABELS[source]}, fetched ${fetchedAt ?? "?"}; aliases and notes from SoT/models.json):`;
  echo(header);
  for (const model of models) {
    echo(`  ${model.id}${model.note === undefined ? "" : `  — ${model.note}`}`);
  }
  if (tool === "claude")
    echo("  (full claude-* model IDs outside the catalog are accepted with a warning)");
  if (tool === "codex") echo("  (well-formed IDs outside the catalog are accepted with a warning)");
}

export function validateClaudeModel(ctx: Ctx, m: string, catalog: ResolvedCatalog): boolean {
  if (m === "") return false;
  if (catalog.models.some((entry) => entry.id === m)) return true;
  if (m.startsWith("claude-")) {
    ctx.services.logger.warn(
      catalog.source === "curated"
        ? `Claude model '${m}' is not in the kit-verified catalog (SoT/models.json) — applying anyway`
        : `Claude model '${m}' is not in the live Anthropic model list — applying anyway`,
    );
    return true;
  }
  return false;
}

export function validateCodexModel(ctx: Ctx, m: string, catalog: ResolvedCatalog): boolean {
  if (!/^[A-Za-z0-9._-]+$/.test(m)) return false;
  if (!catalog.models.some((entry) => entry.id === m)) {
    ctx.services.logger.warn(
      catalog.source === "curated"
        ? `Codex model '${m}' is not in the kit-verified catalog (SoT/models.json) — applying anyway (check ~/.codex/config.toml if Codex rejects it)`
        : `Codex model '${m}' is not in the live Codex model list — applying anyway (check ~/.codex/config.toml if Codex rejects it)`,
    );
  }
  return true;
}
