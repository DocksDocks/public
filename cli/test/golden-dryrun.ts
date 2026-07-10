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
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import {
  REPO_DIR,
  banner,
  cleanup,
  diffText,
  labelSelected,
  makeStubDir,
  parseArgs,
  runEngine,
  stableStringify
} from "./lib/harness"

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
  ["sync", "agents", "--dry-run"],
  ["sync", "--dry-run", "--reconcile", "--prune"],
  ["sync", "claude", "--dry-run", "--claude-model=fable", "--claude-compact-window=680k", "--claude-permissive"],
  ["sync", "claude", "--dry-run", "--claude-plugin=supabase"]
]
const MATRIX: Array<{ fixture: string; cmd: Array<string> }> = [
  ...FIXTURES.flatMap((fixture) => COMMANDS.map((cmd) => ({ fixture, cmd }))),
  { fixture: "home-drift", cmd: ["model", "claude"] }
]

const GOLDEN_PATH = join(REPO_DIR, "cli", "test", "goldens", "dryrun.json")
const { proveRed, updateGoldens } = parseArgs(process.argv)
const stubs = makeStubDir()

function labelFor(fixture: string, cmd: ReadonlyArray<string>): string {
  return `fixture=${fixture} cmd=${cmd.join(" ")}`
}

function runCase(fixture: string, cmd: ReadonlyArray<string>): DryRunCaseGolden {
  const run = runEngine("native", cmd, fixture, stubs)
  const golden = { fixture, command: [...cmd], exitCode: run.exitCode, output: run.output }
  cleanup([run])
  return golden
}

function readGoldens(): DryRunGolden {
  if (!existsSync(GOLDEN_PATH)) {
    console.error(`${GOLDEN_PATH} does not exist; run with --update-goldens first`)
    process.exit(1)
  }
  return JSON.parse(readFileSync(GOLDEN_PATH, "utf8")) as DryRunGolden
}

function mismatchedGolden(label: string, goldens: DryRunGolden): DryRunCaseGolden {
  const other = Object.keys(goldens.cases).find((candidate) => candidate !== label)
  if (other === undefined) throw new Error("prove-red needs at least two golden cases")
  return goldens.cases[other]!
}

if (updateGoldens) {
  const cases: Record<string, DryRunCaseGolden> = {}
  for (const { fixture, cmd } of MATRIX) {
    const label = labelFor(fixture, cmd)
    if (!labelSelected(label)) continue
    cases[label] = runCase(fixture, cmd)
  }
  mkdirSync(dirname(GOLDEN_PATH), { recursive: true })
  writeFileSync(GOLDEN_PATH, stableStringify({ version: 1, cases } satisfies DryRunGolden))
  console.log(`golden-dryrun: updated ${Object.keys(cases).length} case(s) at ${GOLDEN_PATH}`)
  process.exit(0)
}

const goldens = readGoldens()
let failures = 0
let checked = 0

for (const { fixture, cmd } of MATRIX) {
  const label = labelFor(fixture, cmd)
  if (!labelSelected(label)) continue
  const expected = proveRed ? mismatchedGolden(label, goldens) : goldens.cases[label]
  if (expected === undefined) {
    failures++
    banner(`MISSING GOLDEN ${label}`)
    console.log("  run with --update-goldens to record this case")
    continue
  }
  const actual = runCase(fixture, cmd)
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

if (proveRed) {
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
