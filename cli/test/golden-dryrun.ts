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
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { banner, labelSelected, parseArgs } from "./lib/goldenCli"
import { cleanup, runEngine, runPublicCli } from "./lib/goldenExecution"
import { REPO_DIR, makeStubDir } from "./lib/goldenResources"
import { diffText, stableStringify } from "./lib/goldenSnapshot"

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
  readonly label?: string
  readonly public?: boolean
}

const MATRIX: Array<DryRunMatrixRow> = [
  ...FIXTURES.flatMap((fixture) => COMMANDS.map((cmd) => ({ fixture, cmd }))),
  { fixture: "home-drift", cmd: ["model", "claude"] },
  ...PUBLIC_COMMANDS.map((cmd) => ({ fixture: "home-fresh", cmd, public: true }))
]

const GOLDEN_PATH = join(REPO_DIR, "cli", "test", "goldens", "dryrun.json")
const options = parseArgs(process.argv)
const stubs = makeStubDir()

function labelFor(fixture: string, cmd: ReadonlyArray<string>, label?: string): string {
  const prefix = label === undefined ? "" : `case=${label} `
  return `${prefix}fixture=${fixture} cmd=${cmd.join(" ")}`
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

  const run = runEngine("native", cmd, fixture, stubs)
  try {
    return { fixture, command: [...cmd], exitCode: run.exitCode, output: run.output }
  } finally {
    cleanup([run])
  }
}

function readGoldens(): DryRunGolden {
  if (!existsSync(GOLDEN_PATH)) {
    console.error(`${GOLDEN_PATH} does not exist; run with --update-goldens first`)
    process.exit(1)
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(readFileSync(GOLDEN_PATH, "utf8"))
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    throw new Error(`${GOLDEN_PATH}: malformed golden JSON: ${message}`)
  }
  if (
    typeof parsed !== "object" ||
    parsed === null ||
    Array.isArray(parsed) ||
    !("version" in parsed) ||
    parsed.version !== 1 ||
    !("cases" in parsed) ||
    typeof parsed.cases !== "object" ||
    parsed.cases === null ||
    Array.isArray(parsed.cases)
  ) {
    throw new Error(`${GOLDEN_PATH}: expected a version-1 object with object-valued cases`)
  }
  return parsed as DryRunGolden
}

function mismatchedGolden(label: string, goldens: DryRunGolden): DryRunCaseGolden {
  const other = Object.keys(goldens.cases).find((candidate) => candidate !== label)
  if (other === undefined) throw new Error("prove-red needs at least two golden cases")
  return goldens.cases[other]!
}

if (options.updateGoldens) {
  const selectedCases: Record<string, DryRunCaseGolden> = {}
  let selectedChecks = 0
  for (const { fixture, cmd, label: caseLabel, public: usePublic } of MATRIX) {
    const label = labelFor(fixture, cmd, caseLabel)
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
      : { ...readGoldens().cases, ...selectedCases }
  mkdirSync(dirname(GOLDEN_PATH), { recursive: true })
  writeFileSync(GOLDEN_PATH, stableStringify({ version: 1, cases } satisfies DryRunGolden))
  console.log(`golden-dryrun: updated ${Object.keys(selectedCases).length} case(s) at ${GOLDEN_PATH}`)
  process.exit(0)
}

const goldens = readGoldens()
let failures = 0
let checked = 0
let selectedChecks = 0

for (const { fixture, cmd, label: caseLabel, public: usePublic } of MATRIX) {
  const label = labelFor(fixture, cmd, caseLabel)
  if (!labelSelected(label, options.filter)) continue
  selectedChecks++
  const expected = options.proveRed ? mismatchedGolden(label, goldens) : goldens.cases[label]
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

if (options.proveRed) {
  if (failures === 0) {
    console.error("prove-red FAILED: golden-dryrun did not detect the planted mismatch")
    process.exit(1)
  }
  console.error(`prove-red OK: golden-dryrun detected ${failures} planted mismatch(es); intentionally exiting 1`)
  process.exit(1)
}

if (failures > 0) {
  console.error(`\ngolden-dryrun: ${failures} mismatch(es)`)
  process.exit(1)
}
console.log(`golden-dryrun: OK (${checked} case(s))`)
