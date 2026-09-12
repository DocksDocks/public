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
  buildOmpArgs,
  ladderCeiling,
  overlayFileName,
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
      const thinking = ladderCeiling(match.thinking)
      const advisorThinking = advisorLevelFor(match.thinking)
      yield* Effect.sync(() => writeOmpSessionModel(home, { selector: match.selector, thinking, advisorThinking }))
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
    // an undefined level.
    const hasLevel = typeof session.thinking === "string" && session.thinking.trim() !== ""
    yield* Console.error(
      hasLevel
        ? `Starting omp with ${session.selector} at ${session.thinking} thinking (session only; deployed config unchanged)`
        : `Starting omp with ${session.selector} at the model default thinking level (session only; deployed config unchanged)`
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
