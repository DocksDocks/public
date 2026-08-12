#!/usr/bin/env bun
import { Command, CliOutput } from "effect/unstable/cli"
import { BunRuntime, BunServices } from "@effect/platform-bun"
import { Console, Effect, Layer } from "effect"
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
import { prepareArgv } from "./argv"
import { runEngineNative } from "./engine-native"


const root = Command.make("docks-kit", {}, () =>
  Effect.gen(function* () {
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

// v4's default formatter renders `name vversion`, but the `docks-kit` launcher
// compares `--version` against the bare `package.json` version. The trailing
// newline reproduces the characterized byte-for-byte output of the v3 CLI.
const bareVersionFormatter: CliOutput.Formatter = {
  ...CliOutput.defaultFormatter(),
  formatVersion: (_name, version) => `${version}\n`
}

// Harness-private raw channel:
// `DOCKS_KIT_ENGINE=native-raw` bypasses effect/unstable/cli and hands the raw engine
// argv to EngineNative so golden tests drive the internal vocabulary directly.
// PUBLIC engine execution lives at the engine.ts seam after the CLI has
// parsed/normalized pickers, --flag value forms, and non-engine commands.
if (process.env["DOCKS_KIT_ENGINE"] === "native-raw") {
  const rawArgs = process.argv.slice(2)
  const rawOperation = rawArgs.join(" ") || "default"
  try {
    process.exit(await runEngineNative(rawArgs))
  } catch (error) {
    let detail = "unknown error"
    if (error instanceof Error && error.message !== "") detail = error.message
    else if (typeof error === "string" && error !== "") detail = error
    process.stderr.write(`docks-kit raw operation '${rawOperation}' failed: ${detail}\n`)
    process.exit(1)
  }
}

// Validate and normalize before parsing because the kit refuses to guess at unrecognized
// or duplicated flags, and Effect 4 would otherwise negate `--no-<flag>` into a real
// mutating run. This seam owns argument normalization.
const prepared = prepareArgv(process.argv.slice(2))
if (prepared.kind === "reject") {
  process.stderr.write(`${prepared.message}\n`)
  process.exit(prepared.exitCode)
}

Command.runWith(root, { version: GENERATED_PACKAGE_VERSION })(prepared.args).pipe(
  Effect.provide(
    Layer.mergeAll(BunServices.layer, EngineServicesLive, CliOutput.layer(bareVersionFormatter))
  ),
  BunRuntime.runMain
)
