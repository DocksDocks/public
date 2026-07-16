/**
 * Shared golden-regression harness machinery.
 *
 * Harnesses run EngineNative against disposable copies of fixture HOMEs with
 * a stub-bin directory FIRST on PATH, so every external tool the engine drives
 * (claude/codex/npx/npm/rtk/bun/curl/...) is deterministic and records argv.
 */
import { createHash } from "node:crypto"
import {
  copyFileSync,
  cpSync,
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  readlinkSync,
  rmSync,
  symlinkSync,
  writeFileSync
} from "node:fs"
import { tmpdir } from "node:os"
import { basename, delimiter, dirname, isAbsolute, join, resolve } from "node:path"
import { spawnSync } from "node:child_process"
import { fileURLToPath } from "node:url"

export const REPO_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..")
export const FIXTURES_DIR = join(REPO_DIR, "cli", "test", "fixtures")

function bunRuntime(): string {
  if (process.versions["bun"] !== undefined) return process.execPath
  const names = process.platform === "win32" ? ["bun.exe", "bun"] : ["bun"]
  for (const directory of (process.env["PATH"] ?? "").split(delimiter)) {
    for (const name of names) {
      const candidate = join(directory, name)
      if (existsSync(candidate)) return candidate
    }
  }
  return "bun"
}

const BUN_RUNTIME = bunRuntime()

const HARNESS_TEMP_PREFIXES = ["golden-home-", "golden-stubs-", "golden-mask-"] as const
const STALE_TEMP_DIR_AGE_MS = 60 * 60 * 1000
const TEMP_DIRS = new Set<string>()

function isMissingPath(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT"
}

/** Heal externally-killed runs without touching young/concurrent or unrelated temp dirs. */
export function sweepStaleTemporaryDirs(nowMs = Date.now()): void {
  const root = tmpdir()
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    if (!HARNESS_TEMP_PREFIXES.some((prefix) => entry.name.startsWith(prefix))) continue
    const path = join(root, entry.name)
    try {
      if (nowMs - lstatSync(path).mtimeMs < STALE_TEMP_DIR_AGE_MS) continue
      rmSync(path, { recursive: true, force: true })
    } catch (error) {
      if (!isMissingPath(error)) throw error
    }
  }
}

function temporaryDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix))
  TEMP_DIRS.add(dir)
  return dir
}

/** Keep TEMP_DIRS path strings after deletion: snapshot normalization still needs them. */
export function cleanupTemporaryDirs(): void {
  for (const dir of TEMP_DIRS) rmSync(dir, { recursive: true, force: true })
}

sweepStaleTemporaryDirs()
process.on("exit", cleanupTemporaryDirs)

// ---------------------------------------------------------------- stubs ----

/**
 * Canned stub behavior. Each stub appends "<name>\t<args>" to $GOLDEN_ARGV_LOG
 * and emits just enough output for the engine's probes to take a
 * deterministic branch (versions match the SoT/toolchain.json pins so every
 * `ensure` lands on "up to date").
 */
const STUB_BODIES: Record<string, string> = {
  // node and jq are version-probed by `toolchain check` (presence-checked in
  // preflight/skills) but never do real work in the engine — pin them so the
  // goldens don't embed the recording machine's host versions (bit CI: the
  // runner's node differed from the machine that recorded the goldens).
  node: `case "$1" in --version) echo "v22.23.1";; esac`,
  git: `case "$1" in --version) echo "git version 2.43.0";; esac`,
  jq: `case "$1" in --version) echo "jq-1.7.1";; esac`,
  claude: `case "$1" in --version) echo "2.1.204 (Claude Code)";; esac`,
  codex: `case "$1" in
  --version) echo "codex-cli 0.144.4";;
  plugin) case "$2" in
    list) echo '{"installed":[{"pluginId":"docks@docks","version":"0.12.5","installed":true,"enabled":true},{"pluginId":"effect-kit@docks","version":"0.3.0","installed":true,"enabled":true},{"pluginId":"session-relay@docks","version":"0.11.0","installed":true,"enabled":true}],"available":[]}' ;;
    add) exit 0;;
  esac;;
esac`,
  rtk: `case "$1" in --version) echo "rtk 0.43.0";; esac`,
  npx: `exit 0`,
  npm: `case "$1" in
  view) case "$2" in
    agent-browser) echo "0.32.0";;
    effect-solutions) echo "0.5.3";;
    *) echo "0.0.1";;
  esac;;
esac`,
  bun: `case "$1" in
  --version) echo "1.3.14";;
  pm) [ "$2" = "-g" ] && { [ "$3" = "ls" ] && echo "effect-solutions@0.5.3"; [ "$3" = "bin" ] && echo "\${GOLDEN_STUB_DIR}"; };;
esac`,
  curl: `for a in "$@"; do
  case "$a" in
    *api.github.com*) echo '{"tag_name":"v0.43.0"}'; exit 0;;
  esac
done
exit 0`,
  "agent-browser": `case "$1" in --version) echo "agent-browser 0.32.0";; esac`,
  "effect-solutions": `exit 0`,
  bwrap: `case "$1" in --version) echo "bubblewrap 0.11.0";; esac`,
  intelephense: `exit 0`,
  "typescript-language-server": `case "$1" in --version) echo "5.3.0";; esac`,
  tsc: `case "$1" in --version) echo "Version 6.0.3";; esac`,
  ffplay: `exit 0`,
  unshare: `exit 0`
}

/**
 * overrides: replace a stub's body per test row (exercising install/upgrade/
 * gate/failure branches); `null` omits the stub entirely (tool missing).
 */
export function makeStubDir(overrides: Record<string, string | null> = {}): string {
  const dir = temporaryDir("golden-stubs-")
  for (const [name, defaultBody] of Object.entries(STUB_BODIES)) {
    const body = name in overrides ? overrides[name] : defaultBody
    if (body === null || body === undefined) continue
    const script = `#!/bin/bash
printf '%s\\t%s\\n' "${name}" "$*" >> "\${GOLDEN_ARGV_LOG:-/dev/null}"
${body}
exit 0
`
    const p = join(dir, name)
    writeFileSync(p, script)
    chmodSync(p, 0o755)
  }
  return dir
}

// ----------------------------------------------------------------- runs ----

export interface EngineRun {
  readonly exitCode: number
  readonly output: string // stdout+stderr merged, order-stable via 2>&1
  readonly home: string
  readonly argvLog: string
}

/** Channel-aware run: stdout and stderr captured separately (no 2>&1 merge). */
export interface SplitRun {
  readonly exitCode: number
  readonly stdout: string
  readonly stderr: string
  readonly home: string
}

export type EngineKind = "native"

export function engineCommand(kind: EngineKind, args: ReadonlyArray<string>): string {
  const quoted = args.map((a) => `'${a.replace(/'/g, `'\\''`)}'`).join(" ")
  void kind
  // Raw harness channel (bypasses @effect/cli so tests drive the engine's
  // internal argv directly); absolute bun path so the PATH stub `bun` never
  // shadows the runtime.
  return `DOCKS_KIT_ENGINE=native-raw '${BUN_RUNTIME}' '${REPO_DIR}/cli/src/main.ts' ${quoted}`
}

/**
 * PATH with every directory holding one of `names` replaced by a shadow
 * dir mirroring its other entries — the "tool missing" half of a `null`
 * stub override. Omitting the stub alone is NOT absence: PATH search falls
 * through to the real binary on the host (observed: a claude:null row ran
 * the REAL claude CLI, which cloned a marketplace into the temp HOME and
 * diverged on git internals). Shadowing (not dropping) the dir keeps its
 * unrelated tools reachable — the real claude may live beside jq/git in
 * /usr/local/bin, and hiding those would fail the run for the wrong reason.
 */
function maskedPath(names: ReadonlyArray<string>): string {
  const dirs = (process.env["PATH"] ?? "").split(delimiter)
  if (names.length === 0) return dirs.join(delimiter)
  const exts = process.platform === "win32" ? ["", ".exe", ".cmd", ".bat"] : [""]
  const holdsMasked = (dir: string): boolean =>
    dir !== "" && names.some((n) => exts.some((e) => existsSync(join(dir, n + e))))
  return dirs.map((dir) => (holdsMasked(dir) ? shadowDir(dir, names, exts) : dir)).join(delimiter)
}

function shadowDir(dir: string, names: ReadonlyArray<string>, exts: ReadonlyArray<string>): string {
  const shadow = temporaryDir("golden-mask-")
  const blocked = new Set(names.flatMap((n) => exts.map((e) => (n + e).toLowerCase())))
  for (const entry of readdirSync(dir)) {
    if (blocked.has(entry.toLowerCase())) continue
    try {
      symlinkSync(join(dir, entry), join(shadow, entry))
    } catch {
      try {
        copyFileSync(join(dir, entry), join(shadow, entry))
      } catch {
        // subdirectory or unreadable entry — PATH lookup doesn't need it
      }
    }
  }
  return shadow
}

interface RunOpts {
  readonly stdinTty?: boolean
  readonly maskTools?: ReadonlyArray<string>
  /** Run against an existing HOME (sequential replay) instead of materializing the fixture. */
  readonly reuseHome?: string
  /** Extra env for the child (e.g. DOCKS_KIT_VERBOSE). */
  readonly env?: Record<string, string>
}

function materializeHome(kind: string, fixture: string, reuseHome?: string): string {
  if (reuseHome !== undefined) return reuseHome
  const home = temporaryDir(`golden-home-${kind}-`)
  rmSync(home, { recursive: true })
  const src = isAbsolute(fixture) ? fixture : join(FIXTURES_DIR, fixture)
  cpSync(src, home, { recursive: true })
  return home
}

function runEnv(home: string, stubDir: string, argvLog: string, opts: RunOpts): Record<string, string> {
  return {
    HOME: home,
    PATH: `${stubDir}${delimiter}${maskedPath(opts.maskTools ?? [])}`,
    GOLDEN_ARGV_LOG: argvLog,
    GOLDEN_STUB_DIR: stubDir,
    LC_ALL: "C",
    TERM: "dumb",
    // The native side runs under the bun runtime, which would otherwise
    // drop its install cache inside the temp HOME and pollute the tree diff.
    BUN_INSTALL_CACHE_DIR: join(tmpdir(), "golden-bun-cache"),
    // env is constructed from scratch (no process.env spread), so engine
    // globals like DRY_RUN can never leak in from the invoking shell.
    AGENTS_DIR: join(home, ".agents"),
    ...(opts.env ?? {})
  }
}

export function runEngine(
  kind: EngineKind,
  args: ReadonlyArray<string>,
  fixture: string,
  stubDir: string,
  opts: RunOpts = {}
): EngineRun {
  const home = materializeHome(kind, fixture, opts.reuseHome)
  const argvLog = join(home, ".golden-argv.log")
  writeFileSync(argvLog, "")

  const res = spawnSync("bash", ["-c", `exec 2>&1; ${engineCommand(kind, args)}`], {
    cwd: REPO_DIR,
    env: runEnv(home, stubDir, argvLog, opts),
    stdio: [opts.stdinTty ? "inherit" : "ignore", "pipe", "pipe"],
    encoding: "utf8",
    timeout: 120_000
  })
  return {
    exitCode: res.status ?? 1,
    output: normalizeOutput(res.stdout ?? "", home, stubDir),
    home,
    argvLog
  }
}

/**
 * Channel-aware variant of runEngine: no bash 2>&1 merge, so stdout and
 * stderr assert independently. Cross-channel interleaving order is NOT
 * guaranteed here — use for channel-purity invariants, not ordered goldens.
 */
export function runEngineSplit(
  kind: EngineKind,
  args: ReadonlyArray<string>,
  fixture: string,
  stubDir: string,
  opts: RunOpts = {}
): SplitRun {
  const home = materializeHome(kind, fixture, opts.reuseHome)
  const argvLog = join(home, ".golden-argv.log")
  writeFileSync(argvLog, "")
  const res = spawnSync("bash", ["-c", engineCommand(kind, args)], {
    cwd: REPO_DIR,
    env: runEnv(home, stubDir, argvLog, opts),
    stdio: ["ignore", "pipe", "pipe"],
    encoding: "utf8",
    timeout: 120_000
  })
  return {
    exitCode: res.status ?? 1,
    stdout: normalizeOutput(res.stdout ?? "", home, stubDir),
    stderr: normalizeOutput(res.stderr ?? "", home, stubDir),
    home
  }
}

/**
 * Run the PUBLIC CLI (@effect/cli path — no DOCKS_KIT_ENGINE bypass) with
 * split channels. Exercises real flag parsing and command wiring.
 */
export function runPublicCli(
  args: ReadonlyArray<string>,
  fixture: string,
  stubDir: string,
  opts: RunOpts = {}
): SplitRun {
  const home = materializeHome("cli", fixture, opts.reuseHome)
  const argvLog = join(home, ".golden-argv.log")
  writeFileSync(argvLog, "")
  const quoted = args.map((a) => `'${a.replace(/'/g, `'\\''`)}'`).join(" ")
  const res = spawnSync("bash", ["-c", `'${BUN_RUNTIME}' '${REPO_DIR}/cli/src/main.ts' ${quoted}`], {
    cwd: REPO_DIR,
    env: runEnv(home, stubDir, argvLog, opts),
    stdio: ["ignore", "pipe", "pipe"],
    encoding: "utf8",
    timeout: 120_000
  })
  return {
    exitCode: res.status ?? 1,
    stdout: normalizeOutput(res.stdout ?? "", home, stubDir),
    stderr: normalizeOutput(res.stderr ?? "", home, stubDir),
    home
  }
}

/**
 * Replace per-run temp paths so two runs' outputs are comparable.
 *
 * On Windows the engine runs under Git Bash, which prints MSYS-converted
 * forms of the same directories (`C:\Users\…\Temp\x` → `/tmp/x`,
 * `D:\a\repo` → `/d/a/repo`), so each root is scrubbed in every spelling.
 * The temp roots additionally get a basename fallback — their mkdtemp
 * suffix is unique, so any remaining path spelling still normalizes.
 */
export function normalizeOutput(out: string, home: string, stubDir: string): string {
  let s = out.replaceAll("\r\n", "\n")
  for (const f of pathForms(home)) s = s.replaceAll(f, "<HOME>")
  for (const f of pathForms(stubDir)) s = s.replaceAll(f, "<STUBS>")
  for (const f of pathForms(REPO_DIR)) s = s.replaceAll(f, "<REPO>")
  return s
    .replace(new RegExp(`[^\\s'"]*${escapeRegExp(basename(home))}`, "g"), "<HOME>")
    .replace(new RegExp(`[^\\s'"]*${escapeRegExp(basename(stubDir))}`, "g"), "<STUBS>")
}

function pathForms(p: string): Array<string> {
  const fwd = p.replaceAll("\\", "/")
  const forms = [p, fwd]
  const drive = /^([A-Za-z]):\//.exec(fwd)
  if (drive !== null) forms.push(`/${drive[1]!.toLowerCase()}${fwd.slice(2)}`) // MSYS form
  return [...new Set(forms)]
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

// ------------------------------------------------------------ tree diff ----

export type TreeSnapshot = Record<string, string> // relpath -> "sha256:<hex>" | "link:<target>"

function normalizeTreeBody(body: string, root: string): string {
  let normalized = body.replaceAll("\r\n", "\n")
  for (const form of pathForms(root)) normalized = normalized.replaceAll(form, "<HOME>")
  for (const temporary of TEMP_DIRS) {
    if (!basename(temporary).startsWith("golden-stubs-")) continue
    for (const form of pathForms(temporary)) normalized = normalized.replaceAll(form, "<STUBS>")
  }
  return normalized
}

export function snapshotTree(root: string, dir = root, acc: TreeSnapshot = {}): TreeSnapshot {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name)
    const rel = p.slice(root.length + 1)
    if (rel === ".golden-argv.log") continue
    // `.bun/install` is a runtime artifact of the native side's bun
    // interpreter (module cache keyed off $HOME) — the engine never writes
    // there. `.bun` itself is still recursed (engine bootstraps can create
    // `.bun/bin`) but not recorded as an entry, so a cache-only `.bun`
    // contributes nothing to the diff.
    if (rel === ".bun/install") continue
    const st = lstatSync(p)
    if (st.isSymbolicLink()) {
      acc[rel] = `link:${readlinkSync(p)}`
    } else if (st.isDirectory()) {
      if (rel !== ".bun") acc[`${rel}/`] = "dir"
      snapshotTree(root, p, acc)
    } else {
      // Hash with CRLF and materialized runtime paths canonicalized so
      // platform transport and per-run HOME/stub roots are not regressions.
      const body = normalizeTreeBody(readFileSync(p).toString("binary"), root)
      acc[rel] = `sha256:${createHash("sha256").update(Buffer.from(body, "binary")).digest("hex")}`
    }
  }
  return acc
}

export function diffTrees(a: TreeSnapshot, b: TreeSnapshot): Array<string> {
  const out: Array<string> = []
  for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) {
    if (a[k] === b[k]) continue
    out.push(`  ${k}: A=${a[k] ?? "(absent)"} B=${b[k] ?? "(absent)"}`)
  }
  return out.sort()
}

export function diffText(label: string, a: string, b: string): Array<string> {
  if (a === b) return []
  const la = a.split("\n")
  const lb = b.split("\n")
  const out: Array<string> = [`  ${label} differs (${la.length} vs ${lb.length} lines):`]
  for (let i = 0; i < Math.max(la.length, lb.length); i++) {
    if (la[i] !== lb[i]) {
      out.push(`    line ${i + 1}: A=${JSON.stringify(la[i] ?? "")} B=${JSON.stringify(lb[i] ?? "")}`)
      if (out.length > 12) {
        out.push("    …")
        break
      }
    }
  }
  return out
}

// ------------------------------------------------------------- plumbing ----

export function readArgvLog(run: EngineRun): string {
  return existsSync(run.argvLog) ? readFileSync(run.argvLog, "utf8") : ""
}

export function cleanup(runs: Array<EngineRun>): void {
  for (const r of runs) rmSync(r.home, { recursive: true, force: true })
}

export function parseArgs(argv: Array<string>): { proveRed: boolean; updateGoldens: boolean } {
  const allowed = new Set(["--prove-red", "--update-goldens"])
  const unknown = argv.slice(2).filter((arg) => arg.startsWith("--") && !allowed.has(arg))
  if (unknown.length > 0) {
    console.error(`unknown option(s): ${unknown.join(", ")}`)
    process.exit(2)
  }
  const proveRed = argv.includes("--prove-red")
  const updateGoldens = argv.includes("--update-goldens")
  if (proveRed && updateGoldens) {
    console.error("--prove-red and --update-goldens are mutually exclusive")
    process.exit(2)
  }
  return { proveRed, updateGoldens }
}

/**
 * GOLDEN_FILTER (regex on the case label) scopes a run to one command surface.
 * Unset = everything.
 */
export function labelSelected(label: string): boolean {
  const f = process.env["GOLDEN_FILTER"]
  if (f === undefined || f === "") return true
  return new RegExp(f).test(label)
}

export function banner(msg: string): void {
  console.log(`\n=== ${msg} ===`)
}

/** Write a fixture home variant on the fly (used by the TOML suite). */
export function materializeVariant(base: string, files: Record<string, string>): string {
  const dir = temporaryDir("golden-fixture-")
  rmSync(dir, { recursive: true })
  cpSync(join(FIXTURES_DIR, base), dir, { recursive: true })
  for (const [rel, content] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, rel)), { recursive: true })
    writeFileSync(join(dir, rel), content)
  }
  return dir
}

export function stableStringify(value: unknown): string {
  return `${JSON.stringify(stableJson(value), null, 2)}\n`
}

function stableJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableJson)
  if (value === null || typeof value !== "object") return value
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => [k, stableJson(v)])
  )
}
