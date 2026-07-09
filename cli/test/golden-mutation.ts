/**
 * Golden mutation regression suite.
 *
 * Executes real EngineNative commands against disposable fixture HOMEs with
 * external tools stubbed. Each golden records the resulting HOME tree, child
 * argv log, normalized output, and exit code. `--prove-red` intentionally
 * compares each run to a mismatched golden and exits non-zero after proving the
 * suite can fail.
 *
 *   bun cli/test/golden-mutation.ts --update-goldens
 *   bun cli/test/golden-mutation.ts
 *   bun cli/test/golden-mutation.ts --prove-red
 */
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import {
  FIXTURES_DIR,
  REPO_DIR,
  banner,
  cleanup,
  diffText,
  diffTrees,
  labelSelected,
  makeStubDir,
  materializeVariant,
  parseArgs,
  readArgvLog,
  runEngine,
  snapshotTree,
  stableStringify,
  type TreeSnapshot
} from "./lib/harness"

interface MutationGolden {
  readonly version: 1
  readonly cases: Record<string, MutationCaseGolden>
}

interface MutationCaseGolden {
  readonly command: ReadonlyArray<string>
  readonly exitCode: number
  readonly tree: TreeSnapshot
  readonly argvLog: string
  readonly output: string
}

// Stub-body variants for toolchain gate/install/upgrade/failure branches.
const RTK_INIT_FAILS = `case "$1" in --version) echo "rtk 0.43.0";; init) exit 1;; esac`
const AGENT_BROWSER_STALE = `case "$1" in --version) echo "agent-browser 0.30.0";; esac`
const NPM_INSTALL_FAILS = `case "$1" in
  view) case "$2" in agent-browser) echo "0.31.1";; esac;;
  install) exit 1;;
esac`
const NPM_LATEST_ABOVE_VERIFIED = `case "$1" in
  view) case "$2" in agent-browser) echo "0.99.0";; esac;;
esac`
const NPM_OFFLINE = `case "$1" in view) exit 1;; esac`

const MATRIX: Array<{ fixture: string; cmd: Array<string>; stubs?: Record<string, string | null> }> = [
  { fixture: "home-fresh", cmd: ["sync", "claude"] },
  { fixture: "home-fresh", cmd: ["sync", "codex"] },
  { fixture: "home-fresh", cmd: ["sync", "agents"] },
  { fixture: "home-drift", cmd: ["sync", "claude"] },
  { fixture: "home-drift", cmd: ["sync", "codex"] },
  { fixture: "home-drift", cmd: ["sync", "agents"] },
  { fixture: "home-drift", cmd: ["sync", "--reconcile"] },
  { fixture: "home-drift", cmd: ["sync", "--prune"] },
  { fixture: "home-drift", cmd: ["sync", "claude", "--claude-plugin=supabase,n8n"] },
  {
    fixture: "home-drift",
    cmd: ["sync", "claude", "--claude-model=fable", "--claude-compact-window=680k", "--claude-permissive"]
  },
  { fixture: "home-drift", cmd: ["model", "claude", "opus"] },
  { fixture: "home-drift", cmd: ["model", "claude", "default"] },
  { fixture: "home-drift", cmd: ["model", "codex", "gpt-5.5"] },
  { fixture: "home-invalid-json", cmd: ["sync", "claude"] },
  { fixture: "home-fresh", cmd: ["toolchain", "ensure", "agent-browser"] },
  { fixture: "home-fresh", cmd: ["toolchain", "ensure", "effect-solutions", "--yes"] },
  { fixture: "home-fresh", cmd: ["toolchain", "check"] },
  { fixture: "home-fresh", cmd: ["sync", "claude"], stubs: { rtk: RTK_INIT_FAILS } },
  { fixture: "home-fresh", cmd: ["sync", "claude"], stubs: { claude: null } },
  { fixture: "home-fresh", cmd: ["sync", "codex"], stubs: { codex: null } },
  { fixture: "home-fresh", cmd: ["toolchain", "ensure", "agent-browser"], stubs: { "agent-browser": AGENT_BROWSER_STALE } },
  { fixture: "home-fresh", cmd: ["toolchain", "ensure", "agent-browser"], stubs: { "agent-browser": null, npm: NPM_INSTALL_FAILS } },
  { fixture: "home-fresh", cmd: ["toolchain", "ensure", "agent-browser"], stubs: { npm: NPM_LATEST_ABOVE_VERIFIED } },
  { fixture: "home-fresh", cmd: ["toolchain", "ensure", "agent-browser", "--yes"], stubs: { npm: NPM_LATEST_ABOVE_VERIFIED } },
  { fixture: "home-fresh", cmd: ["toolchain", "ensure", "agent-browser"], stubs: { npm: NPM_OFFLINE } }
]

const TOML_DIR = join(FIXTURES_DIR, "codex-toml")
const TOML_SHAPES = [
  "01-top-level-comments.toml",
  "02-first-table-insert.toml",
  "03-features-only-landlock.toml",
  "04-features-extra-keys.toml",
  "05-user-tables.toml",
  "06-sot-table-replace.toml",
  "07-dotted-quoted-headers.toml"
]

const GOLDEN_PATH = join(REPO_DIR, "cli", "test", "goldens", "mutation.json")
const { proveRed, updateGoldens } = parseArgs(process.argv)
const defaultStubs = makeStubDir()

function matrixLabel(fixture: string, cmd: ReadonlyArray<string>, stubs?: Record<string, string | null>): string {
  return `fixture=${fixture} cmd=${cmd.join(" ")}${stubs !== undefined ? ` stubs=${Object.keys(stubs).join(",")}` : ""}`
}

function runCase(
  command: ReadonlyArray<string>,
  fixture: string,
  stubDir: string,
  maskTools: ReadonlyArray<string> = []
): MutationCaseGolden {
  const run = runEngine("native", command, fixture, stubDir, { maskTools })
  const golden = {
    command: [...command],
    exitCode: run.exitCode,
    tree: snapshotTree(run.home),
    argvLog: readArgvLog(run),
    output: run.output
  }
  cleanup([run])
  return golden
}

function readGoldens(): MutationGolden {
  if (!existsSync(GOLDEN_PATH)) {
    console.error(`${GOLDEN_PATH} does not exist; run with --update-goldens first`)
    process.exit(1)
  }
  return JSON.parse(readFileSync(GOLDEN_PATH, "utf8")) as MutationGolden
}

function mismatchedGolden(label: string, goldens: MutationGolden): MutationCaseGolden {
  const other = Object.keys(goldens.cases).find((candidate) => candidate !== label)
  if (other === undefined) throw new Error("prove-red needs at least two golden cases")
  return goldens.cases[other]!
}

function compareCase(label: string, actual: MutationCaseGolden, expected: MutationCaseGolden): Array<string> {
  return [
    ...(actual.exitCode === expected.exitCode
      ? []
      : [`  exit codes differ: actual=${actual.exitCode} expected=${expected.exitCode}`]),
    ...diffTrees(expected.tree, actual.tree),
    ...diffText("argv log", actual.argvLog, expected.argvLog),
    ...diffText("output", actual.output, expected.output)
  ]
}

function tomlInvariantProblems(shape: string, fixtureHome: string): Array<string> {
  const configPath = join(fixtureHome, ".codex", "config.toml")
  const problems: Array<string> = []
  if (!existsSync(configPath)) return ["  invariant: config.toml missing"]
  const result = readFileSync(configPath, "utf8")
  if (result.includes("use_legacy_landlock")) {
    problems.push("  invariant: deprecated use_legacy_landlock survived the scrub")
  }
  if (!existsSync(join(fixtureHome, ".codex", "config.toml.bak"))) {
    problems.push("  invariant: config.toml.bak backup missing")
  }
  const topLevel = result.split(/^\[/m)[0] ?? ""
  if ((topLevel.match(/^model[ \t]*=/gm) ?? []).length !== 1) {
    problems.push("  invariant: top-level model line count != 1")
  }
  if (readFileSync(join(TOML_DIR, shape), "utf8").includes("[user_only.table]") && !result.includes("[user_only.table]")) {
    problems.push("  invariant: user-only table was destroyed")
  }
  return problems
}

function runTomlCase(shape: string, command: ReadonlyArray<string>, assertInvariants: boolean): MutationCaseGolden & { problems: Array<string> } {
  const variant = materializeVariant("home-fresh", {
    ".codex/config.toml": readFileSync(join(TOML_DIR, shape), "utf8")
  })
  const run = runEngine("native", command, variant, defaultStubs)
  const problems = assertInvariants ? tomlInvariantProblems(shape, run.home) : []
  const golden = {
    command: [...command],
    exitCode: run.exitCode,
    tree: snapshotTree(run.home),
    argvLog: readArgvLog(run),
    output: run.output,
    problems
  }
  cleanup([run])
  rmSync(variant, { recursive: true, force: true })
  return golden
}

function collectCases(): { cases: Record<string, MutationCaseGolden>; invariantFailures: number } {
  const cases: Record<string, MutationCaseGolden> = {}
  let invariantFailures = 0

  for (const { fixture, cmd, stubs } of MATRIX) {
    const label = matrixLabel(fixture, cmd, stubs)
    if (!labelSelected(label)) continue
    const stubDir = stubs !== undefined ? makeStubDir(stubs) : defaultStubs
    const maskTools = stubs !== undefined ? Object.entries(stubs).filter(([, body]) => body === null).map(([name]) => name) : []
    cases[label] = runCase(cmd, fixture, stubDir, maskTools)
  }

  for (const shape of TOML_SHAPES) {
    const syncLabel = `toml=${shape}`
    if (labelSelected(syncLabel)) {
      const { problems, ...golden } = runTomlCase(shape, ["sync", "codex"], true)
      cases[syncLabel] = golden
      if (problems.length > 0) {
        invariantFailures++
        banner(`TOML INVARIANT FAILURE shape=${shape}`)
        for (const p of problems) console.log(p)
      }
    }

    const modelLabel = `toml=${shape} model codex`
    if (labelSelected(modelLabel)) {
      const { problems: _, ...golden } = runTomlCase(shape, ["model", "codex", "gpt-5.5"], false)
      cases[modelLabel] = golden
    }
  }

  return { cases, invariantFailures }
}

if (updateGoldens) {
  const { cases, invariantFailures } = collectCases()
  if (invariantFailures > 0) {
    console.error(`\ngolden-mutation: ${invariantFailures} TOML invariant failure(s); goldens not updated`)
    process.exit(1)
  }
  mkdirSync(dirname(GOLDEN_PATH), { recursive: true })
  writeFileSync(GOLDEN_PATH, stableStringify({ version: 1, cases } satisfies MutationGolden))
  console.log(`golden-mutation: updated ${Object.keys(cases).length} case(s) at ${GOLDEN_PATH}`)
  process.exit(0)
}

const goldens = readGoldens()
const { cases: actualCases, invariantFailures } = collectCases()
let failures = invariantFailures
let checked = 0

for (const [label, actual] of Object.entries(actualCases)) {
  const expected = proveRed ? mismatchedGolden(label, goldens) : goldens.cases[label]
  if (expected === undefined) {
    failures++
    banner(`MISSING GOLDEN ${label}`)
    console.log("  run with --update-goldens to record this case")
    continue
  }
  checked++
  const problems = compareCase(label, actual, expected)
  if (problems.length > 0) {
    failures++
    banner(`GOLDEN MISMATCH ${label}`)
    for (const p of problems) console.log(p)
  }
}

if (proveRed) {
  if (failures === 0) {
    console.error("prove-red FAILED: golden-mutation did not detect the planted mismatch")
    process.exit(1)
  }
  console.error(`prove-red OK: golden-mutation detected ${failures} planted mismatch(es); intentionally exiting 1`)
  process.exit(1)
}

if (failures > 0) {
  console.error(`\ngolden-mutation: ${failures} mismatch(es)`)
  process.exit(1)
}
console.log(`golden-mutation: OK (${checked} case(s))`)
