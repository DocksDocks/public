import { GlobalFlag } from "effect/unstable/cli"
import { docsCommand } from "./commands/docs"
import { modelCommand } from "./commands/model"
import { modelsCommand } from "./commands/models"
import { pluginsCommand } from "./commands/plugins"
import { skillsCommand } from "./commands/skills"
import { statusCommand } from "./commands/status"
import { syncCommand } from "./commands/sync"
import { toolchainCommand } from "./commands/toolchain"
import { updateCommand } from "./commands/update"
import {
  advisorCatalog,
  advisorFlagGrammar,
  effortCatalog,
  effortFlagGrammar
} from "./efforts"
import { KNOWN_CLAUDE_OPTIN_PLUGINS } from "./engine-native/parseArgs"
import { modelCatalog, type Tool } from "./manifests"

export type ArgvOutcome =
  | { readonly kind: "reject"; readonly message: string; readonly exitCode: number }
  | { readonly kind: "accept"; readonly args: ReadonlyArray<string> }

interface FlagSurface {
  readonly longFlags: ReadonlyArray<string>
  readonly aliases: ReadonlyMap<string, string>
  readonly valueFlags: ReadonlyArray<string>
  readonly repeatableFlags: ReadonlyArray<string>
}
interface GlobalFlagSurface extends FlagSurface {
  readonly actionFlags: ReadonlySet<string>
}

interface CommandValue {
  readonly name: string
}


const flagMetadata = (
  param: unknown
): {
  readonly name: string
  readonly aliases: ReadonlyArray<string>
  readonly takesValue: boolean
  readonly repeatable: boolean
} => {
  let current = param
  let repeatable = false

  while (typeof current === "object" && current !== null) {
    if (!("_tag" in current)) break
    if (current._tag === "Variadic") repeatable = true
    if (current._tag !== "Single") {
      if (!("param" in current)) break
      current = current.param
      continue
    }

    if (!("name" in current) || typeof current.name !== "string") {
      throw new Error("Effect CLI exposed a flag without a string name")
    }
    if (
      !("aliases" in current) ||
      !Array.isArray(current.aliases) ||
      !current.aliases.every((alias) => typeof alias === "string")
    ) {
      throw new Error(`Effect CLI exposed invalid aliases for --${current.name}`)
    }
    if (
      !("primitiveType" in current) ||
      typeof current.primitiveType !== "object" ||
      current.primitiveType === null ||
      !("_tag" in current.primitiveType) ||
      typeof current.primitiveType._tag !== "string"
    ) {
      throw new Error(`Effect CLI exposed no primitive type for --${current.name}`)
    }
    const aliases: ReadonlyArray<string> = current.aliases
    return {
      name: current.name,
      aliases,
      takesValue: current.primitiveType._tag !== "Boolean",
      repeatable
    }
  }

  throw new Error("Effect CLI exposed an unsupported flag parameter")
}

const flagSurface = (params: ReadonlyArray<unknown>): FlagSurface => {
  const longFlags: Array<string> = []
  const aliases = new Map<string, string>()
  const valueFlags: Array<string> = []
  const repeatableFlags: Array<string> = []

  for (const param of params) {
    const metadata = flagMetadata(param)
    const longName = `--${metadata.name}`
    longFlags.push(longName)
    if (metadata.takesValue) valueFlags.push(longName)
    if (metadata.repeatable) repeatableFlags.push(longName)
    for (const alias of metadata.aliases) aliases.set(`-${alias}`, longName)
  }

  return { longFlags, aliases, valueFlags, repeatableFlags }
}

const commandSurface = (command: CommandValue): FlagSurface => {
  if (!("config" in command)) {
    throw new Error(`Effect CLI did not expose flags for '${command.name}'`)
  }
  const config = command.config
  if (
    typeof config !== "object" ||
    config === null ||
    !("flags" in config) ||
    !Array.isArray(config.flags)
  ) {
    throw new Error(`Effect CLI did not expose flags for '${command.name}'`)
  }

  return flagSurface(config.flags)
}

const globalSurface = (): GlobalFlagSurface => {
  const builtIns: unknown = GlobalFlag.BuiltIns
  if (!Array.isArray(builtIns)) {
    throw new Error("Effect CLI did not expose its built-in global flags")
  }

  const actionFlags = new Set<string>()
  const flags = builtIns.map((builtIn) => {
    if (
      (typeof builtIn !== "object" && typeof builtIn !== "function") ||
      builtIn === null ||
      !("flag" in builtIn) ||
      !("_tag" in builtIn) ||
      typeof builtIn._tag !== "string"
    ) {
      throw new Error("Effect CLI exposed an unsupported built-in global flag")
    }
    if (builtIn._tag === "Action") {
      // Only a presence-based action is idempotent. `--completions` is an action
      // that takes a value, and Effect 4 would silently keep the first one, which
      // is exactly what the duplicate rule exists to refuse.
      const metadata = flagMetadata(builtIn.flag)
      if (!metadata.takesValue) actionFlags.add(`--${metadata.name}`)
    }
    return builtIn.flag
  })
  return { ...flagSurface(flags), actionFlags }
}

const COMMANDS: ReadonlyArray<CommandValue> = [
  syncCommand,
  updateCommand,
  modelCommand,
  toolchainCommand,
  modelsCommand,
  statusCommand,
  pluginsCommand,
  skillsCommand,
  docsCommand
]

// A Map, not a plain object: an object literal answers `toString` and friends from
// `Object.prototype`, so an unknown subcommand with such a name would slip past the
// unknown-command guard and dereference a surface that was never built.
const COMMAND_SURFACES: ReadonlyMap<string, FlagSurface> = new Map(
  COMMANDS.map((command) => [command.name, commandSurface(command)])
)

const GLOBAL_SURFACE: GlobalFlagSurface = globalSurface()

const LEGACY_HINTS: Readonly<Record<string, string>> = {
  "--force": "--force was renamed to --reconcile",
  "--remove-plugins":
    "--remove-plugins was renamed to --prune (it also removes marketplaces + kit-managed skills)",
  "--680k": "--680k was renamed to --claude-compact-window=680k",
  "--permissive": "--permissive was renamed to --claude-permissive",
  "--supabase": "--supabase was renamed to --claude-plugin=supabase",
  "--n8n": "--n8n was renamed to --claude-plugin=n8n",
  "--skip-rtk": "--skip-rtk was renamed to --skip-bubblewrap",
  "--claude": "--claude was renamed: pass the target as a word, e.g. 'sync claude'",
  "--codex": "--codex was renamed: pass the target as a word, e.g. 'sync codex'",
  "--agents": "--agents was renamed: pass the target as a word, e.g. 'sync agents'"
}

const flagNameOf = (token: string): string => {
  const equals = token.indexOf("=")
  return equals === -1 ? token : token.slice(0, equals)
}

const canonicalFlagName = (
  name: string,
  surface: FlagSurface | undefined
): string | undefined => {
  if (surface === undefined) return undefined
  const aliased = surface.aliases.get(name)
  if (aliased !== undefined) return aliased
  return surface.longFlags.includes(name) ? name : undefined
}

const declaredFlagName = (
  name: string,
  commandSurface: FlagSurface | undefined
): string | undefined =>
  canonicalFlagName(name, commandSurface) ?? canonicalFlagName(name, GLOBAL_SURFACE)

const declaredInAnySurface = (name: string): boolean => {
  if (canonicalFlagName(name, GLOBAL_SURFACE) !== undefined) return true
  return COMMANDS.some(
    (command) => canonicalFlagName(name, COMMAND_SURFACES.get(command.name)) !== undefined
  )
}

const takesValueInAnySurface = (name: string): boolean => {
  const globalName = canonicalFlagName(name, GLOBAL_SURFACE)
  if (globalName !== undefined && GLOBAL_SURFACE.valueFlags.includes(globalName)) return true
  return COMMANDS.some((command) => {
    const surface = COMMAND_SURFACES.get(command.name)
    if (surface === undefined) return false
    const canonicalName = canonicalFlagName(name, surface)
    return canonicalName !== undefined && surface.valueFlags.includes(canonicalName)
  })
}

/** The resolved subcommand word, or undefined at the root. */
export const subcommandName = (args: ReadonlyArray<string>): string | undefined => {
  for (let index = 0; index < args.length; index++) {
    const token = args[index]
    if (token === "--") return undefined
    const name = flagNameOf(token)
    if (token === name && takesValueInAnySurface(name)) {
      const next = args[index + 1]
      if (next === "--") return undefined
      if (
        next !== undefined &&
        !(next.startsWith("-") && declaredInAnySurface(flagNameOf(next)))
      ) {
        index++
        continue
      }
    }
    if (!token.startsWith("-")) return token
  }
  return undefined
}

interface ScannedFlag {
  readonly token: string
  readonly name: string
  readonly canonicalName: string | undefined
  readonly hasValue: boolean
  readonly takesValue: boolean
}

interface ArgvNormalization {
  readonly flagIndex: number
  readonly valueIndex: number
  readonly token: string
}

interface ScannedArgv {
  readonly flags: ReadonlyArray<ScannedFlag>
  readonly normalizations: ReadonlyArray<ArgvNormalization>
}

const scanArgv = (
  args: ReadonlyArray<string>,
  commandSurface: FlagSurface | undefined
): ScannedArgv => {
  const flags: Array<ScannedFlag> = []
  const normalizations: Array<ArgvNormalization> = []

  for (let index = 0; index < args.length; index++) {
    const token = args[index]
    if (token === "--") break
    if (!token.startsWith("-")) continue

    const name = flagNameOf(token)
    const canonicalName = declaredFlagName(name, commandSurface)
    let hasValue = token.includes("=")
    const takesValue =
      canonicalName !== undefined &&
      (commandSurface?.valueFlags.includes(canonicalName) === true ||
        GLOBAL_SURFACE.valueFlags.includes(canonicalName))

    if (!hasValue && takesValue) {
      const next = args[index + 1]
      const nextIsRecognizedFlag =
        next !== undefined &&
        next.startsWith("-") &&
        declaredFlagName(flagNameOf(next), commandSurface) !== undefined
      // A legitimate value may begin with `-`; only a recognized flag proves it is missing.
      if (next !== undefined && next !== "--" && !nextIsRecognizedFlag) {
        hasValue = true
        if (next.startsWith("-")) {
          // Effect 4's lexer treats any `-`-leading token as an option, so a legitimate
          // dash-leading value only survives in the inline form.
          normalizations.push({
            flagIndex: index,
            valueIndex: index + 1,
            token: `${token}=${next}`
          })
        }
        index++
      }
    }

    flags.push({ token, name, canonicalName, hasValue, takesValue })
  }

  return { flags, normalizations }
}

const normalizeArgv = (
  args: ReadonlyArray<string>,
  normalizations: ReadonlyArray<ArgvNormalization>
): ReadonlyArray<string> => {
  if (normalizations.length === 0) return args

  const normalized: Array<string> = []
  let normalizationIndex = 0
  for (let index = 0; index < args.length; index++) {
    const normalization = normalizations[normalizationIndex]
    if (normalization !== undefined && normalization.flagIndex === index) {
      normalized.push(normalization.token)
      index = normalization.valueIndex
      normalizationIndex++
      continue
    }
    normalized.push(args[index])
  }
  return normalized
}

const reject = (message: string): ArgvOutcome => ({
  kind: "reject",
  message,
  exitCode: 2
})

const modelCatalogHint = (tool: Tool): string => {
  const catalog = modelCatalog(tool)
  const list = catalog.models
    .map((model) => `  ${model.id}${model.note !== undefined ? `  — ${model.note}` : ""}`)
    .join("\n")
  return `Available ${tool} models (kit-verified ${catalog.verified} — SoT/models.json):\n${list}`
}

const missingModifierValue = (flag: string): string | undefined => {
  switch (flag) {
    case "--claude-model":
    case "--codex-model": {
      const tool: Tool = flag === "--claude-model" ? "claude" : "codex"
      return `${modelCatalogHint(tool)}\n${flag} requires a value: ${flag}=<model>`
    }
    case "--claude-effort":
    case "--codex-effort": {
      const tool: Tool = flag === "--claude-effort" ? "claude" : "codex"
      return `${effortCatalog(tool)}\n${flag} requires a value: ${effortFlagGrammar(tool)}`
    }
    case "--claude-advisor":
      return `${advisorCatalog()}\n${flag} requires a value: ${advisorFlagGrammar()}`
    case "--claude-compact-window":
      return `${flag} requires a value: ${flag}=<tokens> (e.g. 680k)`
    case "--claude-plugin":
      return `${flag} requires a value: ${flag}=<${KNOWN_CLAUDE_OPTIN_PLUGINS.join("|")}>`
    default:
      return undefined
  }
}

/** Validate the argument list, then hand back the arguments Effect 4 should parse. */
export const prepareArgv = (args: ReadonlyArray<string>): ArgvOutcome => {
  const subcommand = subcommandName(args)
  const commandSurface = subcommand === undefined ? undefined : COMMAND_SURFACES.get(subcommand)
  const { flags, normalizations } = scanArgv(args, commandSurface)
  const unknownCommandWouldMisdiagnoseFlag =
    subcommand !== undefined &&
    commandSurface === undefined &&
    flags.some((flag) => flag.canonicalName === undefined)
  if (unknownCommandWouldMisdiagnoseFlag) {
    return reject(`unknown command '${subcommand}'`)
  }

  if (subcommand === "sync") {
    for (const flag of flags) {
      const hint = LEGACY_HINTS[flag.name]
      if (hint !== undefined) return reject(hint)
    }
  }

  // Effect 4 expands clustered shorts, but the kit declares no clusterable alias
  // pair, so refusing a cluster as one unknown flag is the conservative direction.
  for (const flag of flags) {
    if (flag.canonicalName !== undefined) continue
    const scope = subcommand === undefined ? "" : ` for '${subcommand}'`
    return reject(`unknown flag ${flag.token}${scope}`)
  }

  for (const flag of flags) {
    if (!flag.token.includes("=") || flag.takesValue) continue
    // These booleans are presence-based; Effect 4 would otherwise let
    // `--dry-run=false` read as a dry run while performing a real mutating sync.
    return reject(`flag ${flag.name} does not take a value`)
  }

  const seen = new Set<string>()
  for (const flag of flags) {
    const name = flag.canonicalName
    if (name === undefined) continue
    const duplicateAllowed =
      commandSurface?.repeatableFlags.includes(name) === true ||
      GLOBAL_SURFACE.repeatableFlags.includes(name) ||
      GLOBAL_SURFACE.actionFlags.has(name)
    if (!duplicateAllowed && seen.has(name)) {
      return reject(`flag ${name} was given more than once`)
    }
    seen.add(name)
  }

  if (subcommand === "sync") {
    for (const flag of flags) {
      if (flag.hasValue) continue
      const message = missingModifierValue(flag.name)
      if (message !== undefined) return reject(message)
    }
  }

  return { kind: "accept", args: normalizeArgv(args, normalizations) }
}
