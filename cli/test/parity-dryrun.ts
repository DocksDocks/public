/**
 * Harness 4(a): dry-run byte-parity.
 *
 * Runs `sync --dry-run` (and per-target variants) through both engine sides
 * on every fixture HOME and byte-diffs the merged output. Exits non-zero on
 * any divergence.
 *
 *   bun cli/test/parity-dryrun.ts               # bash vs bash (self-parity)
 *   bun cli/test/parity-dryrun.ts --native      # bash vs EngineNative
 *   bun cli/test/parity-dryrun.ts --prove-red   # must DETECT a planted diff
 */
import {
  banner,
  cleanup,
  diffText,
  labelSelected,
  makeStubDir,
  parseArgs,
  runEngine,
  type EngineKind
} from "./lib/harness"

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

const { native, proveRed } = parseArgs(process.argv)
const sideB: EngineKind = native ? "native" : "bash"
const stubs = makeStubDir()
let failures = 0

for (const fixture of FIXTURES) {
  for (const cmd of COMMANDS) {
    if (!labelSelected(`fixture=${fixture} cmd=${cmd.join(" ")}`)) continue
    const a = runEngine("bash", cmd, fixture, stubs)
    // --prove-red plants a divergence: side B runs the same command on a
    // DIFFERENT fixture — the harness must catch it or it proves nothing.
    const b = runEngine(sideB, cmd, proveRed ? "home-drift" : fixture, stubs)
    if (proveRed && fixture === "home-drift") {
      cleanup([a, b])
      continue // same fixture on both sides would be a real (green) pair
    }
    const problems = [
      ...(a.exitCode === b.exitCode ? [] : [`  exit codes differ: A=${a.exitCode} B=${b.exitCode}`]),
      ...diffText("dry-run output", a.output, b.output)
    ]
    if (problems.length > 0) {
      failures++
      banner(`DIVERGENCE fixture=${fixture} cmd=${cmd.join(" ")}`)
      for (const p of problems) console.log(p)
    }
    cleanup([a, b])
  }
}

if (proveRed) {
  if (failures === 0) {
    console.error("prove-red FAILED: harness did not detect the planted divergence")
    process.exit(1)
  }
  console.log(`prove-red OK: harness detected ${failures} planted divergence(s)`)
  process.exit(0)
}

if (failures > 0) {
  console.error(`\nparity-dryrun: ${failures} divergence(s)`)
  process.exit(1)
}
console.log(`parity-dryrun: OK (${FIXTURES.length} fixtures x ${COMMANDS.length} commands, side B=${sideB})`)
