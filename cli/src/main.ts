#!/usr/bin/env bun
import { Command } from "@effect/cli"
import { BunContext, BunRuntime } from "@effect/platform-bun"
import { Console, Effect } from "effect"
import { docsCommand } from "./commands/docs"
import { modelCommand } from "./commands/model"
import { modelsCommand } from "./commands/models"
import { pluginsCommand } from "./commands/plugins"
import { skillsCommand } from "./commands/skills"
import { statusCommand } from "./commands/status"
import { syncCommand } from "./commands/sync"
import { toolchainCommand } from "./commands/toolchain"

const root = Command.make("docks-kit", {}, () =>
  Effect.gen(function* () {
    yield* Console.log("docks-kit — portable AI coding agent config kit")
    yield* Console.log("")
    yield* Console.log("  docks-kit sync [claude] [codex] [agents]   deploy the SoT to this machine")
    yield* Console.log("  docks-kit model <claude|codex> [value]     get/set the deployed model")
    yield* Console.log("  docks-kit models [tool]                    kit-verified model catalog")
    yield* Console.log("  docks-kit toolchain [check|ensure <tool>]  verified-version floors")
    yield* Console.log("  docks-kit status                           deployed-vs-SoT doctor view")
    yield* Console.log("  docks-kit plugins list                     plugin tri-state")
    yield* Console.log("  docks-kit skills list                      universal skills")
    yield* Console.log("  docks-kit docs [topic]                     self-documentation")
    yield* Console.log("")
    yield* Console.log("Run 'docks-kit --help' for full option listings (also: --wizard, --completions).")
    yield* Console.log("Zero-dependency escape hatch: bash lib/engine.sh <same subcommands/flags>")
  })
).pipe(
  Command.withDescription(
    "Portable AI coding agent config kit — SoT sync engine + helpers for Claude Code, Codex, and universal agent skills."
  ),
  Command.withSubcommands([
    syncCommand,
    modelCommand,
    modelsCommand,
    toolchainCommand,
    statusCommand,
    pluginsCommand,
    skillsCommand,
    docsCommand
  ])
)

// EngineNative selector (windows-support plan, step 5): `DOCKS_KIT_ENGINE=native`
// bypasses @effect/cli entirely and hands the raw engine argv to the TS port,
// so the parity harnesses drive both engines through the identical vocabulary.
// Bash stays the default until step 6 flips it.
if (process.env["DOCKS_KIT_ENGINE"] === "native") {
  const { runEngineNative } = await import("./engine-native")
  process.exit(runEngineNative(process.argv.slice(2)))
}

const cli = Command.run(root, {
  name: "docks-kit",
  version: "0.1.0"
})

// @effect/cli's Options.repeated does not accept `--flag=value` syntax (only
// `--flag value`), but the documented form for the repeatable opt-in is
// `--claude-plugin=<name>` — normalize it here so both spellings work.
const argv = process.argv.flatMap((a) =>
  a.startsWith("--claude-plugin=")
    ? ["--claude-plugin", a.slice("--claude-plugin=".length)]
    : [a]
)

cli(argv).pipe(Effect.provide(BunContext.layer), BunRuntime.runMain)
