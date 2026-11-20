#!/usr/bin/env bun
import { Command, CliOutput } from "effect/cli";
import { BunRuntime, BunServices } from "@effect/platform-bun";
import { Console, Effect, Layer } from "effect";
import { EngineServicesLive } from "./services";
import { GENERATED_PACKAGE_VERSION } from "./generated/sotPayload";
import { COMMANDS, prepareArgv } from "./argv";
import { runEngineNative } from "./engine-native";

const root = Command.make("docks-kit", {}, () =>
  Effect.gen(function* () {
    yield* Console.log("docks-kit — portable AI coding agent config kit");
    yield* Console.log("");
    yield* Console.log(
      "  docks-kit sync [--dry-run]                deploy the SoT to this machine",
    );
    yield* Console.log(
      "  docks-kit update [--no-sync]              self-update the kit, then sync",
    );
    yield* Console.log("  docks-kit toolchain [check|ensure|outdated] verified-version floors");
    yield* Console.log("  docks-kit docs [topic]                     self-documentation");
    yield* Console.log("  docks-kit omp [--model|--pick] [...]       free-model omp session");
    yield* Console.log(
      "  docks-kit scratch new|remove              agent temporary files and directories",
    );
    yield* Console.log(
      "  docks-kit tidy [--apply] [--repo <path>] [--report] remove safe agent leftovers",
    );
    yield* Console.log(
      "  docks-kit plan <command> [...]            GitHub-issue plan records (plan-manager helper)",
    );
    yield* Console.log(
      "  docks-kit agent-docs <helper> <command> [...] agent-doc checks (agent-first-setup helpers)",
    );
    yield* Console.log("");
    yield* Console.log(
      "Run 'docks-kit --help' for full option listings (also: --wizard, --completions).",
    );
    yield* Console.log("No-Bun recovery path: use a platform release binary.");
  }),
).pipe(
  Command.withDescription(
    "Portable AI coding agent config kit — SoT sync engine + helpers for Oh My Pi.",
  ),
  Command.withSubcommands(COMMANDS),
);

// v4's default formatter renders `name vversion`, but the `docks-kit` launcher
// compares `--version` against the bare `package.json` version. The CLI output
// presenter prints the result with `Console.log`, which adds the one newline.
const bareVersionFormatter: CliOutput.Formatter = {
  ...CliOutput.defaultFormatter(),
  formatVersion: (_name, version) => version,
};

// Harness-private raw channel:
// `DOCKS_KIT_ENGINE=native-raw` bypasses effect/cli and hands the raw engine
// argv to EngineNative so golden tests drive the internal vocabulary directly.
// Only this channel honors the unprefixed env globals DRY_RUN and DOCKS_KIT_VERBOSE.
// PUBLIC engine execution lives at the engine.ts seam after the CLI has
// parsed/normalized pickers, --flag value forms, and non-engine commands.
if (process.env["DOCKS_KIT_ENGINE"] === "native-raw") {
  const rawArgs = process.argv.slice(2);
  const rawOperation = rawArgs.join(" ") || "default";
  // The raw channel bypasses BunRuntime.runMain, which turns a signal into
  // process.exit. Without a handler a signal ends the process without the
  // `exit` event, and exec.ts then cannot end its bounded probes.
  process.once("SIGINT", () => process.exit(130));
  process.once("SIGTERM", () => process.exit(143));
  try {
    process.exit(await runEngineNative(rawArgs, undefined, { envGlobals: true }));
  } catch (error) {
    let detail = "unknown error";
    if (error instanceof Error && error.message !== "") detail = error.message;
    else if (typeof error === "string" && error !== "") detail = error;
    process.stderr.write(`docks-kit raw operation '${rawOperation}' failed: ${detail}\n`);
    process.exit(1);
  }
}

// Validate and normalize before parsing because the kit refuses to guess at unrecognized
// or duplicated flags, and Effect 4 would otherwise negate `--no-<flag>` into a real
// mutating run. This seam owns argument normalization.
const prepared = prepareArgv(process.argv.slice(2));
if (prepared.kind === "reject") {
  process.stderr.write(`${prepared.message}\n`);
  process.exit(prepared.exitCode);
}

Command.runWith(root, { version: GENERATED_PACKAGE_VERSION })(prepared.args).pipe(
  Effect.provide(
    Layer.mergeAll(BunServices.layer, EngineServicesLive, CliOutput.layer(bareVersionFormatter)),
  ),
  BunRuntime.runMain,
);
