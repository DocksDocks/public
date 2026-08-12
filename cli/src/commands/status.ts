import { Command, Flag } from "effect/unstable/cli"
import { Console, Effect } from "effect"
import { engineCapture, type EngineCaptureError } from "../engine"
import {
  deployedClaudeSettings,
  deployedCodexModel,
  pluginsView,
  skillsView,
  sotClaudeSettings,
  sotCodexModel
} from "../manifests"
import { kitHome } from "../kitHome"

const json = Flag.boolean("json").pipe(
  Flag.withDescription("Machine-readable output")
)

interface Drift {
  readonly setting: string
  readonly deployed: string
  readonly sot: string
  readonly drifted: boolean
}

type ClaudeDeployment =
  | { readonly state: "absent" }
  | { readonly state: "valid"; readonly settings: Record<string, unknown> }
  | { readonly state: "malformed"; readonly diagnostic: string }

const captureToolchainStatus = () =>
  engineCapture(["toolchain", "check"]).pipe(
    Effect.map((table) => ({ state: "valid" as const, table })),
    Effect.catch((error: EngineCaptureError) =>
      Effect.succeed({
        state: "failed" as const,
        table: "",
        diagnostic: error.diagnostic,
        exitCode: error.code
      })
    )
  )

const readClaudeDeployment = (): ClaudeDeployment => {
  try {
    const settings: unknown = deployedClaudeSettings()
    if (settings === undefined) return { state: "absent" }
    if (settings === null || typeof settings !== "object" || Array.isArray(settings)) {
      return {
        state: "malformed",
        diagnostic: "deployed Claude settings must contain a JSON object"
      }
    }
    return { state: "valid", settings: settings as Record<string, unknown> }
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    return {
      state: "malformed",
      diagnostic: `deployed Claude settings contain invalid JSON: ${detail}`
    }
  }
}

const gatherDrift = (): {
  readonly drift: Array<Drift>
  readonly claudeDeployment: ClaudeDeployment
} => {
  const sot = sotClaudeSettings()
  const claudeDeployment = readClaudeDeployment()
  const row = (setting: string, deployed: unknown, sotVal: unknown): Drift => {
    const d = String(deployed ?? "(unset)")
    const s = String(sotVal ?? "(unset)")
    return { setting, deployed: d, sot: s, drifted: d !== s }
  }
  const codex = row("codex.model", deployedCodexModel(), sotCodexModel())
  if (claudeDeployment.state === "absent") {
    return {
      claudeDeployment,
      drift: [
        { setting: "claude.settings", deployed: "(absent)", sot: "present", drifted: true },
        codex
      ]
    }
  }
  if (claudeDeployment.state === "malformed") {
    return {
      claudeDeployment,
      drift: [
        { setting: "claude.settings", deployed: "(malformed)", sot: "present", drifted: true },
        codex
      ]
    }
  }

  const dep = claudeDeployment.settings
  const env =
    dep.env !== null && typeof dep.env === "object" && !Array.isArray(dep.env)
      ? (dep.env as Record<string, unknown>)
      : {}
  return {
    claudeDeployment,
    drift: [
      row("claude.model", dep.model, sot.model),
      row("claude.effortLevel", dep.effortLevel, sot.effortLevel),
      row(
        "claude.compactWindow",
        env.CLAUDE_CODE_AUTO_COMPACT_WINDOW,
        sot.env?.CLAUDE_CODE_AUTO_COMPACT_WINDOW
      ),
      codex
    ]
  }
}

export const statusCommand = Command.make("status", { json }, (config) =>
  Effect.gen(function* () {
    const { drift, claudeDeployment } = gatherDrift()
    const plugins = pluginsView()
    const skills = skillsView()
    const toolchain = yield* captureToolchainStatus()
    const diagnostics = new Array<{ source: string; message: string; exitCode: number }>()
    if (claudeDeployment.state === "malformed") {
      diagnostics.push({
        source: "claude.settings",
        message: claudeDeployment.diagnostic,
        exitCode: 1
      })
    }
    if (toolchain.state === "failed") {
      diagnostics.push({
        source: "toolchain",
        message: toolchain.diagnostic ?? "toolchain capture failed",
        exitCode: toolchain.exitCode ?? 1
      })
    }

    if (config.json) {
      const deployment =
        claudeDeployment.state === "malformed"
          ? { claude: { state: claudeDeployment.state, diagnostic: claudeDeployment.diagnostic } }
          : { claude: { state: claudeDeployment.state } }
      yield* Console.log(
        JSON.stringify(
          {
            kitHome: kitHome(),
            deployment,
            drift,
            plugins,
            skills,
            toolchain,
            diagnostics
          },
          null,
          2
        )
      )
    } else {
      yield* Console.log(`Kit home: ${kitHome()}\n`)
      yield* Console.log("Deployed vs SoT (drift is expected for deploy-time modifiers):")
      for (const d of drift) {
        const mark = d.drifted ? "≠" : "="
        yield* Console.log(`  ${d.setting.padEnd(22)} deployed=${d.deployed}  ${mark}  SoT=${d.sot}`)
      }
      if (claudeDeployment.state === "malformed") {
        yield* Console.log(`  ERROR claude.settings: ${claudeDeployment.diagnostic}`)
      }
      yield* Console.log("\nToolchain:")
      if (toolchain.state === "failed") {
        yield* Console.log(`  ERROR: ${toolchain.diagnostic}`)
      } else {
        yield* Console.log(toolchain.table.trimEnd())
      }
      const enabled = plugins.filter((p) => p.sot === "true").length
      yield* Console.log(
        `\nPlugins: ${plugins.length} known (${enabled} SoT-enabled) — details: docks-kit plugins list`
      )
      const installed = skills.filter((s) => s.installed).length
      yield* Console.log(
        `Skills:  ${skills.length} known (${installed} installed) — details: docks-kit skills list`
      )
    }

    if (diagnostics.length > 0) {
      yield* Effect.sync(() => {
        process.exitCode = diagnostics[0]?.exitCode ?? 1
      })
    }
  })
).pipe(
  Command.withDescription(
    "Doctor view: deployed-vs-SoT drift, toolchain, and plugin/skill counts."
  )
)
