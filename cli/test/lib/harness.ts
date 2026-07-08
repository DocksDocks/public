/**
 * Shared parity-harness machinery (windows-support plan, step 4).
 *
 * Both harnesses run the engine(s) against disposable copies of fixture
 * HOMEs with a stub-bin directory FIRST on PATH, so every external tool the
 * engine drives (claude/codex/npx/npm/rtk/bun/curl/…) is deterministic and
 * records its argv. Until EngineNative exists, runs are bash-vs-bash
 * (self-parity: proves the machinery + hermeticity); `--native` switches
 * side B to `DOCKS_KIT_ENGINE=native bun cli/src/main.ts` once step 5(a)
 * lands.
 */
import { createHash } from "node:crypto"
import {
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
  writeFileSync
} from "node:fs"
import { tmpdir } from "node:os"
import { basename, delimiter, dirname, isAbsolute, join, resolve } from "node:path"
import { spawnSync } from "node:child_process"

export const REPO_DIR = resolve(import.meta.dir, "..", "..", "..")
export const FIXTURES_DIR = join(REPO_DIR, "cli", "test", "fixtures")

// ---------------------------------------------------------------- stubs ----

/**
 * Canned stub behavior. Each stub appends "<name>\t<args>" to $PARITY_ARGV_LOG
 * and emits just enough output for the engine's probes to take a
 * deterministic branch (versions match the SoT/toolchain.json pins so every
 * `ensure` lands on "up to date").
 */
const STUB_BODIES: Record<string, string> = {
  claude: `case "$1" in --version) echo "2.1.204 (Claude Code)";; esac`,
  codex: `case "$1" in --version) echo "codex-cli 0.142.2";; esac`,
  rtk: `case "$1" in --version) echo "rtk 0.43.0";; esac`,
  npx: `exit 0`,
  npm: `case "$1" in
  view) case "$2" in
    agent-browser) echo "0.31.1";;
    effect-solutions) echo "0.5.3";;
    *) echo "0.0.1";;
  esac;;
esac`,
  bun: `case "$1" in
  --version) echo "1.3.14";;
  pm) [ "$2" = "-g" ] && { [ "$3" = "ls" ] && echo "effect-solutions@0.5.3"; [ "$3" = "bin" ] && echo "\${PARITY_STUB_DIR}"; };;
esac`,
  curl: `for a in "$@"; do
  case "$a" in
    *api.github.com*) echo '{"tag_name":"v0.43.0"}'; exit 0;;
  esac
done
exit 0`,
  "agent-browser": `case "$1" in --version) echo "agent-browser 0.31.1";; esac`,
  "effect-solutions": `exit 0`,
  bwrap: `case "$1" in --version) echo "bubblewrap 0.11.0";; esac`,
  intelephense: `exit 0`,
  "typescript-language-server": `case "$1" in --version) echo "5.3.0";; esac`,
  tsc: `case "$1" in --version) echo "Version 6.0.3";; esac`,
  ffplay: `exit 0`,
  unshare: `exit 0`
}

export function makeStubDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "parity-stubs-"))
  for (const [name, body] of Object.entries(STUB_BODIES)) {
    const script = `#!/bin/bash
printf '%s\\t%s\\n' "${name}" "$*" >> "\${PARITY_ARGV_LOG:-/dev/null}"
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

export type EngineKind = "bash" | "native"

export function engineCommand(kind: EngineKind, args: ReadonlyArray<string>): string {
  const quoted = args.map((a) => `'${a.replace(/'/g, `'\\''`)}'`).join(" ")
  if (kind === "bash") return `bash '${REPO_DIR}/lib/engine.sh' ${quoted}`
  // Absolute bun path so the PATH stub `bun` never shadows the runtime itself.
  return `DOCKS_KIT_ENGINE=native '${process.execPath}' '${REPO_DIR}/cli/src/main.ts' ${quoted}`
}

export function runEngine(
  kind: EngineKind,
  args: ReadonlyArray<string>,
  fixture: string,
  stubDir: string,
  opts: { stdinTty?: boolean } = {}
): EngineRun {
  const home = mkdtempSync(join(tmpdir(), `parity-home-${kind}-`))
  rmSync(home, { recursive: true })
  const src = isAbsolute(fixture) ? fixture : join(FIXTURES_DIR, fixture)
  cpSync(src, home, { recursive: true })
  const argvLog = join(home, ".parity-argv.log")
  writeFileSync(argvLog, "")

  const res = spawnSync("bash", ["-c", `exec 2>&1; ${engineCommand(kind, args)}`], {
    cwd: REPO_DIR,
    env: {
      HOME: home,
      PATH: `${stubDir}${delimiter}${process.env["PATH"] ?? ""}`,
      PARITY_ARGV_LOG: argvLog,
      PARITY_STUB_DIR: stubDir,
      LC_ALL: "C",
      TERM: "dumb",
      // env is constructed from scratch (no process.env spread), so engine
      // globals like DRY_RUN can never leak in from the invoking shell.
      AGENTS_DIR: join(home, ".agents")
    },
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

export function snapshotTree(root: string, dir = root, acc: TreeSnapshot = {}): TreeSnapshot {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name)
    const rel = p.slice(root.length + 1)
    if (rel === ".parity-argv.log") continue
    const st = lstatSync(p)
    if (st.isSymbolicLink()) {
      acc[rel] = `link:${readlinkSync(p)}`
    } else if (st.isDirectory()) {
      acc[`${rel}/`] = "dir"
      snapshotTree(root, p, acc)
    } else {
      // Hash with CRLF canonicalized to LF: on Windows the bash engine's jq
      // writes CRLF (text-mode CRT) where EngineNative writes LF — a
      // transport artifact, not a logic divergence the parity gate is for.
      const body = readFileSync(p).toString("binary").replaceAll("\r\n", "\n")
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

export function parseArgs(argv: Array<string>): { native: boolean; proveRed: boolean } {
  return { native: argv.includes("--native"), proveRed: argv.includes("--prove-red") }
}

/**
 * PARITY_FILTER (regex on the pair label) scopes a run to the command
 * surface a partial EngineNative port claims — step 5 gates each commit on
 * exactly its rows. Unset = everything.
 */
export function labelSelected(label: string): boolean {
  const f = process.env["PARITY_FILTER"]
  if (f === undefined || f === "") return true
  return new RegExp(f).test(label)
}

export function banner(msg: string): void {
  console.log(`\n=== ${msg} ===`)
}

/** Write a fixture home variant on the fly (used by the TOML suite). */
export function materializeVariant(base: string, files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), "parity-fixture-"))
  rmSync(dir, { recursive: true })
  cpSync(join(FIXTURES_DIR, base), dir, { recursive: true })
  for (const [rel, content] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, rel)), { recursive: true })
    writeFileSync(join(dir, rel), content)
  }
  return dir
}
