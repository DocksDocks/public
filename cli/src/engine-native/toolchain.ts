/**
 * Verified-version-floor layer over SoT/toolchain.json. Probe commands spawn
 * deterministic argv arrays and are covered by golden regression cases.
 */
import type { ToolId } from "./deps";
import type { Ctx } from "./index";
import { compareCodepoints, isObject, parseJson } from "./jq";
import { payloadText } from "../payload";
import { hostOs } from "./os";
import { readCache, writeCache } from "./kitDb";
import type { FetchLike, JsonObject } from "./sharedTypes";

function manifest(): JsonObject {
  const doc = parseJson(payloadText("SoT/toolchain.json"));
  const tools = doc !== undefined && isObject(doc) ? doc["tools"] : undefined;
  return tools !== undefined && isObject(tools) ? tools : {};
}

export function field(tool: string, name: string): string {
  const entry = manifest()[tool];
  if (entry === undefined || !isObject(entry)) return "";
  const v = entry[name];
  return v === undefined || v === null ? "" : String(v);
}

/** toolchain::_is_newer — numeric per dotted field, GNU-sort last-resort tie-break. */
export function isNewer(a: string, b: string): boolean {
  if (a === "" || b === "" || a === b) return false;
  const fa = a.split(".");
  const fb = b.split(".");
  for (let i = 0; i < 3; i++) {
    const na = parseInt(fa[i] ?? "", 10) || 0;
    const nb = parseInt(fb[i] ?? "", 10) || 0;
    if (na !== nb) return na > nb;
  }
  return compareCodepoints(a, b) > 0;
}

/**
 * A readable installed version strictly older than the manifest floor. The
 * doctor row and the LSP install gate must agree on that judgement, so both
 * ask here rather than re-deriving it.
 */
export function belowFloor(installed: string, floor: string): boolean {
  return installed !== "" && floor !== "" && isNewer(floor, installed);
}

export function present(ctx: Ctx, tool: ToolId): boolean {
  return ctx.services.deps.probe(tool).state === "present";
}

function firstLineField(out: string, index: number): string {
  const fields = (out.split("\n")[0] ?? "").trim().split(/[ \t]+/);
  return fields[index === -1 ? fields.length - 1 : index] ?? "";
}

export async function installedVersion(ctx: Ctx, tool: ToolId): Promise<string> {
  const version = () => ctx.services.deps.version(tool);
  switch (tool) {
    case "claude":
      return firstLineField(await version(), 0);
    case "codex":
      return firstLineField(await version(), -1);
    case "git":
      return firstLineField(await version(), 2);
    case "node":
      return (await version()).replace(/^v/, "");
    case "jq":
      return (await version()).replace(/^jq-/, "");
    case "curl":
    case "tsc":
    // `rust-analyzer --version` prints "rust-analyzer <version>", where the
    // version tail also carries a commit and a date in parentheses.
    case "rust-analyzer":
      return firstLineField(await version(), 1);
    case "bun":
    case "omp":
    case "npm":
      return await version();
    case "bwrap":
      return firstLineField(await version(), 1);
    case "ffplay":
      return firstLineField(await version(), 2).replace(/-.*$/, "");
    case "intelephense":
    case "typescript-language-server":
      return (await version()).trim();
    default:
      return "";
  }
}

function row(cells: [string, string, string, string, string, string]): string {
  const widths = [28, 9, 14, 9, 9];
  return cells.map((c, i) => (i < widths.length ? c.padEnd(widths[i]!) : c)).join(" ");
}

export async function report(ctx: Ctx): Promise<void> {
  const { echo } = ctx.services.logger;
  echo(row(["TOOL", "KIND", "INSTALLED", "FLOOR", "VERIFIED", "STATUS"]));
  const pn = ctx.services.platform.name();
  const platformOs = hostOs(pn).toolchainOs;
  for (const tool of Object.keys(manifest()).sort(compareCodepoints)) {
    const os = field(tool, "os");
    if (os !== "" && platformOs !== "" && os !== platformOs) continue;
    const kind = field(tool, "kind");
    const floor = field(tool, "floor");
    const verified = field(tool, "verified");
    const dash = (v: string): string => (v !== "" ? v : "-");
    if (kind === "pin") {
      const via = field(tool, "via");
      echo(
        row([tool, kind, `(${via !== "" ? via : "npx"})`, dash(floor), dash(verified), "pinned"]),
      );
      continue;
    }
    let installed: string;
    let status: string;
    const toolId = tool as ToolId;
    if (present(ctx, toolId)) {
      installed = await installedVersion(ctx, toolId);
      status = installed === "" ? "unknown" : "ok";
      if (belowFloor(installed, floor)) {
        status = "below-floor";
      } else if (verified !== "" && installed !== "" && isNewer(installed, verified)) {
        status = "above-verified";
      }
      installed = installed !== "" ? installed : "?";
    } else {
      installed = "-";
      status = "missing";
    }
    echo(row([tool, dash(kind), installed, dash(floor), dash(verified), status]));
  }
}

export type UpstreamResult = { ok: true; version: string } | { ok: false; reason: string };

export interface UpstreamInputs {
  readonly home: string;
  readonly refresh: boolean;
  readonly now: number;
  readonly fetchImpl?: FetchLike;
  readonly env?: NodeJS.ProcessEnv;
}

const UPSTREAM_CACHE_MS = 24 * 3600_000;

function upstreamSpec(tool: string): JsonObject | undefined {
  const entry = manifest()[tool];
  const upstream = entry !== undefined && isObject(entry) ? entry["upstream"] : undefined;
  return upstream !== undefined && isObject(upstream) ? upstream : undefined;
}

function upstreamLabel(spec: JsonObject): string {
  const { npm, github, line } = spec;
  if (typeof npm === "string")
    return typeof line === "string" ? `npm ${npm} (${line}.x)` : `npm ${npm}`;
  return typeof github === "string" ? `github ${github}` : "-";
}

async function fetchJson(
  fetchImpl: FetchLike,
  url: string,
  headers: Record<string, string>,
): Promise<{ ok: true; body: JsonObject } | { ok: false; reason: string }> {
  const response = await fetchImpl(url, { headers, signal: AbortSignal.timeout(8000) });
  if (response.status !== 200) return { ok: false, reason: `HTTP ${response.status}` };
  const body = parseJson(await response.text());
  return body !== undefined && isObject(body)
    ? { ok: true, body }
    : { ok: false, reason: "invalid response" };
}

async function lookupUpstream(
  spec: JsonObject,
  fetchImpl: FetchLike,
  env: NodeJS.ProcessEnv,
): Promise<UpstreamResult> {
  const { npm, line, github, tagPrefix } = spec;
  if (typeof npm === "string" && typeof line === "string") {
    // The registry rejects ranges, so read the packument and pick the newest release on the line.
    const result = await fetchJson(fetchImpl, `https://registry.npmjs.org/${npm}`, {
      Accept: "application/vnd.npm.install-v1+json",
    });
    if (!result.ok) return result;
    const versions = result.body["versions"];
    if (versions === undefined || !isObject(versions))
      return { ok: false, reason: "invalid response" };
    if (!/^\d+$/.test(line)) return { ok: false, reason: `invalid line ${line}` };
    const pattern = new RegExp(`^${line}\\.\\d+\\.\\d+$`);
    let newest = "";
    for (const version of Object.keys(versions)) {
      if (pattern.test(version) && (newest === "" || isNewer(version, newest))) newest = version;
    }
    return newest === ""
      ? { ok: false, reason: `no ${line}.x release` }
      : { ok: true, version: newest };
  }
  if (typeof npm === "string") {
    const result = await fetchJson(fetchImpl, `https://registry.npmjs.org/${npm}/latest`, {
      Accept: "application/json",
    });
    if (!result.ok) return result;
    const version = result.body["version"];
    return typeof version === "string" && version !== ""
      ? { ok: true, version }
      : { ok: false, reason: "invalid response" };
  }
  if (typeof github === "string") {
    const headers: Record<string, string> = {
      Accept: "application/vnd.github+json",
      "User-Agent": "docks-kit",
    };
    const token = env["GITHUB_TOKEN"] || env["GH_TOKEN"];
    if (token !== undefined && token !== "") headers["Authorization"] = `Bearer ${token}`;
    const result = await fetchJson(
      fetchImpl,
      `https://api.github.com/repos/${github}/releases/latest`,
      headers,
    );
    if (!result.ok) return result;
    const tag = result.body["tag_name"];
    if (typeof tag !== "string") return { ok: false, reason: "invalid response" };
    const prefix = typeof tagPrefix === "string" ? tagPrefix : "";
    return tag.startsWith(prefix)
      ? { ok: true, version: tag.slice(prefix.length) }
      : { ok: false, reason: `unexpected tag ${tag}` };
  }
  return { ok: false, reason: "no upstream in SoT/toolchain.json" };
}

/** Newest upstream release for one manifest tool; successes cache 24 h in kit.db. */
export async function latestUpstream(
  tool: string,
  inputs: UpstreamInputs,
): Promise<UpstreamResult> {
  const { home, refresh, now, fetchImpl = globalThis.fetch, env = process.env } = inputs;
  const key = `upstream:${tool}`;
  if (!refresh) {
    const cached = readCache(home, key, UPSTREAM_CACHE_MS, now);
    if (cached !== undefined) return { ok: true, version: cached };
  }
  const spec = upstreamSpec(tool);
  if (spec === undefined) return { ok: false, reason: "no upstream in SoT/toolchain.json" };
  let result: UpstreamResult;
  try {
    result = await lookupUpstream(spec, fetchImpl, env);
  } catch (error) {
    result = { ok: false, reason: error instanceof Error ? error.message : String(error) };
  }
  if (result.ok) writeCache(home, key, result.version, now);
  return result;
}

/** Compare each verified pin with the newest upstream release. Report only. */
export async function outdatedReport(
  ctx: Ctx,
  options: { readonly refresh: boolean; readonly fetchImpl?: FetchLike },
): Promise<number> {
  const { echo } = ctx.services.logger;
  const tools = Object.keys(manifest()).filter(
    (tool) => field(tool, "verified") !== "" && upstreamSpec(tool) !== undefined,
  );
  const now = Date.now();
  const results = await Promise.all(
    tools.map((tool) =>
      latestUpstream(tool, {
        home: ctx.home,
        refresh: options.refresh,
        now,
        ...(options.fetchImpl !== undefined ? { fetchImpl: options.fetchImpl } : {}),
      }),
    ),
  );
  echo(row(["TOOL", "KIND", "VERIFIED", "LATEST", "STATUS", "UPSTREAM"]));
  tools.forEach((tool, index) => {
    const verified = field(tool, "verified");
    const result = results[index]!;
    let latest = "-";
    let status: string;
    if (result.ok) {
      latest = result.version;
      status = isNewer(latest, verified) ? "newer" : "current";
    } else {
      status = `lookup failed: ${result.reason}`;
    }
    const label = upstreamLabel(upstreamSpec(tool) ?? {});
    echo(row([tool, field(tool, "kind"), verified, latest, status, label]));
  });
  echo("Report only: update a verified pin after testing that release (SoT/toolchain.json).");
  return 0;
}
