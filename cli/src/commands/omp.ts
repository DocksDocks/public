import { Argument, Command, Flag, Prompt } from "effect/unstable/cli";
import { Console, Effect, Option } from "effect";
import { chmodSync, mkdirSync, writeFileSync } from "node:fs";
import { bail } from "../engine";
import { capture, p, spawnHost, which } from "../engine-native/exec";
import { kitCacheDir } from "../engine-native/scratch";
import {
  DEFAULT_OMP_SESSION_MODEL,
  engineHome,
  readOmpSessionModel,
  writeOmpSessionModel,
  type OmpSessionModel,
} from "../engine-native/harnesses";
import {
  advisorLevelFor,
  advisorRecommendation,
  buildOmpArgs,
  ladderCeiling,
  overlayFileName,
  planEffortChoice,
  parseFreeModels,
  renderFreeOverlay,
  type CatalogModel,
} from "../engine-native/ompOverlay";
import { FAST_ON_TIER, toggleDeployedOpenAiFast } from "../engine-native/ompFastMode";
import { ompPaths } from "../engine-native/ompPaths";

const model = Flag.String("model").pipe(
  Flag.withDescription("Free model selector to use and remember for omp sessions"),
  Flag.optional,
);
const pick = Flag.Boolean("pick").pipe(
  Flag.withDescription("Choose the free model interactively"),
  Flag.withDefault(false),
);
const fast = Flag.Boolean("fast").pipe(
  Flag.withDescription(
    "Toggle fast mode (tier.openai priority/none) for OpenAI and Codex models in the deployed omp config, then exit",
  ),
  Flag.withDefault(false),
);
const args: Argument.Argument<ReadonlyArray<string>> = Argument.String("args").pipe(
  Argument.withDescription("Arguments forwarded verbatim to omp"),
  Argument.variadic(),
);

export type FreeSelectorResolution =
  | { readonly ok: true; readonly model: CatalogModel }
  | { readonly ok: false; readonly message: string };

// Pure selector matching so the picker rule stays testable without spawning omp.
// An exact selector always wins; otherwise one case-insensitive substring hit
// across the free selectors resolves, because a longer exact selector is easy
// to mistype and the catalog is small enough to disambiguate safely.
export function resolveFreeSelector(
  input: string,
  free: ReadonlyArray<CatalogModel>,
): FreeSelectorResolution {
  const trimmed = input.trim();
  if (trimmed === "") {
    return { ok: false, message: "Model selector must not be empty or blank" };
  }
  const exact = free.find((candidate) => candidate.selector === trimmed);
  if (exact !== undefined) return { ok: true, model: exact };
  const lowered = trimmed.toLowerCase();
  const matches = free.filter((candidate) => candidate.selector.toLowerCase().includes(lowered));
  const list = free.map((candidate) => candidate.selector).join(", ");
  if (matches.length === 0) {
    return {
      ok: false,
      message: `Model '${trimmed}' is not in the free catalog. Free models: ${list}`,
    };
  }
  const only = matches[0];
  if (matches.length === 1 && only !== undefined) return { ok: true, model: only };
  return {
    ok: false,
    message: `Model '${trimmed}' is ambiguous; matches: ${matches.map((candidate) => candidate.selector).join(", ")}. Pass the exact selector.`,
  };
}

/**
 * The omp profile that the forwarded arguments select. omp reads
 * `--profile <name>` or `--profile=<name>` before a `--`, the last one wins,
 * and it rejects a missing or empty name. The catalog check must query the
 * profile the session runs, so it reads the arguments the same way.
 */
export type ForwardedProfile =
  | { readonly ok: true; readonly profile: string | undefined }
  | { readonly ok: false; readonly message: string };

export function forwardedProfile(forwarded: ReadonlyArray<string>): ForwardedProfile {
  let profile: string | undefined;
  for (let index = 0; index < forwarded.length; index++) {
    const arg = forwarded[index]!;
    if (arg === "--") break;
    let value: string | undefined;
    if (arg === "--profile") {
      value = forwarded[index + 1];
      if (value === undefined || value.startsWith("-")) value = "";
      else index++;
    } else if (arg.startsWith("--profile=")) {
      value = arg.slice("--profile=".length);
    } else {
      continue;
    }
    if (value === "") return { ok: false, message: "--profile requires a profile name" };
    profile = value;
  }
  return { ok: true, profile };
}

const loadFreeCatalog = (
  omp: string,
  profile: string | undefined,
): Effect.Effect<ReadonlyArray<CatalogModel>> =>
  Effect.gen(function* () {
    // omp takes --profile only before its subcommand.
    const catalogArgs = [
      ...(profile === undefined ? [] : ["--profile", profile]),
      "models",
      "--json",
    ];
    const command = `omp ${catalogArgs.join(" ")}`;
    const raw = yield* Effect.promise(() => capture(omp, catalogArgs));
    if (raw === "") {
      return yield* bail(
        `'${command}' returned no output; verify omp runs on this host, then retry`,
      );
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw) as unknown;
    } catch {
      return yield* bail(
        `'${command}' returned output that is not JSON; verify the omp version, then retry`,
      );
    }
    const free = parseFreeModels(parsed);
    if (free.length === 0) {
      return yield* bail(`'${command}' listed no free models; verify the omp login, then retry`);
    }
    return free;
  });

/**
 * Ask for the thinking levels of one model. Every choice comes from that
 * model own ladder, because omp rejects a `:level` suffix the model does not
 * publish. A model with no ladder and a model with one level are settled
 * without a question.
 */
const pickLevels = (catalogModel: CatalogModel) =>
  Effect.gen(function* () {
    const plan = planEffortChoice(catalogModel.thinking);
    if (plan.kind === "none") {
      yield* Console.error(
        `${catalogModel.name} publishes no thinking levels; the model default applies`,
      );
      return { thinking: undefined, advisorThinking: undefined };
    }
    if (plan.kind === "fixed") {
      yield* Console.error(`${catalogModel.name} publishes one thinking level: ${plan.level}`);
      return { thinking: plan.level, advisorThinking: plan.level };
    }
    const uniform = yield* Prompt.Select({
      message: "Use the same thinking level for every role?",
      choices: [
        {
          title: "Yes",
          value: true,
          description: `every role runs at ${plan.highest}, the highest this model offers`,
        },
        { title: "No", value: false, description: "set the advisor apart from the other roles" },
      ],
    });
    if (uniform) return { thinking: plan.highest, advisorThinking: plan.highest };
    const ladderChoices = plan.levels.map((level) => ({
      title: level,
      value: level,
      description:
        level === plan.highest
          ? "highest this model offers"
          : level === plan.levels[0]
            ? "lowest this model offers"
            : "",
    }));
    const thinking = yield* Prompt.Select({
      message: "Thinking level for all roles except the advisor",
      choices: ladderChoices,
    });
    const suggested = advisorRecommendation(plan.levels, thinking);
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
              description: `recommended, two levels below ${thinking}`,
            },
            ...ladderChoices,
          ];
    const advisorThinking = yield* Prompt.Select({
      message: "Thinking level for the advisor role",
      choices: advisorChoices,
    });
    return { thinking, advisorThinking };
  });

export const ompCommand = Command.make("omp", { model, pick, fast, args }, (config) =>
  Effect.gen(function* () {
    if (Option.isSome(config.model) && config.pick) {
      return yield* bail("Pass either --model <selector> or --pick, not both");
    }

    if (config.fast) {
      if (Option.isSome(config.model) || config.pick || config.args.length > 0) {
        return yield* bail("--fast toggles fast mode and exits; pass it alone");
      }
      const configPath = p(
        ompPaths({ home: engineHome(process.env), env: process.env, platform: process.platform })
          .agentDir,
        "config.yml",
      );
      const toggle = yield* Effect.try({
        try: () => toggleDeployedOpenAiFast(configPath),
        catch: (error) => (error instanceof Error ? error.message : String(error)),
      }).pipe(Effect.catch((message) => bail(message)));
      const state = toggle.next === FAST_ON_TIER ? "ON" : "OFF";
      yield* Console.log(
        `omp fast mode ${state} for OpenAI/Codex models: tier.openai ${toggle.previous} -> ${toggle.next} in ${configPath}`,
      );
      yield* Console.log(
        "New omp sessions use it; in a running session, use /fast on|off or restart omp.",
      );
      return;
    }

    const omp = yield* Effect.sync(() => which("omp"));
    if (omp === "") {
      return yield* bail("omp not found on PATH; install omp, then retry", 1);
    }

    const home = engineHome(process.env);
    // Check the terminal before the catalog spawn, so a non-interactive run
    // fails with the actionable message instead of an omp subprocess first.
    if (config.pick && (!process.stdin.isTTY || !process.stdout.isTTY)) {
      return yield* bail("Picking needs a terminal; pass --model <selector> instead");
    }
    // Every launch reads the live catalog once, because a remembered or
    // default model can be renamed, repriced, or lose its provider login.
    // omp then silently starts a paid default model instead. The catalog
    // comes from the profile that the forwarded arguments select.
    const profile = forwardedProfile(config.args);
    if (!profile.ok) return yield* bail(profile.message);
    const free = yield* loadFreeCatalog(omp, profile.profile);
    // The value the launcher writes is the value it runs, so a concurrent
    // launcher or a failed read of kit.db cannot change this session.
    let chosen: OmpSessionModel | undefined;
    if (Option.isSome(config.model)) {
      const resolved = resolveFreeSelector(config.model.value, free);
      if (!resolved.ok) return yield* bail(resolved.message);
      chosen = {
        selector: resolved.model.selector,
        thinking: ladderCeiling(resolved.model.thinking),
        advisorThinking: advisorLevelFor(resolved.model.thinking),
      };
    }

    if (config.pick) {
      const pickedSelector = yield* Prompt.Select({
        message: "Choose the free model for this omp session",
        choices: free.map((candidate) => {
          const ceiling = ladderCeiling(candidate.thinking);
          return {
            title: `${candidate.name} — ${candidate.selector}`,
            value: candidate.selector,
            description:
              ceiling === undefined
                ? `model default thinking; ${candidate.contextWindow} context`
                : `thinking to ${ceiling}; ${candidate.contextWindow} context`,
          };
        }),
      });
      const match = free.find((candidate) => candidate.selector === pickedSelector);
      if (match === undefined) {
        return yield* bail(`Model '${pickedSelector}' is not in the free catalog`);
      }
      const chosenLevels = yield* pickLevels(match);
      chosen = {
        selector: match.selector,
        thinking: chosenLevels.thinking,
        advisorThinking: chosenLevels.advisorThinking,
      };
    }

    if (chosen !== undefined) {
      const remembered = chosen;
      yield* Effect.sync(() => writeOmpSessionModel(home, remembered));
    }

    const session: OmpSessionModel =
      chosen ?? (yield* Effect.sync(() => readOmpSessionModel(home))) ?? DEFAULT_OMP_SESSION_MODEL;
    if (!free.some((candidate) => candidate.selector === session.selector)) {
      return yield* bail(
        `free model '${session.selector}' is not available in the omp catalog (renamed, repriced, or provider not logged in); log in to its provider or choose another with --model or --pick`,
      );
    }

    // A stable cache path, not a temp file deleted at exit, because omp may
    // re-read the overlay during a live session. The name carries a digest of
    // the rendered overlay, so a second launcher on another model or level
    // cannot rewrite the file a running session still reads.
    const directory = kitCacheDir(home);
    const overlayPath = p(directory, overlayFileName(session));
    yield* Effect.sync(() => {
      // `mode` applies only when mkdir creates the path, so an existing
      // permissive cache directory keeps its mode until the chmod below.
      mkdirSync(directory, { recursive: true, mode: 0o700 });
      chmodSync(directory, 0o700);
      writeFileSync(overlayPath, renderFreeOverlay(session), { mode: 0o600 });
      chmodSync(overlayPath, 0o600);
    });

    // A level-free model states the model default so the line never shows
    // an undefined level. The advisor appears only when it differs, because
    // a uniform session has nothing extra to report.
    const level =
      typeof session.thinking === "string" && session.thinking.trim() !== ""
        ? session.thinking
        : undefined;
    const advisor =
      typeof session.advisorThinking === "string" && session.advisorThinking.trim() !== ""
        ? session.advisorThinking
        : undefined;
    const levelText =
      level === undefined ? "the model default thinking level" : `${level} thinking`;
    const advisorText = advisor !== undefined && advisor !== level ? `, advisor at ${advisor}` : "";
    yield* Console.error(
      `Starting omp with ${session.selector} at ${levelText}${advisorText} (session only; deployed config unchanged)`,
    );

    const child = yield* Effect.sync(() =>
      spawnHost("omp", buildOmpArgs(overlayPath, config.args), { stdio: "inherit" }),
    );
    if (child.error !== undefined) {
      return yield* bail(
        `Failed to start omp: ${child.error instanceof Error ? child.error.message : String(child.error)}`,
      );
    }
    // A signalled child reports a null status, which must not look successful.
    yield* Effect.sync(() => process.exit(child.status ?? 1));
  }),
).pipe(
  Command.withDescription(
    "Start omp with every chat-model role set to the remembered free model for this run only. The web-search role keeps the deployed provider order, which can include a paid model. No deployed configuration changes; --model or --pick remembers a new free default. Every launch checks the model against the live free catalog. --fast instead toggles OpenAI/Codex fast mode in the deployed omp config and exits.",
  ),
);
