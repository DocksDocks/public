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
import { banner, labelSelected, parseArgs } from "./lib/goldenCli"
import { cleanup, readArgvLog, runEngine, runEngineSplit, runPublicCli } from "./lib/goldenExecution"
import {
  LEGACY_CLAUDE_FILES,
  MATRIX,
  REPLAYS,
  TOML_DIR,
  TOML_SHAPES
} from "./lib/goldenMutationCatalog"
import { FIXTURES_DIR, REPO_DIR, makeStubDir, materializeVariant } from "./lib/goldenResources"
import { diffText, diffTrees, snapshotTree, stableStringify, type TreeSnapshot } from "./lib/goldenSnapshot"
import { readGolden, selectProveRedMismatch } from "./lib/goldenProveRed"

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


const GOLDEN_PATH = join(REPO_DIR, "cli", "test", "goldens", "mutation.json")
const options = parseArgs(process.argv)
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
  const run = runEngine(command, fixture, stubDir, { maskTools })
  try {
    return {
      command: [...command],
      exitCode: run.exitCode,
      tree: snapshotTree(run.home),
      argvLog: readArgvLog(run),
      output: run.output
    }
  } finally {
    cleanup([run])
  }
}

function runReplayCase(
  fixture: string,
  cmd: ReadonlyArray<string>,
  cmd2?: ReadonlyArray<string>
): MutationCaseGolden {
  const first = runEngine(cmd, fixture, defaultStubs)
  try {
    if (first.exitCode !== 0) {
      throw new Error(`first replay failed for '${cmd.join(" ")}' with exit code ${first.exitCode}`)
    }
    if (!first.output.includes("--- Sync complete ---")) {
      throw new Error(`first replay for '${cmd.join(" ")}' produced no sync completion summary`)
    }
    const secondCmd = cmd2 ?? cmd
    const second = runEngine(secondCmd, fixture, defaultStubs, { reuseHome: first.home })
    return {
      command: [...secondCmd],
      exitCode: second.exitCode,
      tree: snapshotTree(second.home),
      argvLog: readArgvLog(second),
      output: second.output
    }
  } finally {
    cleanup([first])
  }
}

function runLegacyMigrationCase(): MutationCaseGolden & { readonly problems: Array<string> } {
  const fixture = materializeVariant("home-fresh", LEGACY_CLAUDE_FILES)
  try {
    const run = runEngine(["sync", "claude"], fixture, defaultStubs)
    try {
      const problems: Array<string> = []
      for (const relative of [".claude/statusline.sh", ".claude/fetch-usage.sh", ".claude/hooks/notify.sh"]) {
        if (existsSync(join(run.home, relative))) problems.push(`  migration: legacy file survived: ${relative}`)
      }
      for (const relative of [
        ".claude/bin/statusline.mjs",
        ".claude/bin/session-start.mjs",
        ".claude/bin/notify.mjs",
        ".claude/notification.mp3"
      ]) {
        if (!existsSync(join(run.home, relative))) problems.push(`  migration: runtime file missing: ${relative}`)
      }
      const settingsText = readFileSync(join(run.home, ".claude", "settings.json"), "utf8")
      const settings = JSON.parse(settingsText) as Record<string, unknown>
      const hooks = settings["hooks"] as Record<string, unknown> | undefined
      if (hooks?.["Stop"] !== undefined) problems.push("  migration: hooks.Stop survived ready cutover")
      if (settingsText.includes("__DOCKS_KIT_")) problems.push("  migration: deployed settings contain a sentinel")
      if (
        !run.output.includes(
          "Pruned stale artifacts (hooks: 1, files: 2, settings keys: 1, claude.json keys: 0)"
        )
      ) {
        problems.push("  migration: aggregate readiness-gated prune line missing")
      }
      return {
        command: ["sync", "claude"],
        exitCode: run.exitCode,
        tree: snapshotTree(run.home),
        argvLog: readArgvLog(run),
        output: run.output,
        problems
      }
    } finally {
      cleanup([run])
    }
  } finally {
    rmSync(fixture, { recursive: true, force: true })
  }
}

type AdvisorMigrationState = "flagless" | "on" | "off" | "default"

function runAdvisorMigrationCase(
  state: AdvisorMigrationState
): MutationCaseGolden & { readonly problems: Array<string> } {
  const sourceSettings = JSON.parse(
    readFileSync(join(FIXTURES_DIR, "home-drift", ".claude", "settings.json"), "utf8")
  ) as Record<string, unknown>
  sourceSettings["advisorModel"] = "fable"
  // Retirement cleanups (the stale relay command, its enablement key) fire on
  // every state and would mask which mechanism owns advisorModel, so this case
  // drops them from its variant.
  const enabledPlugins = sourceSettings["enabledPlugins"]
  if (enabledPlugins !== null && typeof enabledPlugins === "object") {
    delete (enabledPlugins as Record<string, unknown>)["session-relay@docks"]
  }
  const fixture = materializeVariant("home-drift", {
    ".claude/settings.json": stableStringify(sourceSettings),
    ".local/bin/session-relay": null
  })
  try {
    const command = ["sync", "claude", ...(state === "flagless" ? [] : [`--claude-advisor=${state}`])]
    const first = runEngine(command, fixture, defaultStubs)
    try {
      const second = runEngine(command, fixture, defaultStubs, { reuseHome: first.home })
      const problems: Array<string> = []
      const firstChangedByRemoval = first.output.includes("Pruned stale artifacts")
      const firstChangedByModifier = first.output.includes("Advisor: deployed settings advisorModel")
      if (state === "flagless" && !firstChangedByRemoval) {
        problems.push("  advisor migration: flag-less run did not delete advisorModel through removals")
      }
      if (state !== "flagless" && firstChangedByRemoval) {
        problems.push(`  advisor migration: explicit ${state} run let removals own advisorModel`)
      }
      if ((state === "off" || state === "default") && !firstChangedByModifier) {
        problems.push(`  advisor migration: explicit ${state} run did not delete advisorModel through the modifier`)
      }

      const settings = JSON.parse(
        readFileSync(join(second.home, ".claude", "settings.json"), "utf8")
      ) as Record<string, unknown>
      if (state === "on" && settings["advisorModel"] !== "fable") {
        problems.push("  advisor migration: explicit on did not preserve advisorModel=fable")
      }
      if (state !== "on" && Object.prototype.hasOwnProperty.call(settings, "advisorModel")) {
        problems.push(`  advisor migration: ${state} left advisorModel deployed`)
      }
      if (
        second.output.includes("Pruned stale artifacts") ||
        second.output.includes("Advisor: deployed settings advisorModel")
      ) {
        problems.push(`  advisor migration: repeated ${state} state was not a true no-op`)
      }
      if (second.output.includes("Restart Claude Code for hook/env-var changes to take effect.")) {
        problems.push(`  advisor migration: repeated ${state} state retriggered Claude restart advice`)
      }

      return {
        command,
        exitCode: second.exitCode,
        tree: snapshotTree(second.home),
        argvLog: readArgvLog(second),
        output: second.output,
        problems
      }
    } finally {
      cleanup([first])
    }
  } finally {
    rmSync(fixture, { recursive: true, force: true })
  }
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

  const syncSplit = runEngineSplit(["sync", "claude"], "home-fresh", defaultStubs)
  if (syncSplit.exitCode !== 0) {
    problems.push(`  channel: sync claude exited ${syncSplit.exitCode}; expected 0`)
  }
  if (!syncSplit.stdout.includes("--- Sync complete ---")) {
    problems.push("  channel: summary block missing from stdout (sync claude)")
  }
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
  const drySplit = runEngineSplit(["sync", "--dry-run"], "home-drift", defaultStubs, {
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
  const warnSplit = runEngineSplit(["sync", "claude"], "home-fresh", makeStubDir({ git: null }), {
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
  const modelSplit = runEngineSplit(["model", "claude"], "home-drift", defaultStubs)
  if (!modelSplit.stdout.includes("Available claude models")) {
    problems.push("  channel: model catalog missing from stdout (model claude)")
  }
  if (modelSplit.stderr.includes("Available claude models")) {
    problems.push("  channel: model catalog leaked to stderr (model claude)")
  }

  for (const [flag, catalog, error] of [
    [
      "--claude-effort",
      "Available claude effort levels",
      "--claude-effort requires a value: --claude-effort=<low|medium|high|xhigh|default>"
    ],
    [
      "--codex-effort",
      "Available codex effort levels",
      "--codex-effort requires a value: --codex-effort=<none|minimal|low|medium|high|xhigh|max|ultra|default>"
    ],
    [
      "--claude-advisor",
      "Available claude advisor states",
      "--claude-advisor requires a value: --claude-advisor=<on|off|default>"
    ]
  ] as const) {
    const bare = runPublicCli(["sync", flag], "home-fresh", defaultStubs)
    if (bare.exitCode !== 2 || !bare.stderr.includes(catalog) || !bare.stderr.includes(error)) {
      problems.push(`  modifiers: public bare ${flag} lost catalog/error/exit-2 behavior`)
    }
    if (bare.stdout !== "") problems.push(`  modifiers: public bare ${flag} wrote catalog data to stdout`)
    rmSync(bare.home, { recursive: true, force: true })
  }

  for (const [flag, hint] of [
    ["--force", "--force was renamed to --reconcile"],
    ["--supabase", "--supabase was renamed to --claude-plugin=supabase"],
    ["--680k", "--680k was renamed to --claude-compact-window=680k"],
    ["--claude", "--claude was renamed: pass the target as a word, e.g. 'sync claude'"]
  ] as const) {
    const bare = runPublicCli(["sync", flag], "home-fresh", defaultStubs)
    if (bare.exitCode !== 2 || !bare.stderr.includes(hint)) {
      problems.push(`  modifiers: public legacy ${flag} lost rename-hint/exit-2 behavior`)
    }
    if (bare.stdout !== "") problems.push(`  modifiers: public legacy ${flag} wrote rename hint to stdout`)
    rmSync(bare.home, { recursive: true, force: true })
  }

  for (const [args, error, label] of [
    [["toolchain", "--no-verbose"], "unknown flag --no-verbose for 'toolchain'", "negated toolchain option --no-verbose"],
    [["sync", "-x"], "unknown flag -x for 'sync'", "single-dash unknown flag -x"],
    [
      ["sync", "--bogus", "--claude-model", "opus"],
      "unknown flag --bogus for 'sync'",
      "head-position unknown before value flag"
    ],
    [
      ["sync", "--claude-compact-window", "-1"],
      "--claude-compact-window expects a token count",
      "dash-leading compact-window value"
    ],
    [["sync", "--prune", "--prune"], "flag --prune was given more than once", "duplicate non-repeatable flag --prune"]
  ] as const) {
    const bare = runPublicCli(args, "home-fresh", defaultStubs)
    if (bare.exitCode !== 2 || !bare.stderr.includes(error)) {
      problems.push(`  modifiers: public ${label} lost error/exit-2 behavior`)
    }
    if (bare.stdout !== "") problems.push(`  modifiers: public ${label} wrote error data to stdout`)
    rmSync(bare.home, { recursive: true, force: true })
  }

  // Before this guard, an invocation that read as a dry run performed a real mutating sync.
  const booleanWithValue = runPublicCli(["sync", "--dry-run=false"], "home-fresh", defaultStubs)
  if (
    booleanWithValue.exitCode !== 2 ||
    !booleanWithValue.stderr.includes("flag --dry-run does not take a value")
  ) {
    problems.push("  modifiers: public --dry-run=false lost error/exit-2 behavior")
  }
  if (booleanWithValue.stdout !== "") {
    problems.push("  modifiers: public --dry-run=false wrote error data to stdout")
  }
  rmSync(booleanWithValue.home, { recursive: true, force: true })

  // The kit refuses these flags outright so Effect 4 cannot negate a declared boolean into a real mutating sync.
  for (const flag of ["--no-dry-run", "--no-prune"] as const) {
    const bare = runPublicCli(["sync", flag], "home-fresh", defaultStubs)
    if (bare.exitCode !== 2 || bare.stderr !== `unknown flag ${flag} for 'sync'\n`) {
      problems.push(`  modifiers: public negated ${flag} lost unknown-flag/exit-2 behavior`)
    }
    if (bare.stdout !== "") problems.push(`  modifiers: public negated ${flag} wrote error data to stdout`)
    rmSync(bare.home, { recursive: true, force: true })
  }

  for (const [target, flag, catalog, error] of [
    ["claude", "--claude-effort", "Available claude effort levels", "Invalid Claude effort ''"],
    ["codex", "--codex-effort", "Available codex effort levels", "Invalid Codex effort ''"],
    ["claude", "--claude-advisor", "Available claude advisor states", "Invalid Claude advisor state ''"],
    ["claude", "--claude-model", "Available claude models", "Invalid Claude model ''"],
    ["codex", "--codex-model", "Available codex models", "Invalid Codex model ''"]
  ] as const) {
    for (const args of [[`${flag}=`], [flag, ""]]) {
      const empty = runPublicCli(["sync", target, ...args], "home-fresh", defaultStubs)
      if (
        empty.exitCode !== 2 ||
        !empty.stdout.includes(catalog) ||
        !empty.stderr.includes(error) ||
        empty.stdout.includes("--- Sync complete ---")
      ) {
        problems.push(`  modifiers: public explicit-empty ${args.length === 1 ? `${flag}=` : `${flag} \"\"`} lost catalog-first invalid-value behavior`)
      }
      rmSync(empty.home, { recursive: true, force: true })
    }
  }

  const modifierForwarding = runPublicCli(
    ["sync", "agents", "--dry-run", "--claude-effort=low", "--claude-advisor=on", "--codex-effort=max"],
    "home-fresh",
    defaultStubs
  )
  if (
    modifierForwarding.exitCode !== 0 ||
    !modifierForwarding.stderr.includes("--claude-effort ignored: claude target not selected") ||
    !modifierForwarding.stderr.includes("--claude-advisor ignored: claude target not selected") ||
    !modifierForwarding.stderr.includes("--codex-effort ignored: codex target not selected")
  ) {
    problems.push("  modifiers: public valued options did not reach EngineNative target-ignore validation")
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
  const first = runEngineSplit(["sync"], "home-fresh", defaultStubs)
  const second = runEngineSplit(["sync"], "home-fresh", defaultStubs, { reuseHome: first.home })
  if (NOOP_RE.test(second.stderr)) {
    problems.push("  verbosity: no-op confirmation leaked into default second-run stderr")
  }
  const secondVerbose = runEngineSplit(["sync"], "home-fresh", defaultStubs, {
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
  }

  rmSync(syncSplit.home, { recursive: true, force: true })
  rmSync(warnSplit.home, { recursive: true, force: true })
  rmSync(modelSplit.home, { recursive: true, force: true })
  rmSync(modifierForwarding.home, { recursive: true, force: true })
  rmSync(drySplit.home, { recursive: true, force: true })
  rmSync(status.home, { recursive: true, force: true })
  rmSync(second.home, { recursive: true, force: true }) // first/second/secondVerbose share one home
  rmSync(pubFirst.home, { recursive: true, force: true }) // all public forwarding legs reuse this home
  return problems
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

function runTomlCase(
  shape: string,
  command: ReadonlyArray<string>,
  assertInvariants: boolean
): MutationCaseGolden & { problems: Array<string> } {
  const variant = materializeVariant("home-fresh", {
    ".codex/config.toml": readFileSync(join(TOML_DIR, shape), "utf8")
  })
  try {
    const run = runEngine(command, variant, defaultStubs)
    try {
      const problems = assertInvariants ? tomlInvariantProblems(shape, run.home) : []
      return {
        command: [...command],
        exitCode: run.exitCode,
        tree: snapshotTree(run.home),
        argvLog: readArgvLog(run),
        output: run.output,
        problems
      }
    } finally {
      cleanup([run])
    }
  } finally {
    rmSync(variant, { recursive: true, force: true })
  }
}

function collectCases(): {
  cases: Record<string, MutationCaseGolden>
  invariantFailures: number
  selectedChecks: number
} {
  const cases: Record<string, MutationCaseGolden> = {}
  let invariantFailures = 0
  let selectedChecks = 0

  for (const { fixture, cmd, stubs, variant } of MATRIX) {
    const label = matrixLabel(fixture, cmd, stubs, variant)
    if (label in cases) throw new Error(`duplicate matrix label ${label} — add a variant to disambiguate`)
    if (!labelSelected(label, options.filter)) continue
    selectedChecks++
    const stubDir = stubs !== undefined ? makeStubDir(stubs) : defaultStubs
    const maskTools =
      stubs !== undefined
        ? Object.entries(stubs)
            .filter(([, body]) => body === null)
            .map(([name]) => name)
        : []
    cases[label] = runCase(cmd, fixture, stubDir, maskTools)
  }

  for (const { fixture, cmd, cmd2 } of REPLAYS) {
    const label = `fixture=${fixture} cmd=${(cmd2 ?? cmd).join(" ")} replay=2nd`
    if (label in cases) throw new Error(`duplicate replay label ${label}`)
    if (!labelSelected(label, options.filter)) continue
    selectedChecks++
    cases[label] = runReplayCase(fixture, cmd, cmd2)
  }

  const migrationLabel = "migration=legacy-claude-hook-scripts"
  if (labelSelected(migrationLabel, options.filter)) {
    selectedChecks++
    const { problems, ...golden } = runLegacyMigrationCase()
    cases[migrationLabel] = golden
    if (problems.length > 0) {
      invariantFailures++
      banner("CLAUDE MIGRATION INVARIANT FAILURE")
      for (const problem of problems) console.log(problem)
    }
  }

  for (const state of ["flagless", "on", "off", "default"] as const) {
    const advisorLabel = `advisor-migration=prior-kit-settings state=${state}`
    if (!labelSelected(advisorLabel, options.filter)) continue
    selectedChecks++
    const { problems, ...golden } = runAdvisorMigrationCase(state)
    cases[advisorLabel] = golden
    if (problems.length > 0) {
      invariantFailures++
      banner(`ADVISOR MIGRATION INVARIANT FAILURE state=${state}`)
      for (const problem of problems) console.log(problem)
    }
  }

  if (labelSelected("channel-invariants", options.filter)) {
    selectedChecks++
    const problems = channelInvariantProblems()
    if (problems.length > 0) {
      invariantFailures++
      banner("CHANNEL INVARIANT FAILURE")
      for (const p of problems) console.log(p)
    }
  }

  for (const shape of TOML_SHAPES) {
    const syncLabel = `toml=${shape}`
    if (labelSelected(syncLabel, options.filter)) {
      selectedChecks++
      const { problems, ...golden } = runTomlCase(shape, ["sync", "codex"], true)
      cases[syncLabel] = golden
      if (problems.length > 0) {
        invariantFailures++
        banner(`TOML INVARIANT FAILURE shape=${shape}`)
        for (const p of problems) console.log(p)
      }
    }

    const modelLabel = `toml=${shape} model codex`
    if (labelSelected(modelLabel, options.filter)) {
      selectedChecks++
      const { problems: _, ...golden } = runTomlCase(shape, ["model", "codex", "gpt-5.5"], false)
      cases[modelLabel] = golden
    }
  }

  return { cases, invariantFailures, selectedChecks }
}

if (options.updateGoldens) {
  const {
    cases: selectedCases,
    invariantFailures,
    selectedChecks
  } = collectCases()
  if (options.filter !== undefined && selectedChecks === 0) {
    console.error("GOLDEN_FILTER matched no cases")
    process.exit(2)
  }
  if (options.filter !== undefined && Object.keys(selectedCases).length === 0) {
    console.error("GOLDEN_FILTER selected no snapshot cases")
    process.exit(2)
  }
  if (invariantFailures > 0) {
    console.error(`\ngolden-mutation: ${invariantFailures} invariant failure(s); goldens not updated`)
    process.exit(1)
  }

  const cases =
    options.filter === undefined
      ? selectedCases
      : { ...readGolden<MutationCaseGolden>(GOLDEN_PATH).cases, ...selectedCases }
  mkdirSync(dirname(GOLDEN_PATH), { recursive: true })
  writeFileSync(GOLDEN_PATH, stableStringify({ version: 1, cases } satisfies MutationGolden))
  console.log(`golden-mutation: updated ${Object.keys(selectedCases).length} case(s) at ${GOLDEN_PATH}`)
  process.exit(0)
}

const goldens = readGolden<MutationCaseGolden>(GOLDEN_PATH)
const { cases: actualCases, invariantFailures, selectedChecks } = collectCases()
if (options.filter !== undefined && selectedChecks === 0) {
  console.error("GOLDEN_FILTER matched no cases")
  process.exit(2)
}
let goldenFailures = 0
let checked = 0
const proveRed = options.proveRed ? selectProveRedMismatch(goldens.cases) : undefined

for (const [label, actual] of Object.entries(actualCases)) {
  const expected = proveRed?.expectedFor(label) ?? goldens.cases[label]
  if (expected === undefined) {
    goldenFailures++
    banner(`MISSING GOLDEN ${label}`)
    console.log("  run with --update-goldens to record this case")
    continue
  }
  checked++
  const problems = compareCase(actual, expected)
  proveRed?.recordComparison(problems.length > 0)
  if (problems.length > 0) {
    goldenFailures++
    banner(`GOLDEN MISMATCH ${label}`)
    for (const p of problems) console.log(p)
  }
}

if (proveRed !== undefined) {
  const result = proveRed.result()
  if (!result.succeeded) {
    console.error(
      `prove-red FAILED: golden-mutation compared ${result.comparedCases} case(s) and detected ${result.comparatorMismatches} comparator mismatch(es); ${invariantFailures} invariant failure(s) do not satisfy prove-red`
    )
    process.exit(1)
  }
  console.error(
    `prove-red OK: golden-mutation compared ${result.comparedCases} case(s) and detected ${result.comparatorMismatches} planted comparator mismatch(es); intentionally exiting 1`
  )
  process.exit(1)
}

const failures = invariantFailures + goldenFailures
if (failures > 0) {
  console.error(
    `\ngolden-mutation: ${failures} failure(s) (${invariantFailures} invariant, ${goldenFailures} golden)`
  )
  process.exit(1)
}
console.log(`golden-mutation: OK (${checked} case(s))`)
