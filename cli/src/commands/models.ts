import { Argument, Command, Flag } from "effect/unstable/cli"
import { Console, Effect, Option } from "effect"
import { bail } from "../engine"
import { modelCatalog, type Tool } from "../manifests"

const tool = Argument.string("tool").pipe(
  Argument.withDescription("claude | codex (omit for both tool catalogs)"),
  Argument.optional
)
const json = Flag.boolean("json").pipe(
  Flag.withDescription("Machine-readable output")
)

const renderTool = (t: Tool) =>
  Effect.gen(function* () {
    const catalog = modelCatalog(t)
    yield* Console.log(`${t} models (kit-verified ${catalog.verified}):`)
    for (const m of catalog.models) {
      yield* Console.log(`  ${m.id.padEnd(28)} ${m.kind.padEnd(6)} ${m.note ?? ""}`)
    }
    yield* Console.log(
      t === "claude"
        ? "  (full claude-* model IDs outside the catalog are accepted with a warning)"
        : "  (well-formed IDs outside the catalog are accepted with a warning)"
    )
    yield* Console.log("")
  })

export const modelsCommand = Command.make("models", { tool, json }, (config) =>
  Effect.gen(function* () {
    const requested = Option.getOrUndefined(config.tool)
    if (requested !== undefined && requested !== "claude" && requested !== "codex") {
      return yield* bail(`Unknown tool '${requested}' (valid: claude, codex)`)
    }
    const tools: Array<Tool> = requested !== undefined ? [requested as Tool] : ["claude", "codex"]

    if (config.json) {
      const out = Object.fromEntries(tools.map((t) => [t, modelCatalog(t)]))
      return yield* Console.log(JSON.stringify(out, null, 2))
    }

    for (const t of tools) {
      yield* renderTool(t)
    }
  })
).pipe(
  Command.withDescription("List kit-verified Claude and Codex models (SoT/models.json).")
)
