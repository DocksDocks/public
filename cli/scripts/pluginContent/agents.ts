import { readFileSync, readdirSync } from "node:fs";
import { basename, join, relative, sep } from "node:path";
import config from "./config.json" with { type: "json" };
import {
  agentsDir,
  anyLine,
  bodyAfterFrontmatter,
  countLines,
  frontmatterBlock,
  frontmatterKeys,
  slopCount,
  splitLines,
} from "./frontmatter.ts";
import { type ScoreResult, scoreFloorFailures } from "./skills.ts";

/**
 * The agent checks of the DocksDocks/docks gate, ported to the kit plugin: the
 * agent file gate of `scripts/ci.mjs gateAgentFiles`, `scripts/agents/guard.mjs`,
 * and `scripts/agents/score.mjs` with the per-file floor. Each check takes a
 * repository root and returns one message per problem; a message names the
 * file relative to the root.
 */

const MAX_BODY_LINES = 500;
const MAX_DESCRIPTION_LENGTH = 1024;
const MIN_DESCRIPTION_LENGTH = 10;
/** A `${...}` variable. omp sets no plugin root variable for an agent, so the text stays literal. */
const TEXT_VARIABLE = /\$\{[^}\s]*\}/gu;

/** The agent markdown files of the plugin, sorted, as repository-relative and absolute paths. */
function agentFiles(repoRoot: string): Array<{ readonly shown: string; readonly path: string }> {
  const dir = agentsDir(repoRoot);
  return readdirSync(dir)
    .filter((name) => name.endsWith(".md"))
    .sort()
    .map((name) => ({
      shown: relative(repoRoot, join(dir, name)).split(sep).join("/"),
      path: join(dir, name),
    }));
}

/**
 * Each agent file loads as an omp task agent: it has frontmatter with a name
 * and a description, no `model` key (omp reads the value as a model id, and a
 * value that resolves to no model fails the spawn), and no `${...}` variable.
 */
export function checkAgentFiles(repoRoot: string): Array<string> {
  const failures: Array<string> = [];
  for (const { shown, path } of agentFiles(repoRoot)) {
    const text = readFileSync(path, "utf8");
    const block = frontmatterBlock(text);
    const keys = frontmatterKeys(block ?? "");
    const problems: Array<string> = [];
    if (block === null) problems.push("has no frontmatter");
    for (const key of ["name", "description"]) if (!keys.has(key)) problems.push(`has no ${key}`);
    if (keys.has("model")) problems.push("has a model key");
    const variables = [...new Set(text.match(TEXT_VARIABLE) ?? [])];
    if (variables.length > 0)
      problems.push(`names ${variables.join(", ")}, which omp does not set`);
    if (problems.length > 0) failures.push(`${shown}: ${problems.join("; ")}`);
  }
  return failures;
}

/** The value of a frontmatter field, read only from the frontmatter lines, or "". */
function fieldOf(lines: ReadonlyArray<string>, frontmatterEnd: number, key: string): string {
  const prefix = `${key}:`;
  const line = lines.slice(1, frontmatterEnd).find((entry) => entry.startsWith(prefix));
  return line === undefined ? "" : line.slice(prefix.length).trimStart();
}

function guardErrors(name: string, content: string): Array<string> {
  const lines = splitLines(content);
  if (lines[0] !== "---") return ["does not start with '---' frontmatter fence"];
  const fences = lines.filter((line) => line === "---").length;
  if (fences < 2) return [`frontmatter fence not closed (found ${fences} '---' lines)`];
  // omp reads agent fields only from the frontmatter, so a body line that looks
  // like a field does not count.
  const end = lines.indexOf("---", 1);
  const field = (key: string): string => fieldOf(lines, end, key);
  const errors: Array<string> = [];

  const nameField = field("name");
  if (nameField !== name) errors.push(`name field ('${nameField}') does not match filename`);
  if (!/^[a-z][a-z0-9-]{0,63}$/.test(nameField)) {
    errors.push(`name not kebab-case or >64 chars ('${nameField}')`);
  }
  // omp refuses an agent named `main` or `sub` after it trims and lowercases the name.
  if (["main", "sub"].includes(nameField.trim().toLowerCase())) {
    errors.push(`name '${nameField}' is reserved: omp refuses an agent named main or sub`);
  }

  const description = field("description");
  const descriptionLength = [...description].length;
  if (descriptionLength < MIN_DESCRIPTION_LENGTH) {
    errors.push(`description missing or too short (${descriptionLength} chars)`);
  } else if (descriptionLength > MAX_DESCRIPTION_LENGTH) {
    errors.push(`description exceeds ${MAX_DESCRIPTION_LENGTH} chars (${descriptionLength})`);
  }
  if (!/^use when/i.test(description)) errors.push("description must start with 'Use when' (CSO)");
  if (!/\bnot\b/i.test(description)) {
    errors.push("description missing 'Not for…' exclusion clause (prevents delegation collisions)");
  }

  // omp reads a `model` value as a model id, and a value that resolves to no
  // model fails the spawn with "No model selected". Without the key, the agent
  // uses the parent session model; a consumer pins a model per agent with the
  // `task.agentModelOverrides.<agent>` setting.
  const model = field("model");
  if (model !== "") {
    errors.push(
      `remove 'model: ${model}'; plugin agents must omit it (omp reads the value as a model id, and without the key the agent uses the parent session model). Pin per-agent models with task.agentModelOverrides.<agent> instead`,
    );
  }

  const tools = field("tools");
  if (tools === "") errors.push("tools field missing or empty");

  const bodyLines = bodyAfterFrontmatter(lines).length;
  if (bodyLines > MAX_BODY_LINES) {
    errors.push(
      `body is ${bodyLines} lines (cap: ${MAX_BODY_LINES}). Extract detail out of the agent prompt`,
    );
  }
  if (!anyLine(lines, /<constraint>/)) errors.push("no <constraint> block in body");
  if (!anyLine(lines, /^## Workflow/)) errors.push("missing '## Workflow' section");
  if (!anyLine(lines, /^## Success Criteria/)) errors.push("missing '## Success Criteria' section");

  // omp sets no plugin root variable in an agent, so a `${...}` stays literal
  // text. A plugin agent names each file of its skill as `skill://<skill>/<path>`.
  const variables = [...new Set(content.match(TEXT_VARIABLE) ?? [])];
  if (variables.length > 0) {
    errors.push(
      `remove ${variables.join(", ")}; omp sets no plugin root variable, so name each skill file as skill://<skill>/<path>`,
    );
  }
  const badSkillReferences = lines.filter(
    (line) => /\/SKILL\.md/.test(line) && !/skill:\/\/[a-z0-9-]+\/SKILL\.md/.test(line),
  );
  if (badSkillReferences.length > 0) {
    errors.push(
      `a bundled SKILL.md must load via skill://<skill>/SKILL.md, not a file path:\n${badSkillReferences.map((line) => `    ${line}`).join("\n")}`,
    );
  }
  if (/(^|[, ])Agent([,(]| |$)/.test(tools)) {
    errors.push(
      "'Agent' is not an omp tool name; remove it, and list the agents that this agent starts in 'spawns'",
    );
  }
  return errors;
}

/** The structure rules of the docks agent guard, for each agent file. */
export function checkAgentGuard(repoRoot: string): Array<string> {
  const failures: Array<string> = [];
  for (const { shown, path } of agentFiles(repoRoot)) {
    const name = basename(path, ".md");
    if (name === ".gitkeep" || name === "AGENTS") continue;
    for (const error of guardErrors(name, readFileSync(path, "utf8"))) {
      failures.push(`${shown}: ${error}`);
    }
  }
  return failures;
}

/**
 * The research gate: the agent settles a claim against an authoritative
 * source, not its memory. Form 1 is a verification verb whose object, in the
 * same sentence, is a source of truth. Form 2 names a documentation lookup tool.
 */
const RESEARCH_VERB = String.raw`\b(?:verif|confirm|check|validat|corroborat|cross-check|re-read|trace)`;
const SOURCE_OF_TRUTH = String.raw`(?:${[
  "official\\s+doc",
  "current\\s+doc",
  "upstream\\s+doc",
  "authoritative\\s+(?:doc|source)",
  "release\\s+notes",
  "changelog",
  "current\\s+(?:official|authoritative)",
  "against\\s+actual\\b",
  "the\\s+source\\s+code",
].join("|")})`;
const RESEARCH_DISCIPLINE = new RegExp(`${RESEARCH_VERB}[^.\\n]*${SOURCE_OF_TRUTH}`, "i");
const RESEARCH_TOOL = /\b(?:resolve-library-id|query-docs|context7)\b/i;

/** The frontmatter line of `key`, or undefined. Body lines that look like fields do not count. */
function frontmatterFieldLine(lines: ReadonlyArray<string>, key: string): string | undefined {
  const start = lines.indexOf("---");
  if (start === -1) return undefined;
  const end = lines.indexOf("---", start + 1);
  if (end === -1) return undefined;
  return lines.slice(start + 1, end).find((line) => line.startsWith(`${key}:`));
}

/** The mechanical quality score of one agent file, at most 15 points. */
export function scoreAgent(content: string): number {
  const lines = splitLines(content);
  let score = 0;
  const description = (frontmatterFieldLine(lines, "description") ?? "")
    .slice("description:".length)
    .trimStart();
  if (/^use when/i.test(description)) score += 2;
  if (/\bnot\b/i.test(description)) score += 1;
  const descriptionLength = [...description].length;
  if (descriptionLength >= 80 && descriptionLength <= 500) score += 1;
  score += Math.min(2, countLines(lines, /<constraint>/));
  if (anyLine(lines, /^## Workflow/)) score += 1;
  if (anyLine(lines, /^## Success Criteria/)) score += 1;
  const bodyLines = bodyAfterFrontmatter(lines).length;
  if (bodyLines >= 60 && bodyLines <= 300) score += 1;
  if (anyLine(lines, /anti-hallucination|file:line refs|verify import paths/i)) score += 1;
  if (frontmatterFieldLine(lines, "model") === undefined) score += 1;
  if (frontmatterFieldLine(lines, "tools") !== undefined) score += 1;
  score += Math.max(0, 2 - slopCount(lines));
  if (RESEARCH_DISCIPLINE.test(content) || RESEARCH_TOOL.test(content)) score += 1;
  return score;
}

/**
 * Score each agent file and apply the score floor. The score rows and the
 * names on disk leave out `AGENTS.md` and `CLAUDE.md`, as the docks gate did.
 */
export function scoreAgents(repoRoot: string, floor: number = config.floors.agents): ScoreResult {
  const files = agentFiles(repoRoot).filter(
    ({ path }) => !["AGENTS.md", "CLAUDE.md"].includes(basename(path)),
  );
  const rows = files.map(({ path }) => ({
    name: basename(path, ".md"),
    score: scoreAgent(readFileSync(path, "utf8")),
  }));
  const failures = scoreFloorFailures({
    kind: "agent",
    rows,
    onDisk: files.map(({ path }) => basename(path, ".md")),
    floor,
  });
  return { rows, failures };
}
