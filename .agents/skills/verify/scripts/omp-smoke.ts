#!/usr/bin/env bun
/**
 * Smoke test of the docks-kit kit plugin (`SoT/.omp/plugin`) in the real omp, for verify flow V6.
 *
 * The script links the plugin folder of this checkout into isolated omp state in a docks-kit scratch
 * folder, runs the command, and removes the folder. It uses a fake local OpenAI-compatible model, so no
 * real model credential is used.
 *
 * Commands:
 *   (default)  Read what omp loads: the linked package, the skills, the task-tool agents, and the warnings.
 *   hooks      Drive the verify-gate and context-tree-nudge extensions in `omp -p` sessions in a scratch git
 *              repository. The fake model plays scripted tool calls. Prints `ok <name>` or
 *              `FAIL <name>: <reason>` for each check.
 *
 * Usage: bun .agents/skills/verify/scripts/omp-smoke.ts [hooks] [--repo <path>]
 */

import { type ChildProcessByStdio, spawn, spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { createServer, type Server } from "node:http";
import { homedir } from "node:os";
import { dirname, join, resolve, sep } from "node:path";
import type { Readable } from "node:stream";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

/** The `name` of the kit plugin package, and of its npm row in `omp plugin list --json`. */
const PACKAGE_NAME = "docks-kit-omp";
/** The kit plugin folder, relative to the repository root. */
const PLUGIN_DIR = "SoT/.omp/plugin";
/** The 32 skills moved from DocksDocks/docks and `workspace-hygiene`. */
const EXPECTED_SKILLS = 33;
const REQUIRED_AGENTS = ["code-reviewer", "plan-reviewer"];
const COMMAND_TIMEOUT_MS = 120_000;
const MODEL_PROVIDER = "omp-smoke";
const MODEL_ID = "smoke-model";
const SESSION_PROMPT = "Reply with ok.";
const SCRIPTED_PROMPT = "Do the scripted steps.";
const SCRATCH_LABEL = "omp-smoke";
/** The config root name under the scratch home. omp joins PI_CONFIG_DIR to the home folder. */
const CONFIG_DIR_NAME = ".omp-smoke";
/** The sweep stamp of `hygiene.ts`, under `<home>/.cache/docks-kit`. A fresh stamp keeps the sweep from starting. */
const SWEEP_STAMP = ["docks-kit", "tidy.stamp"];
/** Registry files of the real omp state; the smoke run must not touch them. */
const REAL_REGISTRY_FILES = [
  "marketplaces.json",
  "plugins/installed_plugins.json",
  "plugins/omp-plugins.lock.json",
  "plugins/package.json",
];
/**
 * The real user log of the verify-gate. Other omp sessions can add lines to it during a smoke run;
 * a new line with a `cwd` inside the smoke scratch folder shows that the smoke run wrote to it.
 */
const REAL_GATE_LOG = join(
  process.env["XDG_STATE_HOME"] || join(homedir(), ".local", "state"),
  "docks",
  "verify-gate.jsonl",
);
const COMMANDS = ["hooks"];

// ---------- JSON narrowing ----------

type Json = null | boolean | number | string | Json[] | JsonObject;
interface JsonObject {
  [key: string]: Json;
}

function isObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function objects(value: unknown): JsonObject[] {
  return Array.isArray(value) ? value.filter(isObject) : [];
}

function text(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function parseJsonText(source: string): Json | undefined {
  try {
    const parsed: Json = JSON.parse(source);
    return parsed;
  } catch {
    return undefined;
  }
}

// ---------- arguments ----------

const { values: args, positionals } = parseArgs({
  options: { repo: { type: "string" }, help: { type: "boolean", short: "h" } },
  allowPositionals: true,
  strict: true,
});
const command = positionals[0] ?? null;
if (
  args.help === true ||
  positionals.length > 1 ||
  (command !== null && !COMMANDS.includes(command))
) {
  console.log("usage: omp-smoke.ts [hooks] [--repo <path>]");
  process.exit(args.help === true ? 0 : 2);
}
// omp resolves the home folder from HOME only on Linux and macOS. On Windows the scratch home would not
// isolate the kit extensions, so the script refuses to run there.
if (process.platform === "win32") {
  console.log("FAIL omp-smoke.ts runs on Linux and macOS only");
  process.exit(2);
}
const scriptDir = dirname(fileURLToPath(import.meta.url));
const repo = resolve(args.repo ?? join(scriptDir, "../../../.."));
const pluginDir = join(repo, PLUGIN_DIR);

// ---------- process and scratch lifecycle ----------

type Child = ChildProcessByStdio<null, Readable, Readable>;
const children = new Set<Child>();
let scratch: string | null = null;
let server: Server | null = null;

/**
 * Stops children and the fake model, and removes the scratch folder.
 * Returns the path of a scratch folder that it could not remove, else null.
 */
function cleanup(): string | null {
  for (const child of children) child.kill("SIGKILL");
  children.clear();
  server?.closeAllConnections();
  server?.close();
  server = null;
  if (scratch === null) return null;
  const path = scratch;
  scratch = null;
  const result = spawnSync("docks-kit", ["scratch", "remove", path], { encoding: "utf8" });
  if (result.status === 0 && !existsSync(path)) return null;
  const detail = (result.stderr || String(result.error ?? "")).trim();
  if (detail) console.error(detail);
  return path;
}

function reportCleanup(): boolean {
  const kept = cleanup();
  if (kept !== null) console.log(`FAIL could not remove scratch folder ${kept}`);
  return kept === null;
}

for (const [signal, code] of [
  ["SIGINT", 130],
  ["SIGTERM", 143],
] as const) {
  process.on(signal, () => {
    reportCleanup();
    process.exit(code);
  });
}

function createScratch(): string {
  const result = spawnSync("docks-kit", ["scratch", "new", SCRATCH_LABEL], { encoding: "utf8" });
  const path = result.stdout?.trim().split("\n").pop();
  if (result.status !== 0 || !path || !existsSync(path)) {
    throw new Error(`docks-kit scratch new failed: ${result.stderr || String(result.error ?? "")}`);
  }
  return path;
}

/** The isolated folders of one run, all inside the scratch folder. */
interface Isolation {
  /** The home folder of omp: the kit extensions resolve `~/.cache/docks-kit` here. */
  readonly home: string;
  /** The omp config root, `<home>/<PI_CONFIG_DIR>`. */
  readonly stateDir: string;
  readonly stateHome: string;
  readonly tmpDir: string;
}

/**
 * Environment for omp: only the allowed parent variables, so no omp session variable, no docks variable,
 * and no credential reaches omp. HOME is the scratch home, so the kit extensions (`hygiene.ts`) read and write
 * their `~/.cache/docks-kit` files there; PI_CONFIG_DIR names the isolated config root under it; XDG_STATE_HOME
 * is a scratch folder, so the verify-gate writes no line into the user log; TMPDIR is a scratch folder.
 */
const ENV_ALLOWLIST = ["PATH", "USER", "LANG", "TERM"];
function isolatedEnv(isolation: Isolation): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined && (ENV_ALLOWLIST.includes(key) || key.startsWith("LC_")))
      env[key] = value;
  }
  env["HOME"] = isolation.home;
  env["PI_CONFIG_DIR"] = CONFIG_DIR_NAME;
  env["XDG_STATE_HOME"] = isolation.stateHome;
  env["TMPDIR"] = isolation.tmpDir;
  return env;
}

interface OmpResult {
  readonly argv: readonly string[];
  readonly code: number | "timeout" | null;
  readonly stdout: string;
  readonly stderr: string;
}

function runOmp(
  argv: readonly string[],
  cwd: string,
  env: Record<string, string>,
): Promise<OmpResult> {
  const { promise, resolve: done } = Promise.withResolvers<OmpResult>();
  const child = spawn("omp", argv, { cwd, env, stdio: ["ignore", "pipe", "pipe"] });
  children.add(child);
  let stdout = "";
  let stderr = "";
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    child.kill("SIGKILL");
  }, COMMAND_TIMEOUT_MS);
  child.stdout.on("data", (chunk: Buffer) => {
    stdout += chunk.toString("utf8");
  });
  child.stderr.on("data", (chunk: Buffer) => {
    stderr += chunk.toString("utf8");
  });
  child.on("error", (error) => {
    stderr += String(error);
  });
  child.on("close", (code) => {
    clearTimeout(timer);
    children.delete(child);
    done({ argv, code: timedOut ? "timeout" : code, stdout, stderr });
  });
  return promise;
}

// ---------- fake model ----------

interface ToolCall {
  readonly id: string;
  readonly name: string;
  readonly arguments: Readonly<Record<string, string>>;
}
type Turn = readonly ToolCall[] | ((request: JsonObject) => readonly ToolCall[]);
interface Script {
  turns: readonly Turn[];
}

function sseChunk(model: Json, choice: JsonObject, extra: JsonObject = {}): string {
  return `data: ${JSON.stringify({ id: "omp-smoke", object: "chat.completion.chunk", created: 0, model, choices: [choice], ...extra })}\n\n`;
}

/**
 * The tool calls of the scripted turn for one request, or null for a plain "ok" answer.
 * `script.turns[n]` answers a request that holds n assistant messages.
 */
function scriptedCalls(script: Script, request: JsonObject): readonly ToolCall[] | null {
  const index = objects(request["messages"]).filter(
    (message) => message["role"] === "assistant",
  ).length;
  const turn = script.turns[index];
  const calls = typeof turn === "function" ? turn(request) : turn;
  return calls !== undefined && calls.length > 0 ? calls : null;
}

/** Fake OpenAI-compatible model: records each request body and answers with the scripted tool calls, else with "ok" and a stop. */
function startFakeModel(requests: JsonObject[], script: Script): Promise<Server> {
  const fake = createServer((req, res) => {
    let body = "";
    req.on("data", (chunk: Buffer) => {
      body += chunk.toString("utf8");
    });
    req.on("end", () => {
      if (req.method !== "POST" || req.url?.endsWith("/chat/completions") !== true) {
        res.writeHead(404).end();
        return;
      }
      const parsed = parseJsonText(body);
      if (!isObject(parsed)) {
        res.writeHead(400).end();
        return;
      }
      requests.push(parsed);
      const model = parsed["model"] ?? null;
      const usage = { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 };
      if (parsed["stream"] === true) {
        res.writeHead(200, { "content-type": "text/event-stream" });
        const calls = scriptedCalls(script, parsed);
        if (calls) {
          const toolCalls = calls.map((call, index) => ({
            index,
            id: call.id,
            type: "function",
            function: { name: call.name, arguments: JSON.stringify(call.arguments) },
          }));
          res.write(
            sseChunk(model, {
              index: 0,
              delta: { role: "assistant", tool_calls: toolCalls },
              finish_reason: null,
            }),
          );
          res.write(
            sseChunk(model, { index: 0, delta: {}, finish_reason: "tool_calls" }, { usage }),
          );
        } else {
          res.write(
            sseChunk(model, {
              index: 0,
              delta: { role: "assistant", content: "ok" },
              finish_reason: null,
            }),
          );
          res.write(sseChunk(model, { index: 0, delta: {}, finish_reason: "stop" }, { usage }));
        }
        res.end("data: [DONE]\n\n");
        return;
      }
      res.writeHead(200, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          id: "omp-smoke",
          object: "chat.completion",
          created: 0,
          model,
          choices: [
            { index: 0, message: { role: "assistant", content: "ok" }, finish_reason: "stop" },
          ],
          usage,
        }),
      );
    });
  });
  const { promise, resolve: ready, reject: fail } = Promise.withResolvers<Server>();
  fake.once("error", fail);
  fake.listen(0, "127.0.0.1", () => ready(fake));
  return promise;
}

function modelsYaml(port: number): string {
  return [
    "providers:",
    `  ${MODEL_PROVIDER}:`,
    `    baseUrl: http://127.0.0.1:${port}/v1`,
    "    api: openai-completions",
    "    auth: none",
    "    models:",
    `      - id: ${MODEL_ID}`,
    "        name: omp smoke fake model",
    "        reasoning: false",
    "        input: [text]",
    "        contextWindow: 128000",
    "        maxTokens: 4096",
    "        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }",
    "",
  ].join("\n");
}

// ---------- real state ----------

function mtimeOf(file: string): number | null {
  return existsSync(file) ? statSync(file).mtimeMs : null;
}

/** The real omp roots that can hold the registry: the config root, and the XDG data root when one is set. */
function realRegistryRoots(): string[] {
  const roots = [join(homedir(), process.env["PI_CONFIG_DIR"] || ".omp")];
  const dataHome = process.env["XDG_DATA_HOME"];
  if (dataHome) roots.push(join(dataHome, "omp"));
  return roots;
}

interface RealState {
  readonly registry: ReadonlyMap<string, number | null>;
  readonly gateLogSize: number;
}

/**
 * A snapshot of the real state: the modification times of the real omp registry files, and the size of the
 * real verify-gate log, so that the check reads only the lines that come after it.
 */
function realStateSnapshot(): RealState {
  const files = realRegistryRoots().flatMap((root) =>
    REAL_REGISTRY_FILES.map((file) => join(root, file)),
  );
  return {
    registry: new Map(files.map((file) => [file, mtimeOf(file)])),
    gateLogSize: existsSync(REAL_GATE_LOG) ? statSync(REAL_GATE_LOG).size : 0,
  };
}

/**
 * The lines added to the real verify-gate log after a size. If the file is now shorter, a different file
 * replaced it, and all its lines count as new.
 */
function newGateLogLines(size: number): string[] {
  if (!existsSync(REAL_GATE_LOG)) return [];
  const bytes = readFileSync(REAL_GATE_LOG);
  return (bytes.length >= size ? bytes.subarray(size) : bytes)
    .toString("utf8")
    .split("\n")
    .filter(Boolean);
}

function realStateChanges(before: RealState): string[] {
  const changes: string[] = [];
  for (const [file, mtime] of before.registry) {
    if (mtimeOf(file) !== mtime) changes.push(`real state changed: ${file}`);
  }
  if (scratch === null) return changes;
  const roots = [...new Set([scratch, realpathSync(scratch)])];
  const inScratch = (cwd: Json | undefined): boolean =>
    typeof cwd === "string" && roots.some((root) => cwd === root || cwd.startsWith(root + sep));
  const smokeLines = newGateLogLines(before.gateLogSize).filter((line) => {
    const record = parseJsonText(line);
    return isObject(record) && inScratch(record["cwd"]);
  });
  if (smokeLines.length > 0) {
    changes.push(
      `real state changed: ${REAL_GATE_LOG} has ${smokeLines.length} new line(s) with a cwd in the scratch folder`,
    );
  }
  return changes;
}

// ---------- plugin discovery ----------

function parseJson(source: string, label: string, failures: string[]): JsonObject | null {
  const parsed = parseJsonText(source);
  if (isObject(parsed)) return parsed;
  failures.push(`${label} did not print a JSON object`);
  return null;
}

function frontmatterName(file: string): string | null {
  const match = /^---\r?\n([\s\S]*?)\r?\n---/.exec(readFileSync(file, "utf8"));
  const name = match?.[1] === undefined ? null : /^name:\s*(.+?)\s*$/m.exec(match[1]);
  return name?.[1] === undefined ? null : name[1].replace(/^["']|["']$/g, "");
}

function pluginAgentNames(root: string): Set<string> {
  const names = new Set<string>();
  const agentsDir = join(root, "agents");
  if (!existsSync(agentsDir)) return names;
  for (const file of readdirSync(agentsDir)) {
    if (!file.endsWith(".md")) continue;
    const name = frontmatterName(join(agentsDir, file));
    if (name !== null) names.add(name);
  }
  return names;
}

/** Agent names in the "Available Agents" list of the task tool that the model receives. */
function taskToolAgents(requests: readonly JsonObject[]): string[] | null {
  for (const request of requests) {
    for (const tool of objects(request["tools"])) {
      const fn = isObject(tool["function"]) ? tool["function"] : tool;
      if (fn["name"] !== "task") continue;
      const description = text(fn["description"]);
      if (description !== undefined)
        return [...description.matchAll(/^- `([^`]+)`/gm)].map((match) => match[1] ?? "");
    }
  }
  return null;
}

function stateLogLines(stateDir: string): string[] {
  const logsDir = join(stateDir, "logs");
  if (!existsSync(logsDir)) return [];
  return readdirSync(logsDir)
    .filter((file) => file.endsWith(".log"))
    .flatMap((file) => readFileSync(join(logsDir, file), "utf8").split("\n"));
}

/** The linked kit plugin as omp lists it. */
interface LinkedPlugin {
  /** The `path` of the npm row: the package link under `<state>/plugins/node_modules/`. */
  readonly path: string;
  /** The folder that the link resolves to. */
  readonly realPath: string;
}

/**
 * Folder prefixes of the linked plugin: the package link that omp loads from, the folder it resolves to,
 * and the plugin folder of this checkout.
 */
function pluginRoots(plugin: LinkedPlugin): string[] {
  return [...new Set([plugin.path, plugin.realPath, pluginDir])].map((root) => root + sep);
}

/** Text that marks an omp message as one about the kit plugin: its folders and its package name. */
function pluginMarkers(plugin: LinkedPlugin | null): string[] {
  return [...(plugin === null ? [pluginDir + sep] : pluginRoots(plugin)), PACKAGE_NAME];
}

/**
 * omp warnings about the kit plugin: skill list warnings, warning lines on stderr, and warn/error log records.
 * A "Failed to load extension" record is an error record, so an extension that throws at load counts. The
 * markers cover each extension of the plugin (`hygiene.ts` too), because omp names the file it loads.
 */
function countWarnings(
  skillWarnings: readonly Json[],
  results: readonly OmpResult[],
  stateDir: string,
  markers: readonly string[],
): string[] {
  const mentions = (line: string): boolean => markers.some((marker) => line.includes(marker));
  const warnings = new Set<string>();
  for (const warning of skillWarnings) {
    const line = typeof warning === "string" ? warning : JSON.stringify(warning);
    if (mentions(line)) warnings.add(line);
  }
  for (const result of results) {
    for (const line of result.stderr.split("\n")) {
      if (/warn|error|fail/i.test(line) && mentions(line)) warnings.add(line.trim());
    }
  }
  for (const line of stateLogLines(stateDir)) {
    const record = parseJsonText(line);
    if (!isObject(record)) continue;
    const level = record["level"];
    if (level !== "warn" && level !== "warning" && level !== "error") continue;
    const { timestamp: _timestamp, pid: _pid, ...rest } = record;
    const entry = JSON.stringify(rest);
    if (mentions(entry)) warnings.add(entry);
  }
  return [...warnings];
}

interface OmpOptions {
  readonly cwd?: string;
  readonly env?: Record<string, string>;
}

interface Run {
  readonly isolation: Isolation;
  readonly env: Record<string, string>;
  readonly requests: JsonObject[];
  readonly script: Script;
  readonly results: OmpResult[];
  readonly omp: (argv: readonly string[], options?: OmpOptions) => Promise<OmpResult>;
  readonly plugin: LinkedPlugin | null;
  /** The modification time of the fresh sweep stamp in the scratch home. */
  readonly sweepStampMtime: number | null;
}

/**
 * Creates the scratch folder with isolated omp state, starts the fake model, links the kit plugin folder of
 * this checkout, and finds its npm row. Each omp command that exits non-zero adds a failure.
 */
async function install(failures: string[]): Promise<Run> {
  scratch = createScratch();
  const home = join(scratch, "home");
  const isolation: Isolation = {
    home,
    stateDir: join(home, CONFIG_DIR_NAME),
    stateHome: join(scratch, "state"),
    tmpDir: join(scratch, "tmp"),
  };
  const workDir = join(scratch, "work");
  for (const dir of [
    join(isolation.stateDir, "agent"),
    isolation.stateHome,
    isolation.tmpDir,
    workDir,
  ])
    mkdirSync(dir, { recursive: true });
  // A fresh stamp: the `hygiene.ts` session-start sweep (`docks-kit tidy --apply`) is not due, so it does not start.
  const stamp = join(home, ".cache", ...SWEEP_STAMP);
  mkdirSync(dirname(stamp), { recursive: true });
  writeFileSync(stamp, "");
  const env = isolatedEnv(isolation);

  const requests: JsonObject[] = [];
  const script: Script = { turns: [] };
  const fake = await startFakeModel(requests, script);
  server = fake;
  const address = fake.address();
  if (address === null || typeof address === "string")
    throw new Error("the fake model has no TCP port");
  writeFileSync(join(isolation.stateDir, "agent", "models.yml"), modelsYaml(address.port));

  const results: OmpResult[] = [];
  const omp = async (argv: readonly string[], options: OmpOptions = {}): Promise<OmpResult> => {
    const result = await runOmp(argv, options.cwd ?? workDir, options.env ?? env);
    results.push(result);
    if (result.code !== 0) {
      const detail = (result.stderr || result.stdout).trim().split("\n")[0] ?? "";
      failures.push(`omp ${argv.join(" ")} exited ${result.code}${detail ? `: ${detail}` : ""}`);
    }
    return result;
  };

  await omp(["plugin", "link", pluginDir]);
  if (!existsSync(join(isolation.stateDir, "plugins")))
    failures.push(`omp kept no plugin state in ${isolation.stateDir}`);
  const pluginList = parseJson(
    (await omp(["plugin", "list", "--json"])).stdout,
    "omp plugin list --json",
    failures,
  );
  const row = objects(pluginList?.["npm"]).find((entry) => entry["name"] === PACKAGE_NAME);
  const path = text(row?.["path"]);
  let plugin: LinkedPlugin | null = null;
  if (path === undefined)
    failures.push(`omp plugin list --json has no npm row ${PACKAGE_NAME} with a path`);
  else if (!existsSync(path)) failures.push(`the ${PACKAGE_NAME} path ${path} does not exist`);
  else plugin = { path, realPath: realpathSync(path) };
  return {
    isolation,
    env,
    requests,
    script,
    results,
    omp,
    plugin,
    sweepStampMtime: mtimeOf(stamp),
  };
}

/** Problems that show that a kit extension acted outside the scratch state: a started hygiene sweep. */
function isolationProblems(run: Run): string[] {
  const stamp = join(run.isolation.home, ".cache", ...SWEEP_STAMP);
  return mtimeOf(stamp) === run.sweepStampMtime
    ? []
    : [`the hygiene sweep stamp ${stamp} changed, so a sweep started`];
}

function manifestName(failures: string[]): string {
  const manifest = join(pluginDir, "package.json");
  if (!existsSync(manifest)) {
    failures.push(`${manifest} does not exist`);
    return "missing";
  }
  const name =
    text(parseJson(readFileSync(manifest, "utf8"), manifest, failures)?.["name"]) ?? "missing";
  if (name !== PACKAGE_NAME) failures.push(`${manifest} names ${name}, expected ${PACKAGE_NAME}`);
  return name;
}

async function smoke(): Promise<{ lines: string[]; failures: string[] }> {
  const failures: string[] = [];
  if (!existsSync(pluginDir)) {
    failures.push(`plugin folder ${pluginDir} does not exist`);
    return { lines: [], failures };
  }
  const name = manifestName(failures);
  const realBefore = realStateSnapshot();
  const run = await install(failures);
  const skillList = parseJson(
    (await run.omp(["skill", "list", "--json"])).stdout,
    "omp skill list --json",
    failures,
  );
  await run.omp([
    "-p",
    "--mode",
    "json",
    "--model",
    `${MODEL_PROVIDER}/${MODEL_ID}`,
    "--no-title",
    "--no-session",
    SESSION_PROMPT,
  ]);

  const lines = [`${name} -> ${run.plugin?.realPath ?? "missing"}`];
  if (run.plugin !== null && run.plugin.realPath !== realpathSync(pluginDir)) {
    failures.push(`${PACKAGE_NAME} resolves to ${run.plugin.realPath}, expected ${pluginDir}`);
  }

  const roots = run.plugin === null ? [] : pluginRoots(run.plugin);
  const skills = objects(skillList?.["skills"]).filter((skill) => {
    const filePath = text(skill["filePath"]);
    return filePath !== undefined && roots.some((root) => filePath.startsWith(root));
  });
  lines.push(`skills: ${skills.length}`);
  if (skills.length !== EXPECTED_SKILLS)
    failures.push(`skills: ${skills.length}, expected ${EXPECTED_SKILLS}`);

  const offered = taskToolAgents(run.requests);
  const ownAgents = run.plugin === null ? new Set<string>() : pluginAgentNames(run.plugin.realPath);
  const agents = (offered ?? []).filter((agent) => ownAgents.has(agent)).sort();
  lines.push(`agents: ${agents.join(",")}`);
  if (run.requests.length === 0)
    failures.push("the fake model received no request from the omp session");
  else if (offered === null) failures.push("the model request has no task tool with an agent list");
  const missingAgents = REQUIRED_AGENTS.filter((agent) => !agents.includes(agent));
  if (missingAgents.length > 0)
    failures.push(`agents missing from the task tool: ${missingAgents.join(",")}`);

  const skillWarnings = Array.isArray(skillList?.["warnings"]) ? skillList["warnings"] : [];
  const warnings = countWarnings(
    skillWarnings,
    run.results,
    run.isolation.stateDir,
    pluginMarkers(run.plugin),
  );
  lines.push(`warnings: ${warnings.length}`);
  if (warnings.length > 0)
    failures.push(
      `omp reported ${warnings.length} warning(s) about the plugin: ${warnings.join(" | ")}`,
    );

  failures.push(...isolationProblems(run), ...realStateChanges(realBefore));
  return { lines, failures };
}

// ---------- hooks ----------

const GATE_REASON = "no Verified: trailer";
const NUDGE_TEXT = "Edited files inside context-tree node(s): scripts";
const NUDGE_PREFIX = "Edited files inside context-tree node(s)";
const BARE_COMMIT = "git commit -m 'docs: fix typo'";
const BARE_SUBJECT = "docs: fix typo";
const TRAILER_COMMIT = "git commit --allow-empty -m 'x' -m 'Verified: none - probe'";
const TRAILER = "Verified: none - probe";
/** The log keeps metadata only; none of these texts of the commands may appear in it. */
const SECRET_TEXTS = ["git commit", "fix typo", "Verified", "probe"];
const LOG_FIELDS = ["cwd", "message_sources", "mode", "session_id", "time"];

/** The files of the scratch git repository: a root README.md and a nested `scripts` context-tree node. */
const FIXTURE_FILES: Readonly<Record<string, string>> = {
  "AGENTS.md": "# Rules\n",
  "README.md": "# Smoke repository\n",
  "notes.txt": "notes\n",
  "scripts/AGENTS.md": "# scripts\n",
  "scripts/ci.mjs": "export const ok = true;\n",
};

function bash(id: string, commandText: string): ToolCall[] {
  return [{ id, name: "bash", arguments: { command: commandText } }];
}

function textOf(content: Json | undefined): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((part) =>
      typeof part === "string" ? part : isObject(part) ? (text(part["text"]) ?? "") : "",
    )
    .join("");
}

/** The snapshot tag of `path` in the result of the read call `readId`, as the model sees it in the request. */
function snapshotTag(request: JsonObject, readId: string, path: string): string {
  const result = objects(request["messages"]).find(
    (message) => message["role"] === "tool" && message["tool_call_id"] === readId,
  );
  const escaped = path.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");
  return (
    new RegExp(`\\[${escaped}#([0-9A-Za-z]+)\\]`).exec(textOf(result?.["content"]))?.[1] ?? "none"
  );
}

function hashlineEdit(id: string, path: string, tag: string, line: string): ToolCall[] {
  return [{ id, name: "edit", arguments: { input: `[${path}#${tag}]\nPUT 1.=1:\n+${line}\n` } }];
}

/** The messages of an `omp --mode json` event stream, in order. */
function streamMessages(stdout: string): JsonObject[] {
  const messages: JsonObject[] = [];
  for (const line of stdout.split("\n")) {
    const event = parseJsonText(line);
    if (isObject(event) && event["type"] === "message_end" && isObject(event["message"]))
      messages.push(event["message"]);
  }
  return messages;
}

interface CallOutcome {
  readonly isError: boolean;
  readonly text: string;
  /** The texts of the added-context messages that follow the tool result before the next assistant message. */
  readonly context: readonly string[];
}

function callOutcome(messages: readonly JsonObject[], id: string): CallOutcome | null {
  const index = messages.findIndex(
    (message) => message["role"] === "toolResult" && message["toolCallId"] === id,
  );
  const result = messages[index];
  if (result === undefined) return null;
  const context: string[] = [];
  for (const message of messages.slice(index + 1)) {
    if (message["role"] === "assistant") break;
    if (message["role"] === "developer") context.push(textOf(message["content"]));
  }
  return { isError: result["isError"] === true, text: textOf(result["content"]), context };
}

function short(line: string): string {
  const flat = line.replace(/\s+/g, " ").trim();
  return flat.length > 160 ? `${flat.slice(0, 160)}...` : flat;
}

function gitIn(cwd: string, env: Record<string, string>, gitArgs: readonly string[]): string {
  const result = spawnSync("git", gitArgs, { cwd, env, encoding: "utf8" });
  if (result.status !== 0)
    throw new Error(
      `git ${gitArgs.join(" ")} failed: ${(result.stderr || String(result.error ?? "")).trim()}`,
    );
  return result.stdout;
}

function logLines(file: string): string[] {
  return existsSync(file)
    ? readFileSync(file, "utf8")
        .split("\n")
        .filter((line) => line.trim())
    : [];
}

interface SessionOptions {
  readonly turns: readonly Turn[];
  readonly mode?: string;
  readonly extraArgv?: readonly string[];
}

interface SessionResult {
  readonly messages: JsonObject[];
  readonly log: string;
}

async function hooks(): Promise<string[]> {
  const checks: string[] = [];
  const check = (name: string, problem: string | null): void => {
    checks.push(problem ? `FAIL ${name}: ${problem}` : `ok ${name}`);
  };
  if (!existsSync(pluginDir)) {
    check("install", `plugin folder ${pluginDir} does not exist`);
    return checks;
  }
  const realBefore = realStateSnapshot();
  const installFailures: string[] = [];
  const run = await install(installFailures);
  check("install", installFailures.join("; "));
  if (scratch === null) throw new Error("the scratch folder is gone");

  // A scratch git repository with its own git config, so no global git setting (signing, hooks) applies.
  const repoDir = join(scratch, "repo");
  const gitConfig = join(scratch, "gitconfig");
  writeFileSync(
    gitConfig,
    "[user]\n\tname = omp smoke\n\temail = omp-smoke@example.invalid\n[commit]\n\tgpgsign = false\n",
  );
  const gitEnv: Record<string, string> = {
    ...run.env,
    GIT_CONFIG_GLOBAL: gitConfig,
    GIT_CONFIG_NOSYSTEM: "1",
  };
  for (const [file, content] of Object.entries(FIXTURE_FILES)) {
    mkdirSync(dirname(join(repoDir, file)), { recursive: true });
    writeFileSync(join(repoDir, file), content);
  }
  const git = (...gitArgs: string[]): string => gitIn(repoDir, gitEnv, gitArgs);
  git("init", "-q", "-b", "main");
  git("add", "-A");
  git("commit", "-q", "-m", "chore: start", "-m", "Verified: none - smoke fixture");
  let change = 0;
  const stageChange = (): void => {
    change += 1;
    writeFileSync(join(repoDir, "notes.txt"), `notes ${change}\n`);
    git("add", "notes.txt");
  };
  const bareCommits = (): number =>
    git("log", "--format=%s")
      .split("\n")
      .filter((subject) => subject === BARE_SUBJECT).length;

  const sessionFailures: string[] = [];
  const stateRoot = run.isolation.stateHome;
  const session = async (
    name: string,
    { turns, mode, extraArgv = [] }: SessionOptions,
  ): Promise<SessionResult> => {
    const env: Record<string, string> = { ...gitEnv, XDG_STATE_HOME: join(stateRoot, name) };
    if (mode !== undefined) env["DOCKS_VERIFY_GATE"] = mode;
    run.script.turns = turns;
    const result = await run.omp(
      [
        "-p",
        "--mode",
        "json",
        "--model",
        `${MODEL_PROVIDER}/${MODEL_ID}`,
        "--no-title",
        ...extraArgv,
        SCRIPTED_PROMPT,
      ],
      {
        cwd: repoDir,
        env,
      },
    );
    run.script.turns = [];
    if (result.code !== 0)
      sessionFailures.push(
        `${name} session exited ${result.code}: ${short(result.stderr || result.stdout)}`,
      );
    return {
      messages: streamMessages(result.stdout),
      log: join(stateRoot, name, "docks", "verify-gate.jsonl"),
    };
  };

  // Gate, enforce: two bare commits are blocked, the third runs, and a commit with the trailer runs.
  stageChange();
  const bareBefore = bareCommits();
  const enforce = await session("enforce", {
    mode: "enforce",
    turns: [
      bash("enforce-1", BARE_COMMIT),
      bash("enforce-2", BARE_COMMIT),
      bash("enforce-3", BARE_COMMIT),
      bash("enforce-trailer", TRAILER_COMMIT),
    ],
  });
  for (const id of ["enforce-1", "enforce-2"]) {
    const outcome = callOutcome(enforce.messages, id);
    if (!outcome) check(`gate-${id}-blocked`, "no tool result in the event stream");
    else if (!outcome.isError || !outcome.text.includes(GATE_REASON))
      check(`gate-${id}-blocked`, `not blocked with the Verified: reason: ${short(outcome.text)}`);
    else check(`gate-${id}-blocked`, null);
  }
  const third = callOutcome(enforce.messages, "enforce-3");
  const bareAfterEnforce = bareCommits();
  if (!third) check("gate-enforce-3-allowed", "no tool result in the event stream");
  else if (third.isError || third.text.includes(GATE_REASON))
    check("gate-enforce-3-allowed", `the call failed: ${short(third.text)}`);
  else if (bareAfterEnforce !== bareBefore + 1) {
    check(
      "gate-enforce-3-allowed",
      `git log holds ${bareAfterEnforce - bareBefore} new '${BARE_SUBJECT}' commit(s), expected 1`,
    );
  } else check("gate-enforce-3-allowed", null);
  const trailer = callOutcome(enforce.messages, "enforce-trailer");
  if (!trailer) check("gate-enforce-trailer-allowed", "no tool result in the event stream");
  else if (trailer.isError || trailer.text.includes(GATE_REASON))
    check("gate-enforce-trailer-allowed", `the call failed: ${short(trailer.text)}`);
  else if (!git("log", "-1", "--format=%B").includes(TRAILER))
    check("gate-enforce-trailer-allowed", `the last commit has no '${TRAILER}' trailer`);
  else check("gate-enforce-trailer-allowed", null);

  // Gate, observe (DOCKS_VERIFY_GATE unset): the bare commit runs and the log gets one metadata line.
  stageChange();
  const observe = await session("observe", { turns: [bash("observe-1", BARE_COMMIT)] });
  const observed = callOutcome(observe.messages, "observe-1");
  const bareAfterObserve = bareCommits();
  if (!observed) check("gate-observe-commit-runs", "no tool result in the event stream");
  else if (observed.isError)
    check("gate-observe-commit-runs", `the call failed: ${short(observed.text)}`);
  else if (bareAfterObserve !== bareAfterEnforce + 1)
    check("gate-observe-commit-runs", "git log holds no new commit");
  else check("gate-observe-commit-runs", null);
  const observeLines = logLines(observe.log);
  const observeParsed =
    observeLines.length === 1 && observeLines[0] !== undefined
      ? parseJsonText(observeLines[0])
      : undefined;
  const observeRecord = isObject(observeParsed) ? observeParsed : null;
  const observeFields = observeRecord ? Object.keys(observeRecord).sort().join(",") : "";
  if (observeLines.length !== 1)
    check("gate-observe-log", `the log holds ${observeLines.length} line(s), expected 1`);
  else if (observeRecord === null || observeFields !== LOG_FIELDS.join(",")) {
    check(
      "gate-observe-log",
      `the line has the fields ${observeFields || "(not JSON)"}, expected ${LOG_FIELDS.join(",")}`,
    );
  } else if (
    observeRecord["mode"] !== "observe" ||
    JSON.stringify(observeRecord["message_sources"]) !== '["-m"]'
  ) {
    check("gate-observe-log", `unexpected line ${observeLines[0]}`);
  } else check("gate-observe-log", null);

  // Gate, off: the bare commit runs and the log gets no line.
  stageChange();
  const off = await session("off", { mode: "off", turns: [bash("off-1", BARE_COMMIT)] });
  const offOutcome = callOutcome(off.messages, "off-1");
  if (!offOutcome) check("gate-off-commit-runs", "no tool result in the event stream");
  else if (offOutcome.isError)
    check("gate-off-commit-runs", `the call failed: ${short(offOutcome.text)}`);
  else if (bareCommits() !== bareAfterObserve + 1)
    check("gate-off-commit-runs", "git log holds no new commit");
  else check("gate-off-commit-runs", null);
  const offLines = logLines(off.log);
  check(
    "gate-off-no-log",
    offLines.length > 0 ? `the log holds ${offLines.length} line(s), expected none` : null,
  );

  const allLines = [enforce.log, observe.log, off.log].flatMap(logLines);
  const leak = allLines.find((line) => SECRET_TEXTS.some((secret) => line.includes(secret)));
  if (allLines.length === 0) check("gate-log-no-text", "no log line to check");
  else
    check(
      "gate-log-no-text",
      leak === undefined ? null : `a log line holds command or message text: ${leak}`,
    );

  // Nudge: an edit in the `scripts` node adds a context message; an edit of the root README.md, a failed edit,
  // and a write to a URL add none. The session folder lies inside the `scripts` node, so a `local://` write
  // resolves to a file inside the node, and only the URL rule keeps the nudge away.
  const nudge = await session("nudge", {
    extraArgv: ["--session-dir", join(repoDir, "scripts", ".sessions")],
    turns: [
      [{ id: "nudge-read-node", name: "read", arguments: { path: "scripts/ci.mjs" } }],
      (request) =>
        hashlineEdit(
          "nudge-node",
          "scripts/ci.mjs",
          snapshotTag(request, "nudge-read-node", "scripts/ci.mjs"),
          "export const ok = false;",
        ),
      [{ id: "nudge-read-root", name: "read", arguments: { path: "README.md" } }],
      (request) =>
        hashlineEdit(
          "nudge-root",
          "README.md",
          snapshotTag(request, "nudge-read-root", "README.md"),
          "# Smoke repository (edited)",
        ),
      // The tag of the first read is stale after the first edit, so this edit fails.
      (request) =>
        hashlineEdit(
          "nudge-failed",
          "scripts/ci.mjs",
          snapshotTag(request, "nudge-read-node", "scripts/ci.mjs"),
          "export const ok = 0;",
        ),
      [
        {
          id: "nudge-url",
          name: "write",
          arguments: { path: "local://notes.md", content: "notes\n" },
        },
      ],
    ],
  });
  const node = callOutcome(nudge.messages, "nudge-node");
  if (!node) check("nudge-node-edit", "no tool result in the event stream");
  else if (node.isError) check("nudge-node-edit", `the edit failed: ${short(node.text)}`);
  else if (
    node.context.some((line) => line.includes(NUDGE_TEXT)) &&
    !node.text.includes(NUDGE_PREFIX)
  )
    check("nudge-node-edit", null);
  else
    check(
      "nudge-node-edit",
      `no separate added-context message with '${NUDGE_TEXT}' after the tool result`,
    );
  const quiet = (name: string, id: string, expectError: boolean): void => {
    const outcome = callOutcome(nudge.messages, id);
    if (!outcome) return check(name, "no tool result in the event stream");
    if (outcome.isError !== expectError)
      return check(
        name,
        `the call ${expectError ? "did not fail" : "failed"}: ${short(outcome.text)}`,
      );
    const nudged = outcome.context.find((line) => line.includes(NUDGE_PREFIX));
    return check(
      name,
      nudged === undefined ? null : `an added-context message follows: ${short(nudged)}`,
    );
  };
  quiet("nudge-root-edit-none", "nudge-root", false);
  quiet("nudge-failed-edit-none", "nudge-failed", true);
  quiet("nudge-url-write-none", "nudge-url", false);

  const warnings = countWarnings(
    [],
    run.results,
    run.isolation.stateDir,
    pluginMarkers(run.plugin),
  );
  check(
    "extensions-loaded",
    warnings.length > 0
      ? `omp reported ${warnings.length} warning(s) about the plugin: ${warnings.join(" | ")}`
      : null,
  );
  check("sessions", sessionFailures.join("; "));
  check("isolated", isolationProblems(run).join("; "));
  check("real-state", realStateChanges(realBefore).join("; "));
  return checks;
}

let exitCode = 1;
try {
  if (command === "hooks") {
    const checks = await hooks();
    for (const line of checks) console.log(line);
    exitCode = checks.some((line) => line.startsWith("FAIL")) ? 1 : 0;
  } else {
    const { lines, failures } = await smoke();
    for (const line of lines) console.log(line);
    for (const failure of failures) console.log(`FAIL ${failure}`);
    exitCode = failures.length > 0 ? 1 : 0;
  }
} catch (error) {
  console.log(`FAIL ${error instanceof Error ? error.message : String(error)}`);
} finally {
  if (!reportCleanup()) exitCode = 1;
}
process.exit(exitCode);
