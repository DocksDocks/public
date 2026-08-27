import { Argument, Command, Flag } from "effect/unstable/cli"
import { Effect, Option } from "effect"
import { spawnSync } from "node:child_process"
import { existsSync } from "node:fs"
import { join } from "node:path"
import { bail, engine } from "../engine"
import type { Logger } from "../engine-native/logger"
import { kitHome } from "../kitHome"
import { LoggerService } from "../services"

/** Best-effort update autodetection: nudge (never block, never fail) when
 * the kit checkout is behind its upstream. Silent on detached HEADs, no
 * upstream, no network, no git. */
const updateNudge = (logger: Logger): void => {
  try {
    const home = kitHome()
    if (!existsSync(join(home, ".git"))) return
    if (spawnSync("git", ["-C", home, "fetch", "--quiet"], { stdio: "ignore", timeout: 4000 }).status !== 0) return
    const res = spawnSync("git", ["-C", home, "rev-list", "--count", "HEAD..@{u}"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"]
    })
    const behind = (res.stdout ?? "").trim()
    if (res.status === 0 && behind !== "" && behind !== "0") {
      logger.warn(`kit checkout is ${behind} commit(s) behind its upstream — run: docks-kit update`)
    }
  } catch {
    // nudge only — a sync must never fail because the update check did
  }
}

const VALID_TARGETS = ["claude", "codex", "agents", "omp"]

const targets = Argument.variadic(
  Argument.string("target").pipe(
    Argument.withDescription("Sync targets: claude, codex, agents, omp (default: selected harnesses)")
  )
)

const dryRun = Flag.boolean("dry-run").pipe(
  Flag.withDescription("Preview without applying")
)
const reconcile = Flag.boolean("reconcile").pipe(
  Flag.withDescription("Reconcile kit-owned settings with SoT (SoT keys win; user-only keys preserved; permissions arrays replaced)")
)
const prune = Flag.boolean("prune").pipe(
  Flag.withDescription("Uninstall kit-managed installs not in SoT (plugins, marketplaces, universal skills)")
)
const skipBubblewrap = Flag.boolean("skip-bubblewrap").pipe(
  Flag.withDescription("Skip optional bubblewrap bootstrap (Codex Linux sandbox)")
)
const skipPluginRefresh = Flag.boolean("skip-plugin-refresh").pipe(
  Flag.withDescription("Install missing plugins but skip refresh-only updates for existing plugins")
)
const verbose = Flag.boolean("verbose").pipe(
  Flag.withAlias("v"),
  Flag.withDescription("Also print no-op confirmations (already in sync, up to date, left as-is)")
)
const claudeModel = Flag.string("claude-model").pipe(
  Flag.withDescription("Deploy-time modifier: set deployed Claude model (see `docks-kit models claude`)"),
  Flag.optional
)
const claudeEffort = Flag.string("claude-effort").pipe(
  Flag.withDescription("Deploy-time modifier: set Claude effortLevel (bare flag shows valid levels)"),
  Flag.optional
)
const claudeAdvisor = Flag.string("claude-advisor").pipe(
  Flag.withDescription("Deploy-time modifier: set Claude advisor on/off/default"),
  Flag.optional
)
const claudeCompactWindow = Flag.string("claude-compact-window").pipe(
  Flag.withDescription("Deploy-time modifier: set deployed autocompact window in tokens (e.g. 680000 or 680k)"),
  Flag.optional
)
const claudePermissive = Flag.boolean("claude-permissive").pipe(
  Flag.withDescription("Deploy-time modifier: empty permissions.ask/deny in deployed settings (sandboxes)")
)
const claudePlugin = Flag.string("claude-plugin").pipe(
  Flag.withDescription(
    "Sticky opt-in plugin(s); repeatable and/or comma-separated (known: supabase, n8n)"
  ),
  Flag.atLeast(0)
)
const codexModel = Flag.string("codex-model").pipe(
  Flag.withDescription("Deploy-time modifier: set deployed Codex model (see `docks-kit models codex`)"),
  Flag.optional
)
const codexEffort = Flag.string("codex-effort").pipe(
  Flag.withDescription("Deploy-time modifier: set Codex model_reasoning_effort (bare flag shows valid levels)"),
  Flag.optional
)

export const syncCommand = Command.make(
  "sync",
  {
    targets,
    dryRun,
    reconcile,
    prune,
    skipBubblewrap,
    skipPluginRefresh,
    verbose,
    claudeModel,
    claudeEffort,
    claudeAdvisor,
    claudeCompactWindow,
    claudePermissive,
    claudePlugin,
    codexModel,
    codexEffort
  },
  (config) =>
    Effect.gen(function* () {
      const bad = config.targets.filter((t) => !VALID_TARGETS.includes(t))
      if (bad.length > 0) {
        return yield* bail(
          `Unknown sync target(s): ${bad.join(", ")} (valid: ${VALID_TARGETS.join(", ")})`
        )
      }

      const args: Array<string> = ["sync", ...config.targets]
      if (config.dryRun) args.push("--dry-run")
      if (config.reconcile) args.push("--reconcile")
      if (config.prune) args.push("--prune")
      if (config.skipBubblewrap) args.push("--skip-bubblewrap")
      if (config.skipPluginRefresh) args.push("--skip-plugin-refresh")
      if (config.verbose) args.push("--verbose")
      if (config.claudePermissive) args.push("--claude-permissive")
      Option.map(config.claudeModel, (m) => args.push(`--claude-model=${m}`))
      Option.map(config.claudeEffort, (level) => args.push(`--claude-effort=${level}`))
      Option.map(config.claudeAdvisor, (state) => args.push(`--claude-advisor=${state}`))
      Option.map(config.claudeCompactWindow, (w) => args.push(`--claude-compact-window=${w}`))
      Option.map(config.codexModel, (m) => args.push(`--codex-model=${m}`))
      Option.map(config.codexEffort, (level) => args.push(`--codex-effort=${level}`))
      for (const occurrence of config.claudePlugin) {
        if (occurrence.trim() === "") {
          args.push("--claude-plugin=")
          continue
        }
        occurrence
          .split(",")
          .map((p) => p.trim())
          .filter((p) => p.length > 0)
          .forEach((p) => args.push(`--claude-plugin=${p}`))
      }

      // Not on --dry-run: the nudge's git fetch writes FETCH_HEAD/remote
      // refs, and a preview command must not mutate the checkout.
      if (!config.dryRun) {
        const logger = yield* LoggerService
        yield* Effect.sync(() => updateNudge(logger))
      }
      yield* engine(args)
    })
).pipe(
  Command.withDescription(
    "Deploy the SoT to this machine with EngineNative. Deploy-time modifiers touch deployed config only; a later flag-less sync reverts them to SoT."
  )
)
