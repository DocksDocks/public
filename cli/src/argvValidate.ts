/**
 * Per-command validation for the Effect CLI layer: legacy-flag hints,
 * unknown-command/flag detection, boolean-value and duplicate rejection, and
 * the sync modifiers' missing-value diagnostics. Operates on scanned flags so
 * the grammar machinery stays in argvSurface.ts.
 */

import { KNOWN_CLAUDE_OPTIN_PLUGINS } from "./engine-native/parseModifiers";
import { modelCatalog } from "./engine-native/models";
import { advisorCatalog, advisorFlagGrammar, effortCatalog, effortFlagGrammar } from "./efforts";
import type { Tool } from "./manifests";
import type { ArgvSurfaces, FlagSurface, ScannedFlag } from "./argvSurface";

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
  "--agents": "--agents was renamed: pass the target as a word, e.g. 'sync agents'",
};

const modelCatalogHint = (tool: Tool): string => {
  const catalog = modelCatalog(tool);
  const list = catalog.models
    .map((model) => `  ${model.id}${model.note !== undefined ? `  — ${model.note}` : ""}`)
    .join("\n");
  return `Available ${tool} models (kit-verified ${catalog.verified} — SoT/models.json):\n${list}`;
};

const missingModifierValue = (flag: string): string | undefined => {
  switch (flag) {
    case "--claude-model":
    case "--codex-model": {
      const tool: Tool = flag === "--claude-model" ? "claude" : "codex";
      return `${modelCatalogHint(tool)}\n${flag} requires a value: ${flag}=<model>`;
    }
    case "--claude-effort":
    case "--codex-effort": {
      const tool: Tool = flag === "--claude-effort" ? "claude" : "codex";
      return `${effortCatalog(tool)}\n${flag} requires a value: ${effortFlagGrammar(tool)}`;
    }
    case "--claude-advisor":
      return `${advisorCatalog()}\n${flag} requires a value: ${advisorFlagGrammar()}`;
    case "--claude-compact-window":
      return `${flag} requires a value: ${flag}=<tokens> (e.g. 680k)`;
    case "--claude-plugin":
      return `${flag} requires a value: ${flag}=<${KNOWN_CLAUDE_OPTIN_PLUGINS.join("|")}>`;
    default:
      return undefined;
  }
};

/**
 * Run the validation checks in diagnostic order. Returns the reject message
 * for the first failure, or undefined when the scanned flags are valid.
 */
export const validateScannedArgv = (
  subcommand: string | undefined,
  commandSurface: FlagSurface | undefined,
  surfaces: ArgvSurfaces,
  flags: ReadonlyArray<ScannedFlag>,
): string | undefined => {
  const unknownCommandWouldMisdiagnoseFlag =
    subcommand !== undefined &&
    commandSurface === undefined &&
    flags.some((flag) => flag.canonicalName === undefined);
  if (unknownCommandWouldMisdiagnoseFlag) {
    return `unknown command '${subcommand}'`;
  }

  if (subcommand === "sync") {
    for (const flag of flags) {
      const hint = LEGACY_HINTS[flag.name];
      if (hint !== undefined) return hint;
    }
  }

  // Effect 4 expands clustered shorts, but the kit declares no clusterable alias
  // pair, so refusing a cluster as one unknown flag is the conservative direction.
  for (const flag of flags) {
    if (flag.canonicalName !== undefined) continue;
    const scope = subcommand === undefined ? "" : ` for '${subcommand}'`;
    return `unknown flag ${flag.token}${scope}`;
  }

  for (const flag of flags) {
    if (!flag.token.includes("=") || flag.takesValue) continue;
    // These booleans are presence-based; Effect 4 would otherwise let
    // `--dry-run=false` read as a dry run while performing a real mutating sync.
    return `flag ${flag.name} does not take a value`;
  }

  const seen = new Set<string>();
  for (const flag of flags) {
    const name = flag.canonicalName;
    if (name === undefined) continue;
    const duplicateAllowed =
      commandSurface?.repeatableFlags.includes(name) === true ||
      surfaces.globalSurface.repeatableFlags.includes(name) ||
      surfaces.globalSurface.actionFlags.has(name);
    if (!duplicateAllowed && seen.has(name)) {
      return `flag ${name} was given more than once`;
    }
    seen.add(name);
  }

  if (subcommand === "sync") {
    for (const flag of flags) {
      if (flag.hasValue) continue;
      const message = missingModifierValue(flag.name);
      if (message !== undefined) return message;
    }
  }

  return undefined;
};
