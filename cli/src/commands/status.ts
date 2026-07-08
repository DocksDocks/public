import { Command, Options } from "@effect/cli"
import { Console, Effect } from "effect"
import { engineCapture } from "../engine"
import {
  deployedClaudeSettings,
  deployedCodexModel,
  pluginsView,
  skillsView,
  sotClaudeSettings,
  sotCodexModel
} from "../manifests"
import { kitHome } from "../kitHome"

const json = Options.boolean("json").pipe(
  Options.withDescription("Machine-readable output")
)

interface Drift {
  readonly setting: string
  readonly deployed: string
  readonly sot: string
  readonly drifted: boolean
}

const gatherDrift = (): Array<Drift> => {
  const sot = sotClaudeSettings()
  const dep = deployedClaudeSettings() ?? {}
  const row = (setting: string, deployed: unknown, sotVal: unknown): Drift => {
    const d = String(deployed ?? "(unset)")
    const s = String(sotVal ?? "(unset)")
    return { setting, deployed: d, sot: s, drifted: d !== s }
  }
  return [
    row("claude.model", dep.model, sot.model),
    row("claude.effortLevel", dep.effortLevel, sot.effortLevel),
    row(
      "claude.compactWindow",
      dep.env?.CLAUDE_CODE_AUTO_COMPACT_WINDOW,
      sot.env?.CLAUDE_CODE_AUTO_COMPACT_WINDOW
    ),
    row("codex.model", deployedCodexModel(), sotCodexModel())
  ]
}

export const statusCommand = Command.make("status", { json }, (config) =>
  Effect.gen(function* () {
    const drift = gatherDrift()
    const plugins = pluginsView()
    const skills = skillsView()
    const toolchainTable = yield* engineCapture(["toolchain", "check"])

    if (config.json) {
      return yield* Console.log(
        JSON.stringify({ kitHome: kitHome(), drift, plugins, skills, toolchainTable }, null, 2)
      )
    }

    yield* Console.log(`Kit home: ${kitHome()}\n`)
    yield* Console.log("Deployed vs SoT (drift is expected for deploy-time modifiers):")
    for (const d of drift) {
      const mark = d.drifted ? "≠" : "="
      yield* Console.log(`  ${d.setting.padEnd(22)} deployed=${d.deployed}  ${mark}  SoT=${d.sot}`)
    }
    yield* Console.log("\nToolchain:")
    yield* Console.log(toolchainTable.trimEnd())
    const enabled = plugins.filter((p) => p.sot === "true").length
    yield* Console.log(
      `\nPlugins: ${plugins.length} known (${enabled} SoT-enabled) — details: docks-kit plugins list`
    )
    const installed = skills.filter((s) => s.installed).length
    yield* Console.log(
      `Skills:  ${skills.length} known (${installed} installed) — details: docks-kit skills list`
    )
  })
).pipe(
  Command.withDescription(
    "Doctor view: deployed-vs-SoT drift (model, effort, compact window), toolchain table, plugin/skill counts."
  )
)
