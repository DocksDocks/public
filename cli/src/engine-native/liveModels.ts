import { readFileSync } from "node:fs";

import { capture, p, which } from "./exec";
import { LEGACY_SELECTION, readHarnessSelection } from "./harnesses";
import { isObject, parseJson } from "./jq";
import { isNonBlankString, readCache, writeCache } from "./kitDb";
import { modelCatalog } from "./models";
import type { CatalogSource, CatalogTool, FetchLike, ResolvedCatalog } from "./sharedTypes";

export interface LiveCatalogInputs {
  readonly home: string;
  readonly refresh: boolean;
  readonly fetch: FetchLike;
  readonly which: (name: string) => string;
  readonly capture: (cmd: string, args: ReadonlyArray<string>) => Promise<string>;
  readonly now: () => number;
}

export const defaultLiveInputs = (home: string, refresh = false): LiveCatalogInputs => ({
  home,
  refresh,
  fetch: globalThis.fetch,
  which,
  capture,
  now: Date.now,
});

type LiveModel = ResolvedCatalog["models"][number];
type LiveLookup = {
  readonly source: Exclude<CatalogSource, "curated">;
  readonly fetchedAt?: string;
  readonly models: ReadonlyArray<LiveModel>;
};
type Lookup = LiveLookup | { readonly fallbackReason: string };

export function curatedCatalog(tool: CatalogTool): ResolvedCatalog {
  if (tool === "omp") return { tool, source: "curated", verified: "?", models: [] };
  return { tool, source: "curated", ...modelCatalog(tool) };
}

function mergeCurated(curated: ResolvedCatalog, live: ReadonlyArray<LiveModel>): Array<LiveModel> {
  const models: Array<LiveModel> = [];
  const notes = new Map<string, string>();
  for (const entry of curated.models) {
    if (entry.kind === "alias") models.push(entry);
    if (entry.note !== undefined) notes.set(entry.id, entry.note);
  }
  for (const entry of live) {
    const note = notes.get(entry.id) ?? entry.note;
    models.push(
      note === undefined ? { id: entry.id, kind: "id" } : { id: entry.id, kind: "id", note },
    );
  }
  return models;
}

export async function resolveCatalog(
  tool: CatalogTool,
  inputs: LiveCatalogInputs,
): Promise<ResolvedCatalog> {
  const curated = curatedCatalog(tool);
  if (!(readHarnessSelection(inputs.home) ?? LEGACY_SELECTION).includes(tool)) {
    return { ...curated, fallbackReason: `${tool} harness not enabled (docks-kit harnesses)` };
  }

  const lookup =
    tool === "claude"
      ? await claudeCatalog(inputs)
      : tool === "codex"
        ? codexCatalog(inputs.home)
        : await ompCatalog(inputs);
  if ("fallbackReason" in lookup) return { ...curated, fallbackReason: lookup.fallbackReason };
  return {
    ...curated,
    source: lookup.source,
    ...(lookup.fetchedAt === undefined ? {} : { fetchedAt: lookup.fetchedAt }),
    models: tool === "omp" ? lookup.models : mergeCurated(curated, lookup.models),
  };
}

const ANTHROPIC_CACHE_KEY = "models:anthropic";
const ANTHROPIC_CACHE_TTL = 6 * 3600_000;
const NO_CLAUDE_LOGIN = "no Claude Code login found in ~/.claude/.credentials.json";

function cachedClaudeCatalog(payload: string): LiveLookup | undefined {
  const cached = parseJson(payload);
  if (cached === undefined || !isObject(cached)) return undefined;
  const fetchedAt = cached["fetchedAt"];
  const ids = cached["ids"];
  if (typeof fetchedAt !== "string" || !Array.isArray(ids)) {
    return undefined;
  }
  if (!ids.every(isNonBlankString)) return undefined;
  const displayNames = cached["displayNames"];
  // Names align with ids; older cache rows contain ids only.
  const names =
    Array.isArray(displayNames) &&
    displayNames.length === ids.length &&
    displayNames.every((name) => name === null || isNonBlankString(name))
      ? displayNames
      : undefined;
  return {
    source: "anthropic-api",
    fetchedAt,
    models: ids.map((id, index) => {
      const name = names?.[index];
      return typeof name === "string" ? { id, kind: "id", note: name } : { id, kind: "id" };
    }),
  };
}

async function claudeCatalog(inputs: LiveCatalogInputs): Promise<Lookup> {
  if (!inputs.refresh) {
    const cached = readCache(inputs.home, ANTHROPIC_CACHE_KEY, ANTHROPIC_CACHE_TTL, inputs.now());
    if (cached !== undefined) {
      const catalog = cachedClaudeCatalog(cached);
      if (catalog !== undefined) return catalog;
    }
  }

  let credentialsText: string;
  try {
    credentialsText = readFileSync(p(inputs.home, ".claude", ".credentials.json"), "utf8");
  } catch {
    return { fallbackReason: NO_CLAUDE_LOGIN };
  }
  const credentials = parseJson(credentialsText);
  const oauth =
    credentials !== undefined && isObject(credentials) ? credentials["claudeAiOauth"] : undefined;
  if (oauth === undefined || !isObject(oauth)) return { fallbackReason: NO_CLAUDE_LOGIN };
  const token = oauth["accessToken"];
  const expiresAt = oauth["expiresAt"];
  if (!isNonBlankString(token) || typeof expiresAt !== "number" || !Number.isFinite(expiresAt)) {
    return { fallbackReason: NO_CLAUDE_LOGIN };
  }
  if (expiresAt <= inputs.now()) {
    return { fallbackReason: "Claude Code login expired; start claude once to refresh it" };
  }

  const models: Array<LiveModel> = [];
  let afterId: string | undefined;
  try {
    for (;;) {
      const url = `https://api.anthropic.com/v1/models?limit=1000${afterId === undefined ? "" : `&after_id=${encodeURIComponent(afterId)}`}`;
      const response = await inputs.fetch(url, {
        method: "GET",
        headers: {
          Authorization: `Bearer ${token}`,
          "anthropic-version": "2023-06-01",
          "anthropic-beta": "oauth-2025-04-20",
        },
        signal: AbortSignal.timeout(5000),
      });
      if (response.status !== 200) {
        return { fallbackReason: `Anthropic API returned HTTP ${response.status}` };
      }
      const page: unknown = await response.json();
      if (typeof page !== "object" || page === null || Array.isArray(page)) {
        throw new Error("invalid response");
      }
      if (
        !("data" in page) ||
        !Array.isArray(page.data) ||
        !("has_more" in page) ||
        typeof page.has_more !== "boolean"
      ) {
        throw new Error("invalid response");
      }
      for (const row of page.data) {
        if (typeof row !== "object" || row === null || Array.isArray(row) || !("id" in row))
          continue;
        const id = row.id;
        if (!isNonBlankString(id)) continue;
        const name = "display_name" in row ? row.display_name : undefined;
        models.push(isNonBlankString(name) ? { id, kind: "id", note: name } : { id, kind: "id" });
      }
      if (!page.has_more) break;
      const lastId = "last_id" in page ? page.last_id : undefined;
      if (!isNonBlankString(lastId) || lastId === afterId) throw new Error("invalid response");
      afterId = lastId;
    }
  } catch (error) {
    return {
      fallbackReason: `Anthropic API unreachable: ${error instanceof Error ? error.message : String(error)}`,
    };
  }

  // An empty list would drop every curated id; never cache it.
  if (models.length === 0) return { fallbackReason: "Anthropic API returned no models" };
  const fetched = inputs.now();
  const fetchedAt = new Date(fetched).toISOString();
  writeCache(
    inputs.home,
    ANTHROPIC_CACHE_KEY,
    JSON.stringify({
      fetchedAt,
      ids: models.map((model) => model.id),
      displayNames: models.map((model) => model.note ?? null),
    }),
    fetched,
  );
  return { source: "anthropic-api", fetchedAt, models };
}

const NO_CODEX_CACHE = "no Codex model cache (~/.codex/models_cache.json); run codex once";
const UNREADABLE_CODEX_CACHE = "Codex model cache is unreadable";

function codexCatalog(home: string): Lookup {
  let text: string;
  try {
    text = readFileSync(p(home, ".codex", "models_cache.json"), "utf8");
  } catch (error) {
    const missing =
      typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
    return { fallbackReason: missing ? NO_CODEX_CACHE : UNREADABLE_CODEX_CACHE };
  }
  const cache = parseJson(text);
  if (cache === undefined || !isObject(cache) || !Array.isArray(cache["models"])) {
    return { fallbackReason: UNREADABLE_CODEX_CACHE };
  }
  const models: Array<LiveModel> = [];
  for (const row of cache["models"]) {
    if (!isObject(row) || row["visibility"] !== "list") continue;
    const id = row["slug"];
    if (!isNonBlankString(id)) continue;
    const name = row["display_name"];
    models.push(isNonBlankString(name) ? { id, kind: "id", note: name } : { id, kind: "id" });
  }
  if (models.length === 0) return { fallbackReason: "Codex model cache lists no models" };
  const fetchedAt = cache["fetched_at"];
  return {
    source: "codex-cache",
    ...(typeof fetchedAt === "string" ? { fetchedAt } : {}),
    models,
  };
}

const NO_OMP_CATALOG = "'omp models --json' returned no usable catalog";

async function ompCatalog(inputs: LiveCatalogInputs): Promise<Lookup> {
  const omp = inputs.which("omp");
  if (omp === "") return { fallbackReason: "omp not found on PATH" };
  let raw: string;
  try {
    raw = await inputs.capture(omp, ["models", "--json"]);
  } catch {
    return { fallbackReason: NO_OMP_CATALOG };
  }
  const catalog = parseJson(raw);
  if (catalog === undefined || !isObject(catalog) || !Array.isArray(catalog["models"])) {
    return { fallbackReason: NO_OMP_CATALOG };
  }
  const models: Array<LiveModel> = [];
  for (const row of catalog["models"]) {
    if (!isObject(row) || row["kind"] !== "chat") continue;
    const id = row["selector"];
    if (!isNonBlankString(id)) continue;
    const name = row["name"];
    models.push(isNonBlankString(name) ? { id, kind: "id", note: name } : { id, kind: "id" });
  }
  if (models.length === 0) return { fallbackReason: NO_OMP_CATALOG };
  return { source: "omp-cli", fetchedAt: new Date(inputs.now()).toISOString(), models };
}
