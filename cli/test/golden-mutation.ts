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
  view) case "$2" in agent-browser) echo "0.32.0";; esac;;
  install) exit 1;;
esac`
const NPM_LATEST_ABOVE_VERIFIED = `case "$1" in
  view) case "$2" in agent-browser) echo "0.99.0";; esac;;
esac`
const NPM_OFFLINE = `case "$1" in view) exit 1;; esac`
const LEGACY_CLAUDE_SETTINGS = stableStringify({
  hooks: {
    SessionStart: [{ hooks: [{ type: "command", command: "legacy-session", timeout: 5 }] }],
    Notification: [{ hooks: [{ type: "command", command: "legacy-notify", timeout: 10, async: true }] }],
    Stop: [{ hooks: [{ type: "command", command: "legacy-fetch", timeout: 5, async: true }] }]
  },
  statusLine: { type: "command", command: "legacy-statusline", refreshInterval: 5 },
  userOnly: "preserved"
})
const LEGACY_CLAUDE_FILES = {
  ".claude/settings.json": LEGACY_CLAUDE_SETTINGS,
  ".claude/statusline.sh": "legacy-statusline-marker\n",
  ".claude/fetch-usage.sh": "legacy-fetch-marker\n",
  ".claude/hooks/notify.sh": "legacy-notify-marker\n"
}

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
  { fixture: "home-drift", cmd: ["sync", "claude", "--claude-effort=default"] },
  { fixture: "home-drift", cmd: ["sync", "claude", "--claude-advisor=on"] },
  { fixture: "home-drift", cmd: ["sync", "codex", "--codex-effort=ultra"] },
  { fixture: "home-drift", cmd: ["sync", "codex", "--codex-effort=default"] },
  { fixture: "home-fresh", cmd: ["sync", "claude", "--claude-effort"] },
  { fixture: "home-fresh", cmd: ["sync", "claude", "--claude-effort="] },
  { fixture: "home-fresh", cmd: ["sync", "claude", "--claude-effort=max"] },
  { fixture: "home-fresh", cmd: ["sync", "codex", "--codex-effort"] },
  { fixture: "home-fresh", cmd: ["sync", "codex", "--codex-effort="] },
  { fixture: "home-fresh", cmd: ["sync", "codex", "--codex-effort=future"] },
  { fixture: "home-fresh", cmd: ["sync", "claude", "--claude-advisor"] },
  { fixture: "home-fresh", cmd: ["sync", "claude", "--claude-advisor="] },
  { fixture: "home-fresh", cmd: ["sync", "claude", "--claude-advisor=maybe"] },
  {
    fixture: "home-fresh",
    cmd: ["sync", "agents", "--dry-run", "--claude-effort=low", "--claude-advisor=on", "--codex-effort=max"]
  },
  { fixture: "home-drift", cmd: ["sync", "claude", "--claude-plugin=supabase,n8n"] },
  {
    fixture: "home-drift",
    cmd: [
      "sync",
      "claude",
      "--claude-model=opus",
      "--claude-effort=low",
      "--claude-advisor=on",
      "--claude-compact-window=680k",
      "--claude-permissive"
    ]
  },
  { fixture: "home-drift", cmd: ["model", "claude", "opus"] },
  { fixture: "home-drift", cmd: ["model", "claude", "default"] },
  { fixture: "home-drift", cmd: ["model", "codex", "gpt-5.5"] },
  {
    fixture: "home-fresh",
    cmd: ["workflow", "--model-reviewer=codex:gpt-5.6-terra@high"],
    variant: "workflow-role-override"
  },
  {
    fixture: "home-drift",
    cmd: [
      "workflow",
      "--model-orchestrator=claude:best@high",
      "--model-reviewer=codex:gpt-5.6-terra@high",
      "--model-implementer=codex:gpt-5.6-luna@medium",
      "--review-min-score=80",
      "--review-max-rounds=5"
    ],
    variant: "workflow-all-role-overrides-and-review-bounds"
  },
  {
    fixture: "home-drift",
    cmd: ["workflow", "--review-max-rounds=0"],
    variant: "workflow-review-bound-invalid"
  },
  { fixture: "home-invalid-json", cmd: ["sync", "claude"] },
  { fixture: "home-fresh", cmd: ["toolchain", "ensure", "agent-browser"] },
  { fixture: "home-fresh", cmd: ["toolchain", "ensure", "agent-browser", "--verbose"] },
  { fixture: "home-fresh", cmd: ["toolchain", "ensure", "effect-solutions", "--yes"] },
  { fixture: "home-fresh", cmd: ["toolchain", "ensure", "session-relay"] },
  { fixture: "home-fresh", cmd: ["toolchain", "check"] },
  { fixture: "home-fresh", cmd: ["sync", "claude"], stubs: { rtk: RTK_INIT_FAILS } },
  { fixture: "home-fresh", cmd: ["sync", "claude"], stubs: { claude: null } },
  { fixture: "home-fresh", cmd: ["sync", "codex"], stubs: { codex: null } },
  { fixture: "home-fresh", cmd: ["sync", "claude"], stubs: { jq: null }, variant: "jq-absent-bun-hooks" },
  { fixture: "home-fresh", cmd: ["sync", "codex"], stubs: { jq: null }, variant: "jq-absent-native-sync" },
  {
    fixture: "home-fresh",
    cmd: ["sync", "claude"],
    stubs: { curl: null, rtk: null },
    variant: "curl-absent-rtk-bootstrap"
  },
  {
    fixture: "home-fresh",
    cmd: ["toolchain", "ensure", "rtk"],
    stubs: { curl: null, rtk: null },
    variant: "curl-absent-direct-rtk"
  },
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
const REPLAYS: Array<{ fixture: string; cmd: Array<string>; cmd2?: Array<string>; variant?: string }> = [
  { fixture: "home-fresh", cmd: ["sync"] },
  { fixture: "home-drift", cmd: ["sync"] },
  // Verbose replay: the demoted no-op confirmations must come back.
  { fixture: "home-fresh", cmd: ["sync", "--verbose"] },
  // Model modifier as the ONLY second-run mutation: the restart advice must
  // print from the model trigger alone (everything else is already in sync).
  { fixture: "home-drift", cmd: ["sync", "claude"], cmd2: ["sync", "claude", "--claude-model=opus"] },
  {
    fixture: "home-fresh",
    cmd: ["workflow", "--review-min-score=80"],
    variant: "workflow-idempotent-role-override"
  },
  {
    fixture: "home-fresh",
    cmd: ["workflow", "--review-min-score=80"],
    cmd2: ["sync"],
    variant: "workflow-default-restoration"
  }
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

function runLegacyMigrationCase(): MutationCaseGolden & { readonly problems: Array<string> } {
  const fixture = materializeVariant("home-fresh", LEGACY_CLAUDE_FILES)
  const run = runEngine("native", ["sync", "claude"], fixture, defaultStubs)
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
  if (!run.output.includes("Pruned stale artifacts (hooks: 1, files: 2, settings keys: 1, claude.json keys: 0)")) {
    problems.push("  migration: aggregate readiness-gated prune line missing")
  }
  const golden = {
    command: ["sync", "claude"],
    exitCode: run.exitCode,
    tree: snapshotTree(run.home),
    argvLog: readArgvLog(run),
    output: run.output,
    problems
  }
  cleanup([run])
  rmSync(fixture, { recursive: true, force: true })
  return golden
}

type AdvisorMigrationState = "flagless" | "on" | "off" | "default"

function runAdvisorMigrationCase(state: AdvisorMigrationState): MutationCaseGolden & { readonly problems: Array<string> } {
  const sourceSettings = JSON.parse(
    readFileSync(join(FIXTURES_DIR, "home-drift", ".claude", "settings.json"), "utf8")
  ) as Record<string, unknown>
  sourceSettings["advisorModel"] = "fable"
  const fixture = materializeVariant("home-drift", {
    ".claude/settings.json": stableStringify(sourceSettings)
  })
  const command = ["sync", "claude", ...(state === "flagless" ? [] : [`--claude-advisor=${state}`])]
  const first = runEngine("native", command, fixture, defaultStubs)
  const second = runEngine("native", command, fixture, defaultStubs, { reuseHome: first.home })
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
  if (second.output.includes("Pruned stale artifacts") || second.output.includes("Advisor: deployed settings advisorModel")) {
    problems.push(`  advisor migration: repeated ${state} state was not a true no-op`)
  }
  if (second.output.includes("Restart Claude Code for hook/env-var changes to take effect.")) {
    problems.push(`  advisor migration: repeated ${state} state retriggered Claude restart advice`)
  }

  const golden = {
    command,
    exitCode: second.exitCode,
    tree: snapshotTree(second.home),
    argvLog: readArgvLog(second),
    output: second.output,
    problems
  }
  cleanup([second]) // first.home === second.home
  rmSync(fixture, { recursive: true, force: true })
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
  rmSync(modifierForwarding.home, { recursive: true, force: true })
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

  for (const { fixture, cmd, cmd2, variant } of REPLAYS) {
    const variantPart = variant === undefined ? "" : ` variant=${variant}`
    const label = `fixture=${fixture} cmd=${(cmd2 ?? cmd).join(" ")} replay=2nd${variantPart}`
    if (label in cases) throw new Error(`duplicate replay label ${label}`)
    if (!labelSelected(label)) continue
    cases[label] = runReplayCase(fixture, cmd, cmd2)
  }

  const migrationLabel = "migration=legacy-claude-hook-scripts"
  if (labelSelected(migrationLabel)) {
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
    if (!labelSelected(advisorLabel)) continue
    const { problems, ...golden } = runAdvisorMigrationCase(state)
    cases[advisorLabel] = golden
    if (problems.length > 0) {
      invariantFailures++
      banner(`ADVISOR MIGRATION INVARIANT FAILURE state=${state}`)
      for (const problem of problems) console.log(problem)
    }
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
