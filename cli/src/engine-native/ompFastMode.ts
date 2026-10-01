/**
 * `docks-kit omp --fast` toggles omp's OpenAI service tier in the deployed
 * config.yml. `tier.openai: priority` is what omp's `/fast on` selects for
 * OpenAI and OpenAI-Codex models; `none` omits `service_tier`. The SoT does not
 * declare `tier.openai`, so the additive sync merge keeps the toggled value.
 */
import { chmodSync, existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { isMap, parseDocument } from "yaml";

export const FAST_ON_TIER = "priority";
export const FAST_OFF_TIER = "none";

export interface FastToggle {
  /** The deployed `tier.openai` value before the toggle; omp's default `none` when unset. */
  readonly previous: string;
  readonly next: typeof FAST_ON_TIER | typeof FAST_OFF_TIER;
  readonly text: string;
}

/**
 * Pure toggle over config.yml text; edits only `tier.openai`. Only `priority`
 * counts as on, so any other tier, `ultrafast` included, switches to plain fast.
 */
export function toggleOpenAiFast(configText: string): FastToggle {
  const doc = parseDocument(configText);
  const parseError = doc.errors[0];
  if (parseError !== undefined) {
    throw new Error(`Invalid omp config.yml YAML: ${parseError.message}`);
  }
  if (doc.contents !== null && !isMap(doc.contents)) {
    throw new Error("omp config.yml root must be a mapping");
  }
  const tier = doc.get("tier", true);
  if (tier !== undefined && tier !== null && !isMap(tier)) {
    throw new Error("omp config.yml key 'tier' must be a mapping");
  }

  const current = doc.getIn(["tier", "openai"]);
  const previous = typeof current === "string" && current !== "" ? current : FAST_OFF_TIER;
  const next = previous === FAST_ON_TIER ? FAST_OFF_TIER : FAST_ON_TIER;
  doc.setIn(["tier", "openai"], next);
  return { previous, next, text: doc.toString() };
}

/** Toggle `tier.openai` in the deployed config.yml with an atomic 0600 write. */
export function toggleDeployedOpenAiFast(configPath: string): FastToggle {
  if (!existsSync(configPath)) {
    throw new Error(`${configPath} does not exist; run 'docks-kit sync omp' first`);
  }
  const toggle = toggleOpenAiFast(readFileSync(configPath, "utf8"));
  const temporary = `${configPath}.tmp`;
  writeFileSync(temporary, toggle.text, { mode: 0o600 });
  chmodSync(temporary, 0o600);
  renameSync(temporary, configPath);
  return toggle;
}
