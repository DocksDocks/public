/**
 * The CLI entry that spawning suites launch, and the Bun runtime that runs it.
 *
 * Several suites launch the public CLI as a child process. Bun transpiles the
 * entry's whole import graph on every launch, and that graph is 271 modules.
 * Measured warm on a developer machine: 0.13 s per source spawn, against
 * 0.045 s for a prebuilt bundle of the same entry. A full `test:ci` performs
 * about 160 launches. A shared `BUN_RUNTIME_TRANSPILER_CACHE_PATH` recovers
 * 0.01 s of that, because Bun caches only modules above a size threshold.
 * Building the bundle costs 0.03 s. The build runs once per process, or once
 * per `test:unit` run through the shared entry below. It never reuses an
 * earlier run's bundle, so the child can never execute stale source.
 *
 * The bundle is written inside the checkout, under `cli/dist-test/`.
 * `kitHome()` resolves the kit by walking up from `import.meta.dir`. The walk
 * stops at the nearest `package.json` named `docks-kit`. At this depth it
 * lands on the repository root, exactly as it does from `cli/src/main.ts`.
 * A bundle in a temporary directory would resolve through the environment
 * source or the working-directory fallback instead. The child would then
 * exercise a resolution the shipped CLI never performs.
 *
 * Source mode stays reachable and stays covered. Set `DOCKS_KIT_TEST_CLI_ENTRY`
 * to `cli/src/main.ts` to run every spawning suite against the TypeScript
 * entry. Use the same variable to read a real stack trace, because the bundle
 * carries no source map. `payload.test.ts` boots the source entry on every
 * run. `smoke:package` runs the published source entry out of an installed
 * tarball, and `smoke:native` runs the compiled binary.
 */
import { spawnSync } from "node:child_process"
import { existsSync, mkdirSync, rmdirSync, rmSync } from "node:fs"
import { delimiter, join, resolve } from "node:path"

import { hostOs } from "../../src/engine-native/os"
import { REPO_DIR } from "./goldenResources"

/** Env var naming the entry to spawn; set by the shared build, or by hand. */
export const CLI_ENTRY_ENV = "DOCKS_KIT_TEST_CLI_ENTRY"

export const SOURCE_CLI_ENTRY = join(REPO_DIR, "cli", "src", "main.ts")

const BUILD_DIR = join(REPO_DIR, "cli", "dist-test")

function locateBunRuntime(): string {
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

export const BUN_RUNTIME = locateBunRuntime()

/**
 * Bundle the CLI to `outFile`. Returns the path so a caller can hand it to a
 * child. A build failure throws with the bundler's own output: a silent
 * fallback to source would hide a bundling defect behind a slow green run.
 */
export function buildCliEntry(outFile: string): string {
  mkdirSync(BUILD_DIR, { recursive: true })
  const result = spawnSync(
    BUN_RUNTIME,
    ["build", SOURCE_CLI_ENTRY, "--target", "bun", "--outfile", outFile],
    { cwd: REPO_DIR, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }
  )
  if (result.error !== undefined) {
    throw new Error(`bundling ${SOURCE_CLI_ENTRY} failed to spawn: ${String(result.error)}`)
  }
  if (result.status !== 0 || !existsSync(outFile)) {
    const detail = [result.stdout, result.stderr].filter(Boolean).join("\n").trim()
    throw new Error(`bundling ${SOURCE_CLI_ENTRY} failed (exit ${String(result.status)}):\n${detail}`)
  }
  return outFile
}

/** Path for a bundle owned by one process; the pid keeps parallel workers apart. */
export const processCliEntryPath = (): string => join(BUILD_DIR, `main-${process.pid}.js`)

/**
 * Remove a bundle, then the build directory when it holds nothing else.
 * A parallel worker may own a sibling bundle, so the directory removal is
 * non-recursive and its failure means "still in use".
 */
export function removeCliEntry(outFile: string): void {
  rmSync(outFile, { force: true })
  try {
    rmdirSync(BUILD_DIR)
  } catch {
    // another process still owns a bundle here
  }
}

let entry: string | undefined

/**
 * The entry to spawn, built at most once per process. A shared entry named in
 * the environment wins, so the unit run builds one bundle for every worker.
 */
export function cliEntry(): string {
  if (entry !== undefined) return entry
  const shared = process.env[CLI_ENTRY_ENV]
  if (shared !== undefined && shared !== "") {
    if (!existsSync(shared)) {
      throw new Error(`${CLI_ENTRY_ENV} names '${shared}', which does not exist`)
    }
    entry = shared
    return entry
  }
  const owned = processCliEntryPath()
  buildCliEntry(owned)
  process.on("exit", () => removeCliEntry(owned))
  entry = owned
  return entry
}
