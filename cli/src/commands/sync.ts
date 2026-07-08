import { Args, Command, Options } from "@effect/cli"
import { Effect, Option } from "effect"
import { bail, engine } from "../engine"

const VALID_TARGETS = ["claude", "codex", "agents"]

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
const claudeModel = Options.text("claude-model").pipe(
  Options.withDescription("Deploy-time modifier: set deployed Claude model (see `docks-kit models claude`)"),
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
  Options.withDescription("Sticky opt-in plugin(s), comma-separated (known: supabase, n8n)"),
  Options.optional
)
const codexModel = Options.text("codex-model").pipe(
  Options.withDescription("Deploy-time modifier: set deployed Codex model (see `docks-kit models codex`)"),
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
    claudeModel,
    claudeCompactWindow,
    claudePermissive,
    claudePlugin,
    codexModel
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
      if (config.skipRtk) args.push("--skip-rtk")
      if (config.yes) args.push("--yes")
      if (config.claudePermissive) args.push("--claude-permissive")
      Option.map(config.claudeModel, (m) => args.push(`--claude-model=${m}`))
      Option.map(config.claudeCompactWindow, (w) => args.push(`--claude-compact-window=${w}`))
      Option.map(config.codexModel, (m) => args.push(`--codex-model=${m}`))
      Option.map(config.claudePlugin, (list) =>
        list
          .split(",")
          .map((p) => p.trim())
          .filter((p) => p.length > 0)
          .forEach((p) => args.push(`--claude-plugin=${p}`))
      )

      yield* engine(args)
    })
).pipe(
  Command.withDescription(
    "Deploy the SoT to this machine (engine: lib/engine.sh — same flags, zero-dependency escape hatch). Deploy-time modifiers touch deployed config only; a later flag-less sync reverts them to SoT."
  )
)
