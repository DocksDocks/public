import { Argument, Command, Flag, Prompt } from "effect/unstable/cli"
import { Console, Effect, Option } from "effect"
import { chmodSync, mkdirSync, writeFileSync } from "node:fs"
import { bail } from "../engine"
import { capture, p, spawnHost, which } from "../engine-native/exec"
import {
  DEFAULT_OMP_SESSION_MODEL,
  engineHome,
  readOmpSessionModel,
  writeOmpSessionModel,
  type OmpSessionModel
} from "../engine-native/harnesses"
import {
  advisorLevelFor,
  advisorRecommendation,
  buildOmpArgs,
  ladderCeiling,
  overlayFileName,
  planEffortChoice,
  parseFreeModels,
  renderFreeOverlay,
  type CatalogModel
} from "../engine-native/ompOverlay"

const model = Flag.String("model").pipe(
  Flag.withDescription("Free model selector to use and remember for omp sessions"),
  Flag.optional
)
const pick = Flag.Boolean("pick").pipe(
  Flag.withDescription("Choose the free model interactively"),
  Flag.withDefault(false)
)
const args: Argument.Argument<ReadonlyArray<string>> = Argument.String("args").pipe(
  Argument.withDescription("Arguments forwarded verbatim to omp"),
  Argument.variadic()
)

export type FreeSelectorResolution =
  | { readonly ok: true; readonly model: CatalogModel }
  | { readonly ok: false; readonly message: string }

// Pure selector matching so the picker rule stays testable without spawning omp.
// An exact selector always wins; otherwise one case-insensitive substring hit
// across the free selectors resolves, because a longer exact selector is easy
// to mistype and the catalog is small enough to disambiguate safely.
export function resolveFreeSelector(
  input: string,
  free: ReadonlyArray<CatalogModel>
): FreeSelectorResolution {
  const trimmed = input.trim()
  if (trimmed === "") {
    return { ok: false, message: "Model selector must not be empty or blank" }
  }
  const exact = free.find((candidate) => candidate.selector === trimmed)
  if (exact !== undefined) return { ok: true, model: exact }
  const lowered = trimmed.toLowerCase()
  const matches = free.filter((candidate) => candidate.selector.toLowerCase().includes(lowered))
  const list = free.map((candidate) => candidate.selector).join(", ")
  if (matches.length === 0) {
    return {
      ok: false,
      message: `Model '${trimmed}' is not in the free catalog. Free models: ${list}`
    }
  }
  const only = matches[0]
  if (matches.length === 1 && only !== undefined) return { ok: true, model: only }
  return {
    ok: false,
    message: `Model '${trimmed}' is ambiguous; matches: ${matches.map((candidate) => candidate.selector).join(", ")}. Pass the exact selector.`
  }
}

const loadFreeCatalog = (omp: string): Effect.Effect<ReadonlyArray<CatalogModel>> =>
  Effect.gen(function* () {
    const raw = yield* Effect.promise(() => capture(omp, ["models", "--json"]))
    if (raw === "") {
      return yield* bail(
        "'omp models --json' returned no output; verify omp runs on this host, then retry"
      )
    }
    let parsed: unknown
    try {
      parsed = JSON.parse(raw) as unknown
    } catch {
      return yield* bail(
        "'omp models --json' returned output that is not JSON; verify the omp version, then retry"
      )
    }
    const free = parseFreeModels(parsed)
    if (free.length === 0) {
      return yield* bail("'omp models --json' listed no free models; verify the omp login, then retry")
    }
    return free
  })

/**
 * Ask for the thinking levels of one model. Every choice comes from that
 * model own ladder, because omp rejects a `:level` suffix the model does not
 * publish. A model with no ladder and a model with one level are settled
 * without a question.
 */
const pickLevels = (model: CatalogModel) =>
  Effect.gen(function* () {
    const plan = planEffortChoice(model.thinking)
    if (plan.kind === "none") {
      yield* Console.error(`${model.name} publishes no thinking levels; the model default applies`)
      return { thinking: undefined, advisorThinking: undefined }
    }
    if (plan.kind === "fixed") {
      yield* Console.error(`${model.name} publishes one thinking level: ${plan.level}`)
      return { thinking: plan.level, advisorThinking: plan.level }
    }
    const uniform = yield* Prompt.Select({
      message: "Use the same thinking level for every role?",
      choices: [
        { title: "Yes", value: true, description: `every role runs at ${plan.highest}, the highest this model offers` },
        { title: "No", value: false, description: "set the advisor apart from the other roles" }
      ]
    })
    if (uniform) return { thinking: plan.highest, advisorThinking: plan.highest }
    const ladderChoices = plan.levels.map((level) => ({
      title: level,
      value: level,
      description:
        level === plan.highest ? "highest this model offers" : level === plan.levels[0] ? "lowest this model offers" : ""
    }))
    const thinking = yield* Prompt.Select({
      message: "Thinking level for all roles except the advisor",
      choices: ladderChoices
    })
    const suggested = advisorRecommendation(plan.levels, thinking)
    // The list leads with the suggestion, because Prompt.Select always starts
    // on the first entry and offers no initial index. The full ladder follows
    // in ladder order, so a different level stays one keypress away. A
    // suggestion equal to the main level would only duplicate a row.
    const advisorChoices =
      suggested === undefined || suggested === thinking
        ? ladderChoices
        : [
            {
              title: suggested,
              value: suggested,
              description: `recommended, two levels below ${thinking}`
            },
            ...ladderChoices
          ]
    const advisorThinking = yield* Prompt.Select({
      message: "Thinking level for the advisor role",
      choices: advisorChoices
    })
    return { thinking, advisorThinking }
  })

export const ompCommand = Command.make("omp", { model, pick, args }, (config) =>
  Effect.gen(function* () {
    if (Option.isSome(config.model) && config.pick) {
      return yield* bail("Pass either --model <selector> or --pick, not both")
    }

    const omp = yield* Effect.sync(() => which("omp"))
    if (omp === "") {
      return yield* bail("omp not found on PATH; install omp, then retry", 1)
    }

    const home = engineHome(process.env)
    if (Option.isSome(config.model)) {
      const free = yield* loadFreeCatalog(omp)
      const resolved = resolveFreeSelector(config.model.value, free)
      if (!resolved.ok) return yield* bail(resolved.message)
      // Compute both levels once from the catalog row so a plain launch
      // never needs the catalog again.
      const thinking = ladderCeiling(resolved.model.thinking)
      const advisorThinking = advisorLevelFor(resolved.model.thinking)
      yield* Effect.sync(() =>
        writeOmpSessionModel(home, { selector: resolved.model.selector, thinking, advisorThinking })
      )
    }

    if (config.pick) {
      // Check the terminal before the catalog spawn, so a non-interactive run
      // fails with the actionable message instead of an omp subprocess first.
      if (!process.stdin.isTTY || !process.stdout.isTTY) {
        return yield* bail("Picking needs a terminal; pass --model <selector> instead")
      }
      const free = yield* loadFreeCatalog(omp)
      const chosen = yield* Prompt.Select({
        message: "Choose the free model for this omp session",
        choices: free.map((candidate) => {
          const ceiling = ladderCeiling(candidate.thinking)
          return {
            title: `${candidate.name} — ${candidate.selector}`,
            value: candidate.selector,
            description:
              ceiling === undefined
                ? `model default thinking; ${candidate.contextWindow} context`
                : `thinking to ${ceiling}; ${candidate.contextWindow} context`
          }
        })
      })
      const match = free.find((candidate) => candidate.selector === chosen)
      if (match === undefined) return yield* bail(`Model '${chosen}' is not in the free catalog`)
      const chosenLevels = yield* pickLevels(match)
      yield* Effect.sync(() =>
        writeOmpSessionModel(home, {
          selector: match.selector,
          thinking: chosenLevels.thinking,
          advisorThinking: chosenLevels.advisorThinking
        })
      )
    }

    const session: OmpSessionModel = (yield* Effect.sync(() => readOmpSessionModel(home))) ??
      DEFAULT_OMP_SESSION_MODEL

    // A stable cache path, not a temp file deleted at exit, because omp may
    // re-read the overlay during a live session. The name carries the model,
    // so a second launcher on another model cannot rewrite the file a running
    // session still reads.
    const directory = p(home, ".cache", "docks-kit")
    const overlayPath = p(directory, overlayFileName(session.selector))
    yield* Effect.sync(() => {
      // `mode` applies only when mkdir creates the path, so an existing
      // permissive cache directory keeps its mode until the chmod below.
      mkdirSync(directory, { recursive: true, mode: 0o700 })
      chmodSync(directory, 0o700)
      writeFileSync(overlayPath, renderFreeOverlay(session), { mode: 0o600 })
      chmodSync(overlayPath, 0o600)
    })

    // A level-free model states the model default so the line never shows
    // an undefined level. The advisor appears only when it differs, because
    // a uniform session has nothing extra to report.
    const level = typeof session.thinking === "string" && session.thinking.trim() !== "" ? session.thinking : undefined
    const advisor =
      typeof session.advisorThinking === "string" && session.advisorThinking.trim() !== ""
        ? session.advisorThinking
        : undefined
    const levelText = level === undefined ? "the model default thinking level" : `${level} thinking`
    const advisorText = advisor !== undefined && advisor !== level ? `, advisor at ${advisor}` : ""
    yield* Console.error(
      `Starting omp with ${session.selector} at ${levelText}${advisorText} (session only; deployed config unchanged)`
    )

    const child = yield* Effect.sync(() =>
      spawnHost("omp", buildOmpArgs(overlayPath, config.args), { stdio: "inherit" })
    )
    if (child.error !== undefined) {
      return yield* bail(
        `Failed to start omp: ${child.error instanceof Error ? child.error.message : String(child.error)}`
      )
    }
    // A signalled child reports a null status, which must not look successful.
    yield* Effect.sync(() => process.exit(child.status ?? 1))
  })
).pipe(
  Command.withDescription(
    "Start omp with every model role overridden to the remembered free model for this run only (no deployed configuration is changed; --model or --pick remembers a new free default)."
  )
)
