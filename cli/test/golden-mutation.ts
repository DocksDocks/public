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
  runEngineSplit,
  runPublicCli,
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

// `variant` disambiguates rows whose fixture+cmd+stub-keys are identical but
// whose stub BODIES differ — without it their labels collide and the later
// row silently overwrites the earlier one's golden.
const MATRIX: Array<{ fixture: string; cmd: Array<string>; stubs?: Record<string, string | null>; variant?: string }> = [
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
  { fixture: "home-fresh", cmd: ["toolchain", "ensure", "agent-browser", "--verbose"] },
  { fixture: "home-fresh", cmd: ["toolchain", "ensure", "effect-solutions", "--yes"] },
  { fixture: "home-fresh", cmd: ["toolchain", "check"] },
  { fixture: "home-fresh", cmd: ["sync", "claude"], stubs: { rtk: RTK_INIT_FAILS } },
  { fixture: "home-fresh", cmd: ["sync", "claude"], stubs: { claude: null } },
  { fixture: "home-fresh", cmd: ["sync", "codex"], stubs: { codex: null } },
  // Missing-git trio: uniform hint-bearing warn from the dependency registry;
  // the combined run must emit exactly ONE deduplicated git warn.
  { fixture: "home-fresh", cmd: ["sync", "claude"], stubs: { git: null } },
  { fixture: "home-fresh", cmd: ["sync", "codex"], stubs: { git: null } },
  { fixture: "home-fresh", cmd: ["sync"], stubs: { git: null } },
  { fixture: "home-fresh", cmd: ["toolchain", "ensure", "agent-browser"], stubs: { "agent-browser": AGENT_BROWSER_STALE } },
  { fixture: "home-fresh", cmd: ["toolchain", "ensure", "agent-browser"], stubs: { "agent-browser": null, npm: NPM_INSTALL_FAILS } },
  { fixture: "home-fresh", cmd: ["toolchain", "ensure", "agent-browser"], stubs: { npm: NPM_LATEST_ABOVE_VERIFIED }, variant: "npm-latest-above-verified" },
  { fixture: "home-fresh", cmd: ["toolchain", "ensure", "agent-browser", "--yes"], stubs: { npm: NPM_LATEST_ABOVE_VERIFIED } },
  { fixture: "home-fresh", cmd: ["toolchain", "ensure", "agent-browser"], stubs: { npm: NPM_OFFLINE }, variant: "npm-offline" }
]

/**
 * Sequential same-HOME replay rows — run the command twice against ONE home
 * and golden the SECOND run, so repeat-run output (the "already in sync"
 * surface) is pinned explicitly.
 */
const REPLAYS: Array<{ fixture: string; cmd: Array<string>; cmd2?: Array<string> }> = [
  { fixture: "home-fresh", cmd: ["sync"] },
  { fixture: "home-drift", cmd: ["sync"] },
  // Verbose replay: the demoted no-op confirmations must come back.
  { fixture: "home-fresh", cmd: ["sync", "--verbose"] },
  // Model modifier as the ONLY second-run mutation: the restart advice must
  // print from the model trigger alone (everything else is already in sync).
  { fixture: "home-drift", cmd: ["sync", "claude"], cmd2: ["sync", "claude", "--claude-model=fable"] }
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

function matrixLabel(
  fixture: string,
  cmd: ReadonlyArray<string>,
  stubs?: Record<string, string | null>,
  variant?: string
): string {
  const stubPart = stubs !== undefined ? ` stubs=${Object.keys(stubs).join(",")}` : ""
  const variantPart = variant !== undefined ? ` variant=${variant}` : ""
  return `fixture=${fixture} cmd=${cmd.join(" ")}${stubPart}${variantPart}`
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

function runReplayCase(fixture: string, cmd: ReadonlyArray<string>, cmd2?: ReadonlyArray<string>): MutationCaseGolden {
  const first = runEngine("native", cmd, fixture, defaultStubs)
  const secondCmd = cmd2 ?? cmd
  const second = runEngine("native", secondCmd, fixture, defaultStubs, { reuseHome: first.home })
  const golden = {
    command: [...secondCmd],
    exitCode: second.exitCode,
    tree: snapshotTree(second.home),
    argvLog: readArgvLog(second),
    output: second.output
  }
  cleanup([second]) // first.home === second.home
  return golden
}

/**
 * Channel-purity invariants (stdout = data, stderr = logs). The ordered
 * goldens above merge channels via 2>&1 and cannot see a violation; these
 * split runs can. Not golden-compared — asserted directly, like the TOML
 * invariants.
 */
function channelInvariantProblems(): Array<string> {
  const problems: Array<string> = []
  const logPrefixes = ["[ok]", "[warn]", "[err]"]

  const syncSplit = runEngineSplit("native", ["sync", "claude"], "home-fresh", defaultStubs)
  for (const prefix of logPrefixes) {
    if (syncSplit.stdout.includes(prefix)) {
      problems.push(`  channel: '${prefix}' log prefix leaked to stdout (sync claude)`)
    }
  }
  if (syncSplit.stderr.includes("--- Sync complete ---")) {
    problems.push("  channel: summary block leaked to stderr (sync claude)")
  }

  // Dry-run under verbose env: the report must stay a complete stdout
  // inspection artifact and no log prefix may ride along on stdout.
  const drySplit = runEngineSplit("native", ["sync", "--dry-run"], "home-drift", defaultStubs, {
    env: { DOCKS_KIT_VERBOSE: "1" }
  })
  if (!drySplit.stdout.includes("[dry-run]")) {
    problems.push("  channel: no [dry-run] lines on stdout (sync --dry-run)")
  }
  if (drySplit.stderr.includes("[dry-run]")) {
    problems.push("  channel: [dry-run] lines leaked to stderr (sync --dry-run)")
  }
  for (const prefix of logPrefixes) {
    if (drySplit.stdout.includes(prefix)) {
      problems.push(`  channel: '${prefix}' log prefix leaked to stdout (verbose sync --dry-run)`)
    }
  }

  // A warn-emitting run (masked git): warns must land on stderr, never stdout.
  // The fully-stubbed cases above emit no warns, so without this leg a
  // stdout-routed warn would pass every channel check.
  const warnSplit = runEngineSplit("native", ["sync", "claude"], "home-fresh", makeStubDir({ git: null }), {
    maskTools: ["git"]
  })
  if (warnSplit.stdout.includes("[warn]")) {
    problems.push("  channel: '[warn]' leaked to stdout (git-masked sync claude)")
  }
  if (!warnSplit.stderr.includes("git not installed —")) {
    problems.push("  channel: expected git warn missing from stderr (git-masked sync claude)")
  }

  // Model catalog rows are stdout data, not logs. Pin this separately from
  // merged goldens, which cannot distinguish the two channels.
  const modelSplit = runEngineSplit("native", ["model", "claude"], "home-drift", defaultStubs)
  if (!modelSplit.stdout.includes("Available claude models")) {
    problems.push("  channel: model catalog missing from stdout (model claude)")
  }
  if (modelSplit.stderr.includes("Available claude models")) {
    problems.push("  channel: model catalog leaked to stderr (model claude)")
  }

  const status = runPublicCli(["status", "--json"], "home-drift", defaultStubs, { env: { DOCKS_KIT_VERBOSE: "1" } })
  if (status.exitCode !== 0) {
    problems.push(`  channel: status --json exited ${status.exitCode} (stderr: ${status.stderr.slice(0, 200)})`)
  } else {
    try {
      JSON.parse(status.stdout)
    } catch {
      problems.push("  channel: status --json stdout is not valid JSON")
    }
  }

  // Verbosity contract: default second run is quiet about the status quo;
  // --verbose (public flag, short alias, and raw-channel env) brings it back.
  // Exact demoted no-op shapes — NOT a loose /already/ match: change lines
  // may legitimately embed count phrasing like "(+1 new, 0 already present)".
  const NOOP_RE =
    /already in sync|already initialized|already set|already opted in|already empty|up to date|\bpresent \(|LSP server binaries present|model already |left as-is/
  const first = runEngineSplit("native", ["sync"], "home-fresh", defaultStubs)
  const second = runEngineSplit("native", ["sync"], "home-fresh", defaultStubs, { reuseHome: first.home })
  if (NOOP_RE.test(second.stderr)) {
    problems.push("  verbosity: no-op confirmation leaked into default second-run stderr")
  }
  const secondVerbose = runEngineSplit("native", ["sync"], "home-fresh", defaultStubs, {
    reuseHome: first.home,
    env: { DOCKS_KIT_VERBOSE: "1" }
  })
  if (!NOOP_RE.test(secondVerbose.stderr)) {
    problems.push("  verbosity: DOCKS_KIT_VERBOSE=1 second run shows no no-op confirmations")
  }
  // Public-flag forwarding: each command surface and spelling must reach
  // EngineNative's verbosity gate — a known verbose-only line must land on
  // stderr (an exit-0 check alone would pass a forwarding regression).
  const pubFirst = runPublicCli(["sync"], "home-fresh", defaultStubs)
  // Settle the one-time settings canonicalization so the in-loop model calls
  // hit the verbose already-unset branch instead of a formatting rewrite.
  runPublicCli(["model", "claude", "default"], "home-fresh", defaultStubs, { reuseHome: pubFirst.home })
  // Model legs run before the sync replays: a flag-less sync re-merges
  // settings into merge ordering, which would turn the model no-op back
  // into a canonicalization write.
  for (const flag of ["--verbose", "-v"]) {
    const model = runPublicCli(["model", "claude", "default", flag], "home-fresh", defaultStubs, { reuseHome: pubFirst.home })
    if (!/deployed settings model already unset/.test(model.stderr)) {
      problems.push(`  verbosity: public 'model claude default ${flag}' shows no verbose no-op line`)
    }
  }
  for (const flag of ["--verbose", "-v"]) {
    const replay = runPublicCli(["sync", flag], "home-fresh", defaultStubs, { reuseHome: pubFirst.home })
    if (!NOOP_RE.test(replay.stderr)) {
      problems.push(`  verbosity: public 'sync ${flag}' replay shows no no-op confirmations on stderr`)
    }
    if (NOOP_RE.test(replay.stdout)) {
      problems.push(`  verbosity: no-op confirmations leaked to stdout (public 'sync ${flag}')`)
    }
    const tc = runPublicCli(["toolchain", "ensure", "rtk", flag], "home-fresh", defaultStubs, { reuseHome: pubFirst.home })
    if (!/\bpresent \(|up to date/.test(tc.stderr)) {
      problems.push(`  verbosity: public 'toolchain ensure rtk ${flag}' shows no verbose no-op line`)
    }
  }

  rmSync(syncSplit.home, { recursive: true, force: true })
  rmSync(warnSplit.home, { recursive: true, force: true })
  rmSync(modelSplit.home, { recursive: true, force: true })
  rmSync(drySplit.home, { recursive: true, force: true })
  rmSync(status.home, { recursive: true, force: true })
  rmSync(second.home, { recursive: true, force: true }) // first/second/secondVerbose share one home
  rmSync(pubFirst.home, { recursive: true, force: true }) // all public forwarding legs reuse this home
  return problems
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

function compareCase(actual: MutationCaseGolden, expected: MutationCaseGolden): Array<string> {
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

  for (const { fixture, cmd, stubs, variant } of MATRIX) {
    const label = matrixLabel(fixture, cmd, stubs, variant)
    if (label in cases) throw new Error(`duplicate matrix label ${label} — add a variant to disambiguate`)
    if (!labelSelected(label)) continue
    const stubDir = stubs !== undefined ? makeStubDir(stubs) : defaultStubs
    const maskTools = stubs !== undefined ? Object.entries(stubs).filter(([, body]) => body === null).map(([name]) => name) : []
    cases[label] = runCase(cmd, fixture, stubDir, maskTools)
  }

  for (const { fixture, cmd, cmd2 } of REPLAYS) {
    const label = `fixture=${fixture} cmd=${(cmd2 ?? cmd).join(" ")} replay=2nd`
    if (label in cases) throw new Error(`duplicate replay label ${label}`)
    if (!labelSelected(label)) continue
    cases[label] = runReplayCase(fixture, cmd, cmd2)
  }

  if (labelSelected("channel-invariants")) {
    const problems = channelInvariantProblems()
    if (problems.length > 0) {
      invariantFailures++
      banner("CHANNEL INVARIANT FAILURE")
      for (const p of problems) console.log(p)
    }
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
  const problems = compareCase(actual, expected)
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
