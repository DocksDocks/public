/**
 * EngineNative flag layer: target selection and the argv dispatch loop.
 * Modifier/effort mapping lives in parseModifiers.ts; help text and the
 * early-exit error live in parseHelp.ts (re-exported here so existing
 * `from "./parseArgs"` imports keep working).
 */
import type { Ctx } from "./index";
import { LEGACY_SELECTION, readHarnessSelection, type Harness } from "./harnesses";
import { advisorCatalog, advisorFlagGrammar, effortCatalog, effortFlagGrammar } from "../efforts";
import { printModels } from "./models";
import { curatedCatalog } from "./liveModels";
import { ExitError, printCatalog, printUsage } from "./parseHelp";
import {
  KNOWN_CLAUDE_OPTIN_PLUGINS,
  addClaudePlugin,
  isScalarModifierFlag,
  markModifier,
  parseCompactWindow,
  setModifier,
} from "./parseModifiers";

export { ExitError } from "./parseHelp";
export {
  KNOWN_CLAUDE_OPTIN_PLUGINS,
  parseClaudePlugin,
  parseCompactWindow,
  validateModifierFlags,
} from "./parseModifiers";

type TargetFlag = "syncClaude" | "syncCodex" | "syncAgents" | "syncOmp";

const TARGET_FLAGS = {
  claude: "syncClaude",
  codex: "syncCodex",
  agents: "syncAgents",
  omp: "syncOmp",
} satisfies Record<Harness, TargetFlag>;

/**
 * The rename hint for each retired sync flag. The engine prints it here, and
 * the public CLI layer (`argvValidate.ts`) rejects the same flag with the same
 * text, so the two paths cannot drift.
 */
export const LEGACY_FLAG_HINTS = {
  "--claude": "--claude was renamed: pass the target as a word, e.g. 'sync claude'",
  "--codex": "--codex was renamed: pass the target as a word, e.g. 'sync codex'",
  "--agents": "--agents was renamed: pass the target as a word, e.g. 'sync agents'",
  "--omp": "--omp was renamed: pass the target as a word, e.g. 'sync omp'",
  "--force": "--force was renamed to --reconcile",
  "--remove-plugins":
    "--remove-plugins was renamed to --prune (it also removes marketplaces + kit-managed skills)",
  "--680k": "--680k was renamed to --claude-compact-window=680k",
  "--permissive": "--permissive was renamed to --claude-permissive",
  "--supabase": "--supabase was renamed to --claude-plugin=supabase",
  "--n8n": "--n8n was renamed to --claude-plugin=n8n",
  "--skip-rtk": "--skip-rtk was renamed to --skip-bubblewrap",
} as const satisfies Record<string, string>;

type LegacyFlag = keyof typeof LEGACY_FLAG_HINTS;

/** Own-key check, so a word such as `constructor` never reads an Object prototype member. */
export const isLegacyFlag = (flag: string): flag is LegacyFlag =>
  Object.hasOwn(LEGACY_FLAG_HINTS, flag);

function selectTarget(ctx: Ctx, target: Harness): void {
  ctx[TARGET_FLAGS[target]] = true;
  ctx.targetFilterSet = true;
}

function applySelection(ctx: Ctx, selection: ReadonlyArray<Harness>): void {
  ctx.syncClaude = selection.includes("claude");
  ctx.syncCodex = selection.includes("codex");
  ctx.syncAgents = selection.includes("agents");
  ctx.syncOmp = selection.includes("omp");
}

function applyDefaultSelection(ctx: Ctx): void {
  if (ctx.targetFilterSet) return;

  const storedSelection = readHarnessSelection(ctx.home);
  applySelection(ctx, storedSelection ?? LEGACY_SELECTION);
  if (storedSelection !== undefined || !ctx.interactive) return;

  ctx.services.logger.echo("No harness selection stored; syncing claude, codex, agents");
  ctx.services.logger.echo("Choose harnesses with: docks-kit harnesses");
}

export function parseArgs(ctx: Ctx, args: ReadonlyArray<string>): void {
  const { err } = ctx.services.logger;
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index] ?? "";
    if (isScalarModifierFlag(arg) && args[index + 1] === "") {
      setModifier(ctx, arg, "");
      index += 1;
      continue;
    }
    switch (arg) {
      case "claude":
      case "codex":
      case "agents":
      case "omp":
        selectTarget(ctx, arg);
        continue;
      case "--dry-run":
        ctx.dryRun = true;
        continue;
      case "--skip-bubblewrap":
        ctx.skipBubblewrap = true;
        continue;
      case "--skip-plugin-refresh":
        ctx.skipPluginRefresh = true;
        continue;
      case "--reconcile":
        ctx.reconcile = true;
        continue;
      case "--prune":
        ctx.prune = true;
        continue;
      case "--verbose":
        ctx.verbose = true;
        continue;
      case "--claude-model":
        printModels(ctx, curatedCatalog("claude"));
        err("--claude-model requires a value: --claude-model=<model>");
        throw new ExitError(2);
      case "--codex-model":
        printModels(ctx, curatedCatalog("codex"));
        err("--codex-model requires a value: --codex-model=<model>");
        throw new ExitError(2);
      case "--claude-effort":
        printCatalog(ctx, effortCatalog("claude"));
        err(`--claude-effort requires a value: ${effortFlagGrammar("claude")}`);
        throw new ExitError(2);
      case "--codex-effort":
        printCatalog(ctx, effortCatalog("codex"));
        err(`--codex-effort requires a value: ${effortFlagGrammar("codex")}`);
        throw new ExitError(2);
      case "--claude-advisor":
        printCatalog(ctx, advisorCatalog());
        err(`--claude-advisor requires a value: ${advisorFlagGrammar()}`);
        throw new ExitError(2);
      case "--claude-compact-window":
        err(
          "--claude-compact-window requires a value: --claude-compact-window=<tokens> (e.g. 680k)",
        );
        throw new ExitError(2);
      case "--claude-permissive":
        ctx.claudePermissive = true;
        markModifier(ctx, "--claude-permissive");
        continue;
      case "--claude-plugin":
        err(
          `--claude-plugin requires a value: --claude-plugin=<${KNOWN_CLAUDE_OPTIN_PLUGINS.join("|")}>`,
        );
        throw new ExitError(2);
      case "--claude":
      case "--codex":
      case "--agents":
      case "--omp":
      case "--force":
      case "--remove-plugins":
      case "--680k":
      case "--permissive":
      case "--supabase":
      case "--n8n":
      case "--skip-rtk":
        err(LEGACY_FLAG_HINTS[arg]);
        throw new ExitError(2);
      case "-h":
      case "--help":
        printUsage(ctx, KNOWN_CLAUDE_OPTIN_PLUGINS);
        throw new ExitError(0);
      default:
        break;
    }
    if (arg.startsWith("--claude-model=")) {
      setModifier(ctx, "--claude-model", arg.slice("--claude-model=".length));
    } else if (arg.startsWith("--codex-model=")) {
      setModifier(ctx, "--codex-model", arg.slice("--codex-model=".length));
    } else if (arg.startsWith("--claude-effort=")) {
      setModifier(ctx, "--claude-effort", arg.slice("--claude-effort=".length));
    } else if (arg.startsWith("--codex-effort=")) {
      setModifier(ctx, "--codex-effort", arg.slice("--codex-effort=".length));
    } else if (arg.startsWith("--claude-advisor=")) {
      setModifier(ctx, "--claude-advisor", arg.slice("--claude-advisor=".length));
    } else if (arg.startsWith("--claude-compact-window=")) {
      const parsed = parseCompactWindow(arg.slice("--claude-compact-window=".length));
      if (parsed === undefined) {
        err("--claude-compact-window expects a token count (e.g. 680000 or 680k)");
        throw new ExitError(2);
      }
      ctx.claudeCompactWindow = parsed;
      markModifier(ctx, "--claude-compact-window");
    } else if (arg.startsWith("--claude-plugin=")) {
      addClaudePlugin(ctx, arg.slice("--claude-plugin=".length));
    } else if (arg.startsWith("--claude-permissive=")) {
      err("--claude-permissive does not take a value");
      throw new ExitError(2);
    } else {
      err(`Unknown arg: ${arg}`);
      throw new ExitError(2);
    }
  }

  applyDefaultSelection(ctx);
}
