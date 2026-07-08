import { Args, Command, Options } from "@effect/cli"
import { Console, Effect, Option } from "effect"
import { bail } from "../engine"
import { pluginsView } from "../manifests"

const action = Args.text({ name: "action" }).pipe(
  Args.withDescription("list (default)"),
  Args.optional
)
const json = Options.boolean("json").pipe(
  Options.withDescription("Machine-readable output")
)

export const pluginsCommand = Command.make("plugins", { action, json }, (config) =>
  Effect.gen(function* () {
    const act = Option.getOrElse(config.action, () => "list")
    if (act !== "list") {
      return yield* bail(
        `Unknown plugins action '${act}' (valid: list). Install/removal runs through sync: --claude-plugin=<name> opts in, --prune reconciles.`
      )
    }
    const view = pluginsView()
    if (config.json) {
      return yield* Console.log(JSON.stringify(view, null, 2))
    }
    yield* Console.log("SoT tri-state: true = enabled everywhere, false = installed-but-disabled (per-project enable), absent = not kit-managed\n")
    yield* Console.log(`${"PLUGIN".padEnd(44)} ${"SOT".padEnd(7)} INSTALLED`)
    for (const p of view) {
      yield* Console.log(`${p.plugin.padEnd(44)} ${p.sot.padEnd(7)} ${p.installed ? "yes" : "no"}`)
    }
  })
).pipe(
  Command.withDescription("Installed plugins vs SoT enabledPlugins tri-state (read-only).")
)
