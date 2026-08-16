/**
 * Golden dry-run regression suite.
 *
 * Records normalized EngineNative `sync --dry-run` output per fixture and
 * command. `--prove-red` intentionally compares each run to a mismatched
 * golden and exits non-zero after proving the suite can fail.
 *
 *   bun cli/test/golden-dryrun.ts --update-goldens
 *   bun cli/test/golden-dryrun.ts
 *   bun cli/test/golden-dryrun.ts --prove-red
 */
import { mkdirSync, rmSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"

import { hostOs } from "../src/engine-native/os"
import { banner, labelSelected, parseArgs } from "./lib/goldenCli"
import { cleanup, runEngine, runPublicCli } from "./lib/goldenExecution"
import { REPO_DIR, makeStubDir } from "./lib/goldenResources"
import { diffText, stableStringify } from "./lib/goldenSnapshot"
import { readGolden, selectProveRedMismatch } from "./lib/goldenProveRed"

interface DryRunGolden {
  readonly version: 1
  readonly cases: Record<string, DryRunCaseGolden>
}

interface DryRunCaseGolden {
  readonly fixture: string
  readonly command: ReadonlyArray<string>
  readonly exitCode: number
  readonly output: string
}

const FIXTURES = ["home-fresh", "home-drift", "home-invalid-json"]
const COMMANDS: Array<Array<string>> = [
  ["sync", "--dry-run"],
  ["sync", "claude", "--dry-run"],
  ["sync", "codex", "--dry-run"],
  ["sync", "codex", "--dry-run", "--codex-effort=ultra"],
  ["sync", "agents", "--dry-run"],
  ["sync", "--dry-run", "--reconcile", "--prune"],
  [
    "sync",
    "claude",
    "--dry-run",
    "--claude-model=opus",
    "--claude-effort=low",
    "--claude-advisor=on",
    "--claude-compact-window=680k",
    "--claude-permissive"
  ],
  ["sync", "claude", "--dry-run", "--claude-plugin=supabase"]
]

/**
 * Public-CLI characterization. These rows run the real effect/unstable/cli parser and
 * pin root, help, version, and the read-only listing commands so the Effect v4
 * migration can prove it changed nothing outside the accepted help rendering.
 */
const PUBLIC_COMMANDS: Array<Array<string>> = [
  [],
  ["--help"],
  ["--version"],
  ["docs"],
  ["models"],
  ["plugins", "list"],
  ["skills", "list"],
  ["update", "--help"],
  // These rows pin the kit's argument-rejection diagnostics so they cannot drift.
  ["status", "--no-json"],
  ["update", "--no-no-sync"],
  ["sync", "--bogus", "--claude-model", "opus"]
]
interface DryRunMatrixRow {
  readonly fixture: string
  readonly cmd: Array<string>
  readonly public?: boolean
}

const MATRIX: Array<DryRunMatrixRow> = [
  ...FIXTURES.flatMap((fixture) => COMMANDS.map((cmd) => ({ fixture, cmd }))),
  { fixture: "home-drift", cmd: ["model", "claude"] },
  ...PUBLIC_COMMANDS.map((cmd) => ({ fixture: "home-fresh", cmd, public: true }))
]

const GOLDEN_PATH = join(REPO_DIR, "cli", "test", "goldens", "dryrun.json")
const options = parseArgs(process.argv)
const hostExecutableSuffixes = hostOs().executableSuffixes
if (hostExecutableSuffixes.length !== 1 || !hostExecutableSuffixes.includes("")) {
  console.error(
    "golden-dryrun: unsupported host: snapshots are Linux-canonical and run only in the Linux snapshot lane. On Windows, run `bun run typecheck`, `bun run test:unit`, `bun run test:runtime:windows`, and `bun run smoke:native` instead."
  )
  process.exit(2)
}

function labelFor(fixture: string, cmd: ReadonlyArray<string>, usePublic: boolean): string {
  const channel = usePublic ? "public" : "engine"
  return `cli=${channel} fixture=${fixture} cmd=${cmd.join(" ")}`
}

function runCase(fixture: string, cmd: ReadonlyArray<string>, usePublic = false): DryRunCaseGolden {
  if (usePublic) {
    const run = runPublicCli(cmd, fixture, stubs)
    try {
      return {
        fixture,
        command: [...cmd],
        exitCode: run.exitCode,
        output: `${run.stdout}${run.stderr}`
      }
    } finally {
      rmSync(run.home, { recursive: true, force: true })
    }
  }

  const run = runEngine(cmd, fixture, stubs)
  try {
    return { fixture, command: [...cmd], exitCode: run.exitCode, output: run.output }
  } finally {
    cleanup([run])
  }
}

const matrixLabels = new Set<string>()
for (const { fixture, cmd, public: usePublic = false } of MATRIX) {
  const label = labelFor(fixture, cmd, usePublic)
  if (matrixLabels.has(label)) throw new Error(`duplicate dry-run matrix label ${label}`)
  matrixLabels.add(label)
}
const stubs = makeStubDir()

if (options.updateGoldens) {
  const selectedCases: Record<string, DryRunCaseGolden> = {}
  let selectedChecks = 0
  for (const { fixture, cmd, public: usePublic = false } of MATRIX) {
    const label = labelFor(fixture, cmd, usePublic)
    if (!labelSelected(label, options.filter)) continue
    selectedChecks++
    selectedCases[label] = runCase(fixture, cmd, usePublic)
  }
  if (options.filter !== undefined && selectedChecks === 0) {
    console.error("GOLDEN_FILTER matched no cases")
    process.exit(2)
  }

  const cases =
    options.filter === undefined
      ? selectedCases
      : { ...readGolden<DryRunCaseGolden>(GOLDEN_PATH).cases, ...selectedCases }
  mkdirSync(dirname(GOLDEN_PATH), { recursive: true })
  writeFileSync(GOLDEN_PATH, stableStringify({ version: 1, cases } satisfies DryRunGolden))
  console.log(`golden-dryrun: updated ${Object.keys(selectedCases).length} case(s) at ${GOLDEN_PATH}`)
  process.exit(0)
}

const goldens = readGolden<DryRunCaseGolden>(GOLDEN_PATH)
let failures = 0
let checked = 0
let selectedChecks = 0
const proveRed = options.proveRed ? selectProveRedMismatch(goldens.cases) : undefined

for (const { fixture, cmd, public: usePublic = false } of MATRIX) {
  const label = labelFor(fixture, cmd, usePublic)
  if (!labelSelected(label, options.filter)) continue
  selectedChecks++
  const expected = proveRed?.expectedFor(label) ?? goldens.cases[label]
  if (expected === undefined) {
    failures++
    banner(`MISSING GOLDEN ${label}`)
    console.log("  run with --update-goldens to record this case")
    continue
  }
  const actual = runCase(fixture, cmd, usePublic)
  checked++
  const problems = [
    ...(actual.exitCode === expected.exitCode
      ? []
      : [`  exit codes differ: actual=${actual.exitCode} expected=${expected.exitCode}`]),
    ...diffText("dry-run output", actual.output, expected.output)
  ]
  proveRed?.recordComparison(problems.length > 0)
  if (problems.length > 0) {
    failures++
    banner(`GOLDEN MISMATCH ${label}`)
    for (const p of problems) console.log(p)
  }
}

if (options.filter !== undefined && selectedChecks === 0) {
  console.error("GOLDEN_FILTER matched no cases")
  process.exit(2)
}

if (proveRed !== undefined) {
  const result = proveRed.result()
  if (!result.succeeded) {
    console.error(
      `prove-red FAILED: golden-dryrun compared ${result.comparedCases} case(s) and detected ${result.comparatorMismatches} comparator mismatch(es)`
    )
    process.exit(1)
  }
  console.error(
    `prove-red OK: golden-dryrun compared ${result.comparedCases} case(s) and detected ${result.comparatorMismatches} planted comparator mismatch(es); intentionally exiting 1`
  )
  process.exit(1)
}

if (failures > 0) {
  console.error(`\ngolden-dryrun: ${failures} mismatch(es)`)
  process.exit(1)
}
console.log(`golden-dryrun: OK (${checked} case(s))`)
