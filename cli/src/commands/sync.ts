import { Args, Command, Options } from "@effect/cli"
import { Effect, Option } from "effect"
import { spawnSync } from "node:child_process"
import { existsSync } from "node:fs"
import { join } from "node:path"
import { bail, engine } from "../engine"
import type { Logger } from "../engine-native/logger"
import {
  advisorCatalog,
  advisorFlagGrammar,
  effortCatalog,
  effortFlagGrammar
} from "../efforts"
import { kitHome } from "../kitHome"
import { modelCatalog, type Tool } from "../manifests"
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

const VALID_TARGETS = ["claude", "codex", "agents"]

// Renamed pre-CLI flags: @effect/cli routes unknown flags into the excess
// positional args, so the rename hints are mirrored here before EngineNative
// sees the normalized argv.
const LEGACY_HINTS: Record<string, string> = {
  "--force": "--force was renamed to --reconcile",
  "--remove-plugins":
    "--remove-plugins was renamed to --prune (it also removes marketplaces + kit-managed skills)",
  "--680k": "--680k was renamed to --claude-compact-window=680k",
  "--permissive": "--permissive was renamed to --claude-permissive",
  "--supabase": "--supabase was renamed to --claude-plugin=supabase",
  "--n8n": "--n8n was renamed to --claude-plugin=n8n",
  "--no-rtk": "--no-rtk was renamed to --skip-rtk",
  "--claude": "--claude was renamed: pass the target as a word, e.g. 'sync claude'",
  "--codex": "--codex was renamed: pass the target as a word, e.g. 'sync codex'",
  "--agents": "--agents was renamed: pass the target as a word, e.g. 'sync agents'"
}

const modelCatalogHint = (t: Tool): string => {
  const c = modelCatalog(t)
  const list = c.models
    .map((m) => `  ${m.id}${m.note !== undefined ? `  — ${m.note}` : ""}`)
    .join("\n")
  return `Available ${t} models (kit-verified ${c.verified} — SoT/models.json):\n${list}`
}

const targets = Args.text({ name: "target" }).pipe(
  Args.withDescription("Sync targets: claude, codex, agents (default: all three)"),
  Args.repeated
)

const dryRun = Options.boolean("dry-run").pipe(
  Options.withDescription("Preview without applying")
)
const reconcile = Options.boolean("reconcile").pipe(
  Options.withDescription("Reconcile kit-owned settings with SoT (SoT keys win; user-only keys preserved; permissions arrays replaced)")
)
const prune = Options.boolean("prune").pipe(
  Options.withDescription("Uninstall kit-managed installs not in SoT (plugins, marketplaces, universal skills)")
)
const skipRtk = Options.boolean("skip-rtk").pipe(
  Options.withDescription("Skip optional tool bootstrap (RTK, bubblewrap)")
)
const yes = Options.boolean("yes").pipe(
  Options.withDescription("Auto-accept toolchain prompts (containers/CI)")
)
const verbose = Options.boolean("verbose").pipe(
  Options.withAlias("v"),
  Options.withDescription("Also print no-op confirmations (already in sync, up to date, left as-is)")
)
const claudeModel = Options.text("claude-model").pipe(
  Options.withDescription("Deploy-time modifier: set deployed Claude model (see `docks-kit models claude`)"),
  Options.optional
)
const claudeEffort = Options.text("claude-effort").pipe(
  Options.withDescription("Deploy-time modifier: set Claude effortLevel (bare flag shows valid levels)"),
  Options.optional
)
const claudeAdvisor = Options.text("claude-advisor").pipe(
  Options.withDescription("Deploy-time modifier: set Claude advisor on/off/default"),
  Options.optional
)
const claudeCompactWindow = Options.text("claude-compact-window").pipe(
  Options.withDescription("Deploy-time modifier: set deployed autocompact window in tokens (e.g. 680000 or 680k)"),
  Options.optional
)
const claudePermissive = Options.boolean("claude-permissive").pipe(
  Options.withDescription("Deploy-time modifier: empty permissions.ask/deny in deployed settings (sandboxes)")
)
const claudePlugin = Options.text("claude-plugin").pipe(
  Options.withDescription(
    "Sticky opt-in plugin(s); repeatable and/or comma-separated (known: supabase, n8n)"
  ),
  Options.repeated
)
const codexModel = Options.text("codex-model").pipe(
  Options.withDescription("Deploy-time modifier: set deployed Codex model (see `docks-kit models codex`)"),
  Options.optional
)
const codexEffort = Options.text("codex-effort").pipe(
  Options.withDescription("Deploy-time modifier: set Codex model_reasoning_effort (bare flag shows valid levels)"),
  Options.optional
)

export const syncCommand = Command.make(
  "sync",
  {
    targets,
    dryRun,
    reconcile,
    prune,
    skipRtk,
    yes,
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
      for (const t of config.targets) {
        if (VALID_TARGETS.includes(t)) continue
        if (t === "--claude-model" || t === "--codex-model") {
          const tool: Tool = t === "--claude-model" ? "claude" : "codex"
          return yield* bail(`${modelCatalogHint(tool)}\n${t} requires a value: ${t}=<model>`)
        }
        if (t === "--claude-effort" || t === "--codex-effort") {
          const tool: Tool = t === "--claude-effort" ? "claude" : "codex"
          return yield* bail(`${effortCatalog(tool)}\n${t} requires a value: ${effortFlagGrammar(tool)}`)
        }
        if (t === "--claude-advisor") {
          return yield* bail(`${advisorCatalog()}\n${t} requires a value: ${advisorFlagGrammar()}`)
        }
        const hint = LEGACY_HINTS[t]
        if (hint !== undefined) {
          return yield* bail(hint)
        }
      }
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
      if (config.skipRtk) args.push("--skip-rtk")
      if (config.yes) args.push("--yes")
      if (config.verbose) args.push("--verbose")
      if (config.claudePermissive) args.push("--claude-permissive")
      Option.map(config.claudeModel, (m) => args.push(`--claude-model=${m}`))
      Option.map(config.claudeEffort, (level) => args.push(`--claude-effort=${level}`))
      Option.map(config.claudeAdvisor, (state) => args.push(`--claude-advisor=${state}`))
      Option.map(config.claudeCompactWindow, (w) => args.push(`--claude-compact-window=${w}`))
      Option.map(config.codexModel, (m) => args.push(`--codex-model=${m}`))
      Option.map(config.codexEffort, (level) => args.push(`--codex-effort=${level}`))
      for (const occurrence of config.claudePlugin) {
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
