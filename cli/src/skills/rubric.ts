/**
 * The 16-point docks skill rubric, the one source of the skill score: `docks-kit skill score`, the score line of
 * `docks-kit skill guard`, and the score floor of the kit gate all call `scoreSkill`. It reads the raw text of a
 * SKILL.md line by line, as the former `write-skill/scripts/skill-guard.mjs` did, so the description is the raw first
 * `description:` line, not the YAML value. The line readers below also serve the validator and the agent scorer.
 */

const SECONDS_PER_DAY = 86_400;
/** A dated field older than this many days earns no freshness point and draws a staleness warning. */
export const FRESH_DAYS = 180;
const MAX_SHORT_DESCRIPTION = 500;
const MAX_LONG_DESCRIPTION = 1000;
const MAX_CONSTRAINT_POINTS = 3;
const MAX_SLOP_POINTS = 2;
const MIN_TARGET_BODY_LINES = 80;
const MAX_TARGET_BODY_LINES = 310;

/** The lines of a file, without the empty item after a final newline. */
export function splitLines(content: string): Array<string> {
  return (content.endsWith("\n") ? content.slice(0, -1) : content).split("\n");
}

export const countLines = (lines: ReadonlyArray<string>, pattern: RegExp): number =>
  lines.reduce((count, line) => (pattern.test(line) ? count + 1 : count), 0);

export const anyLine = (lines: ReadonlyArray<string>, pattern: RegExp): boolean =>
  lines.some((line) => pattern.test(line));

/**
 * The lines after the second `---` line. Only the first two `---` lines are
 * fences, so a `---` line in the body counts as body.
 */
export function bodyAfterFrontmatter(lines: ReadonlyArray<string>): Array<string> {
  let fences = 0;
  const out: Array<string> = [];
  for (const line of lines) {
    if (line === "---" && fences < 2) {
      fences += 1;
      continue;
    }
    if (fences === 2) out.push(line);
  }
  return out;
}

const SLOP_PATTERN = /\b(comprehensive|robust|elegant|seamless)\b/i;

/** The prose lines with a banned word. Fenced code and inline code do not count. */
export function slopCount(lines: ReadonlyArray<string>): number {
  let inFence = false;
  const prose: Array<string> = [];
  for (const line of lines) {
    if (/^```/.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (!inFence) prose.push(line.replace(/`[^`]*`/g, ""));
  }
  return countLines(prose, SLOP_PATTERN);
}

/** The seconds since the epoch of a `YYYY-MM-DD` date at midnight UTC, or 0 when it does not parse. */
export function dateSeconds(date: string): number {
  const millis = Date.parse(`${date}T00:00:00Z`);
  return Number.isNaN(millis) ? 0 : Math.floor(millis / 1000);
}

/** The whole days from `date` to `nowSeconds`. */
export const ageDays = (nowSeconds: number, dateSecondsValue: number): number =>
  Math.floor((nowSeconds - dateSecondsValue) / SECONDS_PER_DAY);

/**
 * The digits and hyphens after `<key>:` on the first line inside the top-level `<block>:` mapping that holds `key`,
 * or `""`. The block ends at the next line that starts with a lowercase letter.
 */
function blockDate(lines: ReadonlyArray<string>, block: RegExp, key: string): string {
  const keyPattern = new RegExp(`${key}:`);
  const valuePattern = new RegExp(`${key}:\\s*"?([0-9-]*)"?`);
  let inBlock = false;
  for (const line of lines) {
    if (block.test(line)) {
      inBlock = true;
      continue;
    }
    if (inBlock && /^[a-z]/.test(line)) inBlock = false;
    if (inBlock && keyPattern.test(line)) return valuePattern.exec(line)?.[1] ?? "";
  }
  return "";
}

/** The `metadata.updated` date as the line reader sees it, or `""`. */
export const metadataUpdated = (lines: ReadonlyArray<string>): string =>
  blockDate(lines, /^metadata:/, "updated");

/** The `upstream.vendored_at` date as the line reader sees it, or `""`. */
const upstreamVendored = (lines: ReadonlyArray<string>): string =>
  blockDate(lines, /^upstream:/, "vendored_at");

/** The number of top-level `upstream:` lines; a vendored skill has one. */
export const upstreamCount = (lines: ReadonlyArray<string>): number =>
  countLines(lines, /^upstream:/);

/** The raw first `description:` line without the key and one pair of outer quotes. */
function rawDescription(lines: ReadonlyArray<string>): string {
  const line = lines.find((entry) => /^description:/.test(entry)) ?? "";
  return line
    .replace(/^description:\s*/, "")
    .replace(/^"/, "")
    .replace(/"$/, "")
    .replace(/^'/, "")
    .replace(/'$/, "");
}

/**
 * The 16-point score of one SKILL.md text. `nowMillis` is the clock that dates `metadata.updated` (or, for a vendored
 * skill, `upstream.vendored_at`) against the 180-day freshness window.
 */
export function scoreSkill(content: string, nowMillis: number): number {
  const lines = splitLines(content);
  const nowSeconds = Math.floor(nowMillis / 1000);
  let points = 0;
  const vendored = upstreamCount(lines) > 0;
  const description = rawDescription(lines);
  const descriptionLength = [...description].length;
  if (vendored ? /use when/i.test(description) : /^use when/i.test(description)) points += 2;
  if (descriptionLength > 0 && descriptionLength <= MAX_SHORT_DESCRIPTION) points += 2;
  else if (descriptionLength > 0 && descriptionLength <= MAX_LONG_DESCRIPTION) points += 1;
  const updated = metadataUpdated(lines) || (vendored ? upstreamVendored(lines) : "");
  if (updated !== "") {
    const seconds = dateSeconds(updated);
    if (seconds > 0 && ageDays(nowSeconds, seconds) <= FRESH_DAYS) points += 1;
  }
  points += Math.min(MAX_CONSTRAINT_POINTS, countLines(lines, /<constraint>/));
  const bad = anyLine(lines, /\bBAD\b|\/\/\s*BAD|#\s*BAD/);
  const good = anyLine(lines, /\bGOOD\b|\/\/\s*GOOD|#\s*GOOD/);
  if ((bad && good) || (anyLine(lines, /wrong fix/i) && anyLine(lines, /right fix/i))) points += 2;
  points += Math.max(0, MAX_SLOP_POINTS - slopCount(lines));
  if (anyLine(lines, /^\|.*\|/)) points += 1;
  if (anyLine(lines, /^```[a-z]+/)) points += 1;
  const bodyLines = bodyAfterFrontmatter(lines).length;
  if (bodyLines >= MIN_TARGET_BODY_LINES && bodyLines <= MAX_TARGET_BODY_LINES) points += 2;
  return points;
}
