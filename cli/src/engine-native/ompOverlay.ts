/**
 * Run overlay for `docks-kit omp`. The overlay merges over the deployed omp
 * config for one run only. It sets every chat-model role to the free model
 * and empties the retry chain of each role it sets. The `web` role and its
 * retry chain are not in the overlay, so the deployed web-search provider
 * order applies, and that order can include a paid chat model. Every other
 * key falls through to the deployed config.
 */
import { createHash } from "node:crypto";
import type { OmpSessionModel } from "./harnesses";

export interface CatalogModel {
  readonly selector: string;
  readonly name: string;
  readonly thinking: ReadonlyArray<string>;
  readonly contextWindow: number;
}

/** Thinking levels from lowest to highest effort. */
export const THINKING_LADDER: ReadonlyArray<string> = [
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
];

/**
 * One overlay file per distinct model and level combination, so a second
 * launcher cannot rewrite the file a running session still reads. omp
 * reloads a changed overlay mid-session, so the digest covers the exact
 * rendered overlay: the selector, both levels, and every rendered key. A
 * selector carries a slash and may carry other characters a host rejects in
 * a file name, so unsafe characters in the readable prefix become hyphens.
 */
export function overlayFileName(model: OmpSessionModel): string {
  const safe = model.selector.replace(/[^A-Za-z0-9._-]/g, "-");
  const digest = createHash("sha256").update(renderFreeOverlay(model)).digest("hex").slice(0, 8);
  return `omp-free-${safe}-${digest}.yml`;
}

/**
 * Role keys in the order used by SoT/.omp/config.yml for readable diffs. The
 * SoT does not set `memory` and `judge`, so they come last. An unset role
 * falls back to the omp built-in priority chain, which can name a paid model.
 * The `web` role is left out on purpose, so the deployed web-search provider
 * order applies.
 */
const ROLE_ORDER: ReadonlyArray<string> = [
  "smol",
  "advisor",
  "designer",
  "plan",
  "commit",
  "task",
  "vision",
  "tiny",
  "default",
  "slow",
  "fable",
  "switch_fable",
  "astra",
  "reviewer",
  "memory",
  "judge",
];

/**
 * Retry chain keys in the order used by SoT/.omp/config.yml, then `memory` and
 * `judge`. An explicit empty chain stops omp from using its built-in priority
 * chain. The `web` chain is left out, so the deployed chain applies.
 */
const FALLBACK_ORDER: ReadonlyArray<string> = [
  "default",
  "advisor",
  "task",
  "vision",
  "smol",
  "tiny",
  "commit",
  "switch_fable",
  "fable",
  "astra",
  "reviewer",
  "memory",
  "judge",
];

/**
 * Collect free models from parsed `omp models --json` output. The function is
 * total because catalog output varies across omp versions, and one malformed
 * row must not discard the remaining picker list.
 */
export function parseFreeModels(catalogJson: unknown): ReadonlyArray<CatalogModel> {
  if (typeof catalogJson !== "object" || catalogJson === null || Array.isArray(catalogJson)) {
    return [];
  }
  const models = (catalogJson as Record<string, unknown>)["models"];
  if (!Array.isArray(models)) return [];
  const found: Array<CatalogModel> = [];
  for (const row of models) {
    if (typeof row !== "object" || row === null || Array.isArray(row)) continue;
    const record = row as Record<string, unknown>;
    const selector = record["selector"];
    if (typeof selector !== "string" || selector.length === 0) continue;
    const cost = record["cost"];
    if (typeof cost !== "object" || cost === null || Array.isArray(cost)) continue;
    const charges = cost as Record<string, unknown>;
    if (charges["input"] !== 0 || charges["output"] !== 0) continue;
    // omp prices a usage-billed or plan-included model at zero, so a zero
    // cost is not proof of a free model. Older omp output has no status.
    const status = record["pricingStatus"];
    if (typeof status === "string" && status !== "free" && status !== "unknown") continue;
    const rawName = record["name"];
    const name = typeof rawName === "string" && rawName.length > 0 ? rawName : selector;
    const rawLevels = record["thinking"];
    // Keep only known ladder levels in ladder order so an unknown future
    // level never reaches a role value that omp would reject.
    const thinking = THINKING_LADDER.filter(
      (level) => Array.isArray(rawLevels) && (rawLevels as Array<unknown>).includes(level),
    );
    const rawWindow = record["contextWindow"];
    const contextWindow =
      typeof rawWindow === "number" && Number.isFinite(rawWindow) ? rawWindow : 0;
    found.push({ selector, name, thinking, contextWindow });
  }
  // Sort by selector so the picker list is stable across catalog orderings.
  found.sort((a, b) => (a.selector < b.selector ? -1 : a.selector > b.selector ? 1 : 0));
  return found;
}

/**
 * Resolve the highest ladder level a model supports. A model without a
 * recognized ladder yields undefined so callers never invent a level the
 * model would reject at session start.
 */
export function ladderCeiling(levels: ReadonlyArray<string>): string | undefined {
  for (let index = THINKING_LADDER.length - 1; index >= 0; index -= 1) {
    if (levels.includes(THINKING_LADDER[index] as string)) return THINKING_LADDER[index] as string;
  }
  return undefined;
}

/**
 * Resolve the advisor level from the model own ladder. The advisor runs
 * quick review passes, so it takes the highest level at or below medium,
 * and the lowest level when the ladder starts above medium. The result
 * never exceeds the ladder ceiling by construction.
 */
export function advisorLevelFor(levels: ReadonlyArray<string>): string | undefined {
  const known = THINKING_LADDER.filter((level) => levels.includes(level));
  if (known.length === 0) return undefined;
  const mediumIndex = THINKING_LADDER.indexOf("medium");
  let advisor: string | undefined;
  for (const level of known) {
    if ((THINKING_LADDER.indexOf(level) as number) <= (mediumIndex as number)) advisor = level;
  }
  return advisor ?? (known[0] as string);
}

/**
 * What the picker may ask about thinking levels for one model. omp accepts a
 * `:level` suffix on a role only for a level the model publishes, so the
 * question set comes from the model own ladder: no ladder means no question,
 * a single level means no choice to make, and two or more levels mean the
 * user can split the advisor from the other roles.
 */
export type EffortPlan =
  | { readonly kind: "none" }
  | { readonly kind: "fixed"; readonly level: string }
  | { readonly kind: "choose"; readonly levels: ReadonlyArray<string>; readonly highest: string };

export function planEffortChoice(levels: ReadonlyArray<string>): EffortPlan {
  const known = THINKING_LADDER.filter((level) => levels.includes(level));
  const only = known[0];
  if (only === undefined) return { kind: "none" };
  if (known.length === 1) return { kind: "fixed", level: only };
  return { kind: "choose", levels: known, highest: known[known.length - 1] as string };
}

/**
 * Recommend an advisor level for a chosen main level. The advisor runs quick
 * review passes, so it sits two steps down the model own ladder, and it
 * clamps to the lowest level the model publishes. Steps count positions in
 * that model ladder, not the global ladder, so a sparse ladder such as
 * `high, max` still recommends a real level.
 */
export function advisorRecommendation(
  levels: ReadonlyArray<string>,
  main: string,
): string | undefined {
  const known = THINKING_LADDER.filter((level) => levels.includes(level));
  const index = known.indexOf(main);
  if (index < 0) return known[0];
  return known[Math.max(0, index - 2)];
}

/**
 * Render the run overlay as YAML text. Empty fallback chains keep a retry
 * from falling back onto a paid model. A model without a level renders bare
 * selectors with no thinking keys so the deployed values apply.
 */
export function renderFreeOverlay(model: OmpSessionModel): string {
  const thinking =
    typeof model.thinking === "string" && model.thinking.trim() !== "" ? model.thinking : undefined;
  const lines: Array<string> = ["# Generated per run by docks-kit omp. Edits are overwritten."];
  if (thinking !== undefined) {
    lines.push(`defaultThinkingLevel: ${thinking}`, "modelRoles:");
    const advisor =
      typeof model.advisorThinking === "string" && model.advisorThinking.trim() !== ""
        ? model.advisorThinking
        : thinking;
    for (const role of ROLE_ORDER) {
      lines.push(`  ${role}: ${model.selector}:${role === "advisor" ? advisor : thinking}`);
    }
    lines.push("task:", `  maxEffort: ${thinking}`);
  } else {
    lines.push("modelRoles:");
    for (const role of ROLE_ORDER) {
      lines.push(`  ${role}: ${model.selector}`);
    }
  }
  lines.push("retry:", "  fallbackChains:");
  for (const chain of FALLBACK_ORDER) {
    lines.push(`    ${chain}: []`);
  }
  return `${lines.join("\n")}\n`;
}

/** Build the omp argv with the overlay flag ahead of the forwarded args. */
export function buildOmpArgs(
  overlayPath: string,
  passthrough: ReadonlyArray<string>,
): ReadonlyArray<string> {
  return ["--config", overlayPath, ...passthrough];
}
