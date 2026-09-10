/**
 * Deterministic subprocess execution for golden regressions.
 */
import { spawnSync, type SpawnSyncReturns } from "node:child_process"
import {
  closeSync,
  copyFileSync,
  cpSync,
  existsSync,
  openSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync
} from "node:fs"
import { delimiter, isAbsolute, join, resolve } from "node:path"

import { hostOs } from "../../src/engine-native/os"

import { FIXTURES_DIR, REPO_DIR, childHostId, readStubHost, temporaryDir } from "./goldenResources"
import { normalizeOutput } from "./goldenSnapshot"


function bunRuntime(): string {
  if (process.versions["bun"] !== undefined) return resolve(process.execPath)
  const { executableSuffixes } = hostOs()
  for (const directory of (process.env["PATH"] ?? "").split(delimiter)) {
    for (const suffix of executableSuffixes) {
      const candidate = join(directory, `bun${suffix}`)
      if (existsSync(candidate)) return resolve(candidate)
    }
  }
  throw new Error("unable to locate the Bun runtime")
}

const BUN_RUNTIME = bunRuntime()
const BUN_MAIN = join(REPO_DIR, "cli", "src", "main.ts")
const BUN_CLI_ARGS: ReadonlyArray<string> = [
  "--preload",
  join(REPO_DIR, "cli", "test", "lib", "goldenPlatform.ts"),
  BUN_MAIN
]
const BUN_INSTALL_CACHE_DIR = temporaryDir("golden-bun-cache-")
const BUN_RUNTIME_TRANSPILER_CACHE_PATH = temporaryDir("golden-bun-transpiler-")

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
  const blockedNames = names.flatMap((name) =>
    hostOs().executableSuffixes.map((suffix) => `${name}${suffix}`.toLowerCase())
  )
  const blocked = new Set(blockedNames)
  const holdsMasked = (dir: string): boolean =>
    dir !== "" && blockedNames.some((name) => existsSync(join(dir, name)))
  return dirs.map((dir) => (holdsMasked(dir) ? shadowDir(dir, blocked) : dir)).join(delimiter)
}

function shadowDir(dir: string, blocked: ReadonlySet<string>): string {
  const shadow = temporaryDir("golden-mask-")
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
  readonly maskTools?: ReadonlyArray<string>
  /** Run against an existing HOME (sequential replay) instead of materializing the fixture. */
  readonly reuseHome?: string
  /** Extra env for the child (e.g. DOCKS_KIT_VERBOSE). */
  readonly env?: Record<string, string>
  /** Exercise the recording host instead of the Linux-canonical golden preload. */
  readonly nativeHost?: boolean
}

function childArgv(args: ReadonlyArray<string>, opts: RunOpts): Array<string> {
  return [...(opts.nativeHost === true ? [BUN_MAIN] : BUN_CLI_ARGS), ...args]
}

/**
 * The stub directory and the child must agree on one host: a Linux-preloaded
 * child resolves extensionless names, a native Windows child resolves `.cmd`.
 * `makeStubDir` records the host it planted for, so a mismatched pair fails
 * here with a named cause instead of as an unreproducible tool-missing branch
 * on one runner.
 */
function requirePairedStubHost(stubDir: string, opts: RunOpts): void {
  const expected = childHostId(opts.nativeHost === true)
  const planted = readStubHost(stubDir)
  if (planted !== expected) {
    throw new Error(
      `stub host mismatch: stubs were planted for ${planted} but this child runs as ${expected}. ` +
        `Pass the same options object to makeStubDir and to the run helper.`
    )
  }
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
    USERPROFILE: home,
    PATH: `${stubDir}${delimiter}${maskedPath(opts.maskTools ?? [])}`,
    GOLDEN_ARGV_LOG: argvLog,
    GOLDEN_STUB_DIR: stubDir,
    LC_ALL: "C",
    TERM: "dumb",
    // The native side runs under the bun runtime, which would otherwise drop
    // both its install cache and its >50KB transpiler cache inside the temp
    // HOME and pollute the tree diff. The transpiler cache is keyed by source
    // content, so leaving it in HOME makes every golden depend on the current
    // bytes of sotPayload.ts.
    BUN_INSTALL_CACHE_DIR,
    BUN_RUNTIME_TRANSPILER_CACHE_PATH,
    // env is constructed from scratch (no process.env spread), so engine
    // globals like DRY_RUN can never leak in from the invoking shell.
    AGENTS_DIR: join(home, ".agents"),
    ...(opts.env ?? {}),
    DOCKS_KIT_SYNC_CONCURRENCY: "1"
  }
}

export function runEngine(
  args: ReadonlyArray<string>,
  fixture: string,
  stubDir: string,
  opts: RunOpts = {}
): EngineRun {
  requirePairedStubHost(stubDir, opts)
  const home = materializeHome("native", fixture, opts.reuseHome)
  const argvLog = join(home, ".golden-argv.log")
  writeFileSync(argvLog, "")

  const argv = childArgv(args, opts)
  const command = [BUN_RUNTIME, ...argv].join(" ")
  const mergedOutputPath = join(home, ".golden-merged-output")
  const mergedOutputFd = openSync(mergedOutputPath, "w")
  let result: SpawnSyncReturns<string>
  try {
    result = spawnSync(BUN_RUNTIME, argv, {
      cwd: REPO_DIR,
      env: {
        ...runEnv(home, stubDir, argvLog, opts),
        DOCKS_KIT_ENGINE: "native-raw"
      },
      stdio: ["ignore", mergedOutputFd, mergedOutputFd],
      encoding: "utf8",
      timeout: 120_000
    })
  } finally {
    closeSync(mergedOutputFd)
  }
  const output = normalizeOutput(readFileSync(mergedOutputPath, "utf8"), home, stubDir)
  rmSync(mergedOutputPath, { force: true })
  return {
    exitCode: checkedSpawnExitCode(command, result),
    output,
    stdout: output,
    home,
    argvLog
  }
}

/**
 * Channel-aware variant of runEngine: stdout and stderr stay on separate
 * pipes. Cross-channel interleaving order is NOT guaranteed here — use for
 * channel-purity invariants, not ordered goldens.
 */
export function runEngineSplit(
  args: ReadonlyArray<string>,
  fixture: string,
  stubDir: string,
  opts: RunOpts = {}
): SplitRun {
  requirePairedStubHost(stubDir, opts)
  const home = materializeHome("native", fixture, opts.reuseHome)
  const argvLog = join(home, ".golden-argv.log")
  writeFileSync(argvLog, "")
  const argv = childArgv(args, opts)
  const command = [BUN_RUNTIME, ...argv].join(" ")
  const result = spawnSync(BUN_RUNTIME, argv, {
    cwd: REPO_DIR,
    env: {
      ...runEnv(home, stubDir, argvLog, opts),
      DOCKS_KIT_ENGINE: "native-raw"
    },
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
  requirePairedStubHost(stubDir, opts)
  const home = materializeHome("cli", fixture, opts.reuseHome)
  const argvLog = join(home, ".golden-argv.log")
  writeFileSync(argvLog, "")
  const argv = childArgv(args, opts)
  const command = [BUN_RUNTIME, ...argv].join(" ")
  const result = spawnSync(BUN_RUNTIME, argv, {
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
  return readFileSync(run.argvLog, "utf8")
}

export function cleanup(runs: Array<EngineRun>): void {
  for (const run of runs) rmSync(run.home, { recursive: true, force: true })
}

export function checkedSpawnExitCode(
  command: string,
  result: Pick<SpawnSyncReturns<string>, "status" | "signal" | "error">
): number {
  if (result.error !== undefined) {
    const code = "code" in result.error ? result.error.code : undefined
    if (code === "ETIMEDOUT") throw new Error(`${command} timed out: ${String(result.error)}`)
    throw new Error(`${command} failed to spawn: ${String(result.error)}`)
  }
  if (typeof result.status === "number") return result.status
  if (result.signal !== null) throw new Error(`${command} terminated by signal ${result.signal}`)
  throw new Error(`${command} completed without status or signal`)
}
