import { Argument, Command, Flag } from "effect/unstable/cli";
import { Console, Effect, Option } from "effect";
import { bail } from "../engine";
import { engineHome, LEGACY_SELECTION, readHarnessSelection } from "../engine-native/harnesses";
import { defaultLiveInputs, resolveCatalog } from "../engine-native/liveModels";
import type { CatalogTool, ResolvedCatalog } from "../engine-native/sharedTypes";

const tool = Argument.String("tool").pipe(
  Argument.withDescription("claude | codex | omp (omit for enabled harnesses)"),
  Argument.optional,
);
const json = Flag.Boolean("json").pipe(
  Flag.withDescription("Machine-readable output"),
  Flag.withDefault(false),
);
const refresh = Flag.Boolean("refresh").pipe(
  Flag.withDescription("Bypass the kit cache (~/.docks-kit/kit.db) and fetch live lists again"),
  Flag.withDefault(false),
);

function isCatalogTool(value: string): value is CatalogTool {
  return value === "claude" || value === "codex" || value === "omp";
}

const renderTool = (t: CatalogTool, catalog: ResolvedCatalog) =>
  Effect.gen(function* () {
    yield* Console.log(
      catalog.source === "curated"
        ? `${t} models (kit-verified ${catalog.verified}):`
        : `${t} models (live — ${catalog.source}, fetched ${catalog.fetchedAt ?? "?"}):`,
    );
    if (catalog.fallbackReason !== undefined) {
      yield* Console.log(`  (live list unavailable: ${catalog.fallbackReason})`);
    }
    for (const m of catalog.models) {
      yield* Console.log(`  ${m.id.padEnd(28)} ${m.kind.padEnd(6)} ${m.note ?? ""}`);
    }
    if (t === "claude") {
      yield* Console.log(
        "  (full claude-* model IDs outside the catalog are accepted with a warning)",
      );
    } else if (t === "codex") {
      yield* Console.log("  (well-formed IDs outside the catalog are accepted with a warning)");
    }
    yield* Console.log("");
  });

export const modelsCommand = Command.make("models", { tool, json, refresh }, (config) =>
  Effect.gen(function* () {
    const requested = Option.getOrUndefined(config.tool);
    if (requested !== undefined && !isCatalogTool(requested)) {
      return yield* bail(`Unknown tool '${requested}' (valid: claude, codex, omp)`);
    }
    const home = engineHome(process.env);
    const tools: ReadonlyArray<CatalogTool> =
      requested !== undefined
        ? [requested]
        : (readHarnessSelection(home) ?? LEGACY_SELECTION).filter(isCatalogTool);
    const inputs = defaultLiveInputs(home, config.refresh);
    const out: Partial<Record<CatalogTool, ResolvedCatalog>> = {};
    for (const t of tools) {
      const catalog = yield* Effect.promise(() => resolveCatalog(t, inputs));
      if (config.json) {
        out[t] = catalog;
      } else {
        yield* renderTool(t, catalog);
      }
    }
    if (config.json) yield* Console.log(JSON.stringify(out, null, 2));
  }),
).pipe(
  Command.withDescription(
    "List models per enabled harness: live from each harness's login or cache, with SoT/models.json aliases and notes as overlay and offline fallback.",
  ),
);
