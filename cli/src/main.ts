#!/usr/bin/env bun
import { Command, Options } from "@effect/cli"
import { BunContext, BunRuntime } from "@effect/platform-bun"
import { Console, Effect, Layer, Option } from "effect"
import { engine } from "./engine"
import { EngineServicesLive } from "./services"
import { docsCommand } from "./commands/docs"
import { modelCommand } from "./commands/model"
import { modelsCommand } from "./commands/models"
import { pluginsCommand } from "./commands/plugins"
import { skillsCommand } from "./commands/skills"
import { statusCommand } from "./commands/status"
import { syncCommand } from "./commands/sync"
import { toolchainCommand } from "./commands/toolchain"
import { updateCommand } from "./commands/update"
import { GENERATED_PACKAGE_VERSION } from "./generated/sotPayload"

const modelOrchestrator = Options.text("model-orchestrator").pipe(
  Options.withDescription("Override the Docks workflow orchestrator role"),
  Options.optional
)
const modelReviewer = Options.text("model-reviewer").pipe(
  Options.withDescription("Override the Docks workflow reviewer role"),
  Options.optional
)
const modelImplementer = Options.text("model-implementer").pipe(
  Options.withDescription("Override the Docks workflow implementer role"),
  Options.optional
)
const reviewMinScore = Options.text("review-min-score").pipe(
  Options.withDescription("Override the Docks review minimum score (0..100)"),
  Options.optional
)
const reviewMaxRounds = Options.text("review-max-rounds").pipe(
  Options.withDescription("Override the Docks review maximum rounds (1..10)"),
  Options.optional
)

const root = Command.make("docks-kit", {
  modelOrchestrator,
  modelReviewer,
  modelImplementer,
  reviewMinScore,
  reviewMaxRounds
}, (config) =>
  Effect.gen(function* () {
    const workflowArgs: Array<string> = ["workflow"]
    Option.map(config.modelOrchestrator, (value) => workflowArgs.push(`--model-orchestrator=${value}`))
    Option.map(config.modelReviewer, (value) => workflowArgs.push(`--model-reviewer=${value}`))
    Option.map(config.modelImplementer, (value) => workflowArgs.push(`--model-implementer=${value}`))
    Option.map(config.reviewMinScore, (value) => workflowArgs.push(`--review-min-score=${value}`))
    Option.map(config.reviewMaxRounds, (value) => workflowArgs.push(`--review-max-rounds=${value}`))
    if (workflowArgs.length > 1) {
      yield* engine(workflowArgs)
      return
    }
    yield* Console.log("docks-kit — portable AI coding agent config kit")
    yield* Console.log("")
    yield* Console.log("  docks-kit sync [claude] [codex] [agents]   deploy the SoT to this machine")
    yield* Console.log("  docks-kit update [--no-sync]              self-update the kit, then sync")
    yield* Console.log("  docks-kit model <claude|codex> [value]     get/set the deployed model")
    yield* Console.log("  docks-kit models [tool]                    kit-verified model catalog")
    yield* Console.log("  docks-kit toolchain [check|ensure <tool>]  verified-version floors")
    yield* Console.log("  docks-kit status                           deployed-vs-SoT doctor view")
    yield* Console.log("  docks-kit plugins list                     plugin tri-state")
    yield* Console.log("  docks-kit skills list                      universal skills")
    yield* Console.log("  docks-kit docs [topic]                     self-documentation")
    yield* Console.log("")
    yield* Console.log("Run 'docks-kit --help' for full option listings (also: --wizard, --completions).")
    yield* Console.log("No-Bun recovery path: use a platform release binary.")
  })
).pipe(
  Command.withDescription(
    "Portable AI coding agent config kit — SoT sync engine + helpers for Claude Code, Codex, and universal agent skills."
  ),
  Command.withSubcommands([
    syncCommand,
    updateCommand,
    modelCommand,
    modelsCommand,
    toolchainCommand,
    statusCommand,
    pluginsCommand,
    skillsCommand,
    docsCommand
  ])
)

// Harness-private raw channel:
// `DOCKS_KIT_ENGINE=native-raw` bypasses @effect/cli and hands the raw engine
// argv to EngineNative so golden tests drive the internal vocabulary directly.
// PUBLIC engine execution lives at the engine.ts seam after the CLI has
// parsed/normalized pickers, --flag value forms, and non-engine commands.
if (process.env["DOCKS_KIT_ENGINE"] === "native-raw") {
  const { runEngineNative } = await import("./engine-native")
  process.exit(runEngineNative(process.argv.slice(2)))
}

const cli = Command.run(root, {
  name: "docks-kit",
  version: GENERATED_PACKAGE_VERSION
})

// Normalize the repeatable plugin's documented equals form and exact empty
// text-option assignments that @effect/cli otherwise routes into positional
// targets. EngineNative owns the resulting shared empty-value validation.
const emptyTextOptions = new Set([
  "--claude-model=",
  "--claude-effort=",
  "--claude-advisor=",
  "--codex-model=",
  "--codex-effort=",
  "--model-orchestrator=",
  "--model-reviewer=",
  "--model-implementer=",
  "--review-min-score=",
  "--review-max-rounds="
])
const workflowTextOptions = new Set([
  "--model-orchestrator",
  "--model-reviewer",
  "--model-implementer",
  "--review-min-score",
  "--review-max-rounds"
])
const argv = process.argv.flatMap((a, index, all) => {
  if (a.startsWith("--claude-plugin=")) {
    return ["--claude-plugin", a.slice("--claude-plugin=".length)]
  }
  if (emptyTextOptions.has(a)) return [a.slice(0, -1), ""]
  if (workflowTextOptions.has(a) && (all[index + 1] === undefined || all[index + 1]!.startsWith("--"))) {
    return [a, ""]
  }
  return [a]
})

cli(argv).pipe(Effect.provide(Layer.mergeAll(BunContext.layer, EngineServicesLive)), BunRuntime.runMain)
