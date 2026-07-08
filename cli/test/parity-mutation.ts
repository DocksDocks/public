/**
 * Harness 4(b) + 4(c): real-run mutation parity.
 *
 * Executes REAL (non-dry-run) engine commands against disposable fixture
 * HOMEs with all external tools stubbed (stubs record argv). For each
 * command it diffs, between the two engine sides:
 *   - the resulting HOME tree (paths + content hashes + symlink targets)
 *   - the recorded child-process argv log (catches quoting drift)
 *   - exit codes and normalized output
 * 4(c): the codex TOML fixture suite runs `sync codex` over each config
 * shape the awk merge must survive, and additionally asserts invariants on
 * the RESULT (scrubbed key gone, user tables preserved, .bak written).
 *
 *   bun cli/test/parity-mutation.ts               # bash vs bash (self)
 *   bun cli/test/parity-mutation.ts --native      # bash vs EngineNative
 *   bun cli/test/parity-mutation.ts --prove-red   # must DETECT a planted diff
 */
import { readFileSync, existsSync } from "node:fs"
import { join } from "node:path"
import {
  FIXTURES_DIR,
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
  type EngineKind,
  type EngineRun
} from "./lib/harness"

const { native, proveRed } = parseArgs(process.argv)
const sideB: EngineKind = native ? "native" : "bash"
const stubs = makeStubDir()
let failures = 0

function comparePair(label: string, a: EngineRun, b: EngineRun): void {
  const problems = [
    ...(a.exitCode === b.exitCode ? [] : [`  exit codes differ: A=${a.exitCode} B=${b.exitCode}`]),
    ...diffTrees(snapshotTree(a.home), snapshotTree(b.home)),
    ...diffText("argv log", readArgvLog(a), readArgvLog(b)),
    ...diffText("output", a.output, b.output)
  ]
  if (problems.length > 0) {
    failures++
    banner(`DIVERGENCE ${label}`)
    for (const p of problems) console.log(p)
  }
  cleanup([a, b])
}

// ------------------------------------------------ 4(b): command matrix ----

const MATRIX: Array<{ fixture: string; cmd: Array<string> }> = [
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
  // Toolchain gate branches (stdin is not a TTY here → non-TTY paths):
  { fixture: "home-fresh", cmd: ["toolchain", "ensure", "agent-browser"] },
  { fixture: "home-fresh", cmd: ["toolchain", "ensure", "effect-solutions", "--yes"] },
  { fixture: "home-fresh", cmd: ["toolchain", "check"] }
]

for (const { fixture, cmd } of MATRIX) {
  if (!labelSelected(`fixture=${fixture} cmd=${cmd.join(" ")}`)) continue
  const a = runEngine("bash", cmd, fixture, stubs)
  const b = runEngine(sideB, cmd, proveRed ? planted(fixture) : fixture, stubs)
  if (proveRed && planted(fixture) === fixture) {
    cleanup([a, b])
    continue
  }
  comparePair(`fixture=${fixture} cmd=${cmd.join(" ")}`, a, b)
}

function planted(fixture: string): string {
  return fixture === "home-fresh" ? "home-drift" : "home-fresh"
}

// -------------------------------------------- 4(c): codex TOML fixtures ----

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

if (!proveRed) {
  for (const shape of TOML_SHAPES) {
    const variant = materializeVariant("home-fresh", {
      ".codex/config.toml": readFileSync(join(TOML_DIR, shape), "utf8")
    })
    const a = runEngine("bash", ["sync", "codex"], variant, stubs)
    const b = runEngine(sideB, ["sync", "codex"], variant, stubs)

    // Result invariants (checked on side A; parity transfers them to B):
    const result = readFileSync(join(a.home, ".codex", "config.toml"), "utf8")
    const invariantProblems: Array<string> = []
    if (result.includes("use_legacy_landlock")) {
      invariantProblems.push("  invariant: deprecated use_legacy_landlock survived the scrub")
    }
    if (!existsSync(join(a.home, ".codex", "config.toml.bak"))) {
      invariantProblems.push("  invariant: config.toml.bak backup missing")
    }
    const topLevel = result.split(/^\[/m)[0] ?? ""
    if ((topLevel.match(/^model[ \t]*=/gm) ?? []).length !== 1) {
      invariantProblems.push("  invariant: top-level model line count != 1")
    }
    if (readFileSync(join(TOML_DIR, shape), "utf8").includes("[user_only.table]") && !result.includes("[user_only.table]")) {
      invariantProblems.push("  invariant: user-only table was destroyed")
    }
    if (invariantProblems.length > 0) {
      failures++
      banner(`TOML INVARIANT FAILURE shape=${shape}`)
      for (const p of invariantProblems) console.log(p)
    }
    comparePair(`toml=${shape}`, a, b)

    // --codex-model direct mode on the same shape:
    const a2 = runEngine("bash", ["model", "codex", "gpt-5.5"], variant, stubs)
    const b2 = runEngine(sideB, ["model", "codex", "gpt-5.5"], variant, stubs)
    comparePair(`toml=${shape} model codex`, a2, b2)
  }
}

// --------------------------------------------------------------- report ----

if (proveRed) {
  if (failures === 0) {
    console.error("prove-red FAILED: harness did not detect the planted divergence")
    process.exit(1)
  }
  console.log(`prove-red OK: harness detected ${failures} planted divergence(s)`)
  process.exit(0)
}

if (failures > 0) {
  console.error(`\nparity-mutation: ${failures} divergence(s)`)
  process.exit(1)
}
console.log(
  `parity-mutation: OK (${MATRIX.length} matrix commands + ${TOML_SHAPES.length} TOML shapes x2, side B=${sideB})`
)
