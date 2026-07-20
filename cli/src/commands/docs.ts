import { Args, Command, Options } from "@effect/cli"
import { Console, Effect, Option } from "effect"
import { bail } from "../engine"
import overview from "../../docs/overview.md" with { type: "text" }
import flags from "../../docs/flags.md" with { type: "text" }
import modifiers from "../../docs/modifiers.md" with { type: "text" }
import models from "../../docs/models.md" with { type: "text" }
import toolchain from "../../docs/toolchain.md" with { type: "text" }
import plugins from "../../docs/plugins.md" with { type: "text" }
import syncLayers from "../../docs/sync-layers.md" with { type: "text" }
import install from "../../docs/install.md" with { type: "text" }
import platforms from "../../docs/platforms.md" with { type: "text" }

const TOPICS: Record<string, { summary: string; body: string }> = {
  "overview": { summary: "What docks-kit is and how the pieces fit", body: overview },
  "sync-layers": { summary: "The three sync layers and additive-by-default semantics", body: syncLayers },
  "flags": { summary: "Full flag reference incl. the old→new rename table", body: flags },
  "modifiers": { summary: "Deploy-time modifiers and the flag-less-sync-reverts contract", body: modifiers },
  "models": { summary: "Model catalog, validation rules, model get/set", body: models },
  "toolchain": { summary: "Verified-version floors, gate policy, --yes semantics", body: toolchain },
  "plugins": { summary: "enabledPlugins tri-state + optional plugin opt-ins", body: plugins },
  "install": { summary: "Install paths: repo checkout, bun add -g, curl installer", body: install },
  "platforms": { summary: "Platform support: Linux/macOS x64 and arm64", body: platforms }
}

const topic = Args.text({ name: "topic" }).pipe(
  Args.withDescription(`One of: ${Object.keys(TOPICS).join(", ")}`),
  Args.optional
)
const json = Options.boolean("json").pipe(
  Options.withDescription("List topics as JSON")
)

export const docsCommand = Command.make("docs", { topic, json }, (config) =>
  Effect.gen(function* () {
    const requested = Option.getOrUndefined(config.topic)

    if (requested === undefined) {
      if (config.json) {
        return yield* Console.log(
          JSON.stringify(
            Object.entries(TOPICS).map(([name, t]) => ({ name, summary: t.summary })),
            null,
            2
          )
        )
      }
      yield* Console.log("docks-kit documentation topics (docks-kit docs <topic>):\n")
      for (const [name, t] of Object.entries(TOPICS)) {
        yield* Console.log(`  ${name.padEnd(14)} ${t.summary}`)
      }
      return
    }

    const entry = TOPICS[requested]
    if (entry === undefined) {
      return yield* bail(`Unknown topic '${requested}'. Valid: ${Object.keys(TOPICS).join(", ")}`)
    }
    yield* Console.log(entry.body)
  })
).pipe(
  Command.withDescription(
    "Self-documentation: the kit's concepts as readable topics, bundled with the CLI — a fresh agent can learn the kit from here alone."
  )
)
