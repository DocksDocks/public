/**
 * Deterministic subprocess execution for golden regressions.
 */
import { spawnSync, type SpawnSyncReturns } from "node:child_process"
import {
  copyFileSync,
  cpSync,
  existsSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync
} from "node:fs"
import { delimiter, isAbsolute, join, resolve } from "node:path"

import { FIXTURES_DIR, REPO_DIR, temporaryDir } from "./goldenResources"
import { normalizeOutput } from "./goldenSnapshot"


function bunRuntime(): string {
  if (process.versions["bun"] !== undefined) return resolve(process.execPath)
  for (const directory of (process.env["PATH"] ?? "").split(delimiter)) {
    const candidate = join(directory, "bun")
    if (existsSync(candidate)) return resolve(candidate)
  }
  throw new Error("unable to locate the Bun runtime")
}

const BUN_RUNTIME = bunRuntime()
const BUN_INSTALL_CACHE_DIR = temporaryDir("golden-bun-cache-")

export interface EngineRun {
  readonly exitCode: number
  readonly output: string
  /** Alias for ordered merged output; retained for focused assertions. */
  readonly stdout: string
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

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`
}

function engineCommand(kind: EngineKind, args: ReadonlyArray<string>): string {
  const quotedArgs = args.map(shellQuote).join(" ")
  void kind
  // Raw harness channel (bypasses effect/unstable/cli so tests drive the engine's
  // internal argv directly); absolute bun path so the PATH stub `bun` never
  // shadows the runtime.
  const command =
    `DOCKS_KIT_ENGINE=native-raw exec ${shellQuote(BUN_RUNTIME)} ` +
    `${shellQuote(join(REPO_DIR, "cli", "src", "main.ts"))}`
  return quotedArgs === "" ? command : `${command} ${quotedArgs}`
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
  const holdsMasked = (dir: string): boolean =>
    dir !== "" && names.some((name) => existsSync(join(dir, name)))
  return dirs.map((dir) => (holdsMasked(dir) ? shadowDir(dir, names) : dir)).join(delimiter)
}

function shadowDir(dir: string, names: ReadonlyArray<string>): string {
  const shadow = temporaryDir("golden-mask-")
  const blocked = new Set(names)
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
  const source = isAbsolute(fixture) ? fixture : join(FIXTURES_DIR, fixture)
  cpSync(source, home, { recursive: true })
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
    BUN_INSTALL_CACHE_DIR,
    // env is constructed from scratch (no process.env spread), so engine
    // globals like DRY_RUN can never leak in from the invoking shell.
    AGENTS_DIR: join(home, ".agents"),
    ...(opts.env ?? {}),
    DOCKS_KIT_SYNC_CONCURRENCY: "1"
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

  const command = `exec 2>&1; ${engineCommand(kind, args)}`
  const result = spawnSync("bash", ["-c", command], {
    cwd: REPO_DIR,
    env: runEnv(home, stubDir, argvLog, opts),
    stdio: [opts.stdinTty ? "inherit" : "ignore", "pipe", "pipe"],
    encoding: "utf8",
    timeout: 120_000
  })
  const output = normalizeOutput(result.stdout ?? "", home, stubDir)
  return {
    exitCode: checkedSpawnExitCode(command, result),
    output,
    stdout: output,
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
  const command = engineCommand(kind, args)
  const result = spawnSync("bash", ["-c", command], {
    cwd: REPO_DIR,
    env: runEnv(home, stubDir, argvLog, opts),
    stdio: ["ignore", "pipe", "pipe"],
    encoding: "utf8",
    timeout: 120_000
  })
  return {
    exitCode: checkedSpawnExitCode(command, result),
    stdout: normalizeOutput(result.stdout ?? "", home, stubDir),
    stderr: normalizeOutput(result.stderr ?? "", home, stubDir),
    home
  }
}

/**
 * Run the PUBLIC CLI (effect/unstable/cli path — no DOCKS_KIT_ENGINE bypass) with
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
  const quotedArgs = args.map(shellQuote).join(" ")
  const command =
    `exec ${shellQuote(BUN_RUNTIME)} ${shellQuote(join(REPO_DIR, "cli", "src", "main.ts"))}` +
    (quotedArgs === "" ? "" : ` ${quotedArgs}`)
  const result = spawnSync("bash", ["-c", command], {
    cwd: REPO_DIR,
    env: runEnv(home, stubDir, argvLog, opts),
    stdio: ["ignore", "pipe", "pipe"],
    encoding: "utf8",
    timeout: 120_000
  })
  return {
    exitCode: checkedSpawnExitCode(command, result),
    stdout: normalizeOutput(result.stdout ?? "", home, stubDir),
    stderr: normalizeOutput(result.stderr ?? "", home, stubDir),
    home
  }
}

export function readArgvLog(run: EngineRun): string {
  return existsSync(run.argvLog) ? readFileSync(run.argvLog, "utf8") : ""
}

export function cleanup(runs: Array<EngineRun>): void {
  for (const run of runs) rmSync(run.home, { recursive: true, force: true })
}

export function checkedSpawnExitCode(
  command: string,
  result: Pick<SpawnSyncReturns<string>, "status" | "signal" | "error">
): number {
  if (typeof result.status === "number") return result.status
  if (result.error !== undefined) throw new Error(`${command} failed to spawn: ${String(result.error)}`)
  if (result.signal !== null) throw new Error(`${command} terminated by signal ${result.signal}`)
  throw new Error(`${command} completed without status or signal`)
}
