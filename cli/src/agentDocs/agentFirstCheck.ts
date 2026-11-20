/**
 * `docks-kit agent-docs agent-first detect | check | convert-agent <path>`: detect the agent-doc state of a
 * repository (Step 0 of agent-first-setup), run the agent-first check C1 to C10 (Step 3), and convert one Claude Code
 * agent file to the omp form (the .claude cleanup of Step 2a). Each command reads only; none writes a file. The
 * meaning of each line and the reaction to it live in the SKILL.md of agent-first-setup. Run it from any folder inside
 * the repository, or from the folder to check outside git.
 *
 * Output lines:
 *   detect  the repository root (the current folder outside git); then `root AGENTS.md: present|missing`,
 *           `.agents/skills: present|missing`; the legacy `.claude` lines (see `legacyClaudeLines`); one
 *           `legacy: <path>` line for each CLAUDE.md and .claude/CLAUDE.md (the root ones also when git ignores
 *           them), one `personal: <path>` line for each CLAUDE.local.md, one `node: <path>` line for each AGENTS.md
 *           below the root (none under node_modules), one `not-a-symlink: <path>` line for each `.claude/skills`
 *           entry that is no symlink; then the lines of `pr-template detect` and `verify-skill detect`. A listing
 *           that fails prints `ERROR <label>: file listing failed (see the message above)` in place of the lines of
 *           that label; the label of the `.claude` entries is `legacy entries:`.
 *   check   one `FAIL C<n> ...` (a contract break), `FINDING C<n> ...` (a risk or cleanup item a human judges), or
 *           `ERROR C<n> ...` (a check that could not run) line per problem, in the order C1 to C10. No output means
 *           every check passed.
 *   convert-agent
 *           the omp agent text of the Claude agent file at <path> (relative to the current folder): `name`,
 *           `description`, and `tools` with omp tool names, then the body. The dropped `model`, `color`, and
 *           `effort` fields are named on stderr. An agent that has no exact omp form gives one
 *           `ERROR convert-agent <path>: <reason>; port it by hand` line and no agent text.
 *   Paths are relative to the repository root, without a leading `./`. Outside git, the listings walk the folder and
 *   skip each .git, node_modules, and vendor folder.
 *
 * Exit status: 2 after an ERROR line (its cause is on stderr, or in the line for a refused agent), 1 for a usage
 * error, otherwise 0.
 */
import path from "node:path";

import { Effect, Schema } from "effect";

import type { SpawnError } from "../plan/types";
import { prTemplateLines } from "./prTemplate";
import {
  AgentDocsFiles,
  type AgentDocsGit,
  errorDetail,
  printLines,
  writeStderr,
  writeStdout,
} from "./services";
import {
  AGENT_FIRST_PRUNE,
  agentsDocs,
  asciiLower,
  byteOrder,
  CODE_SPAN,
  type CheckError,
  claudeSkillsInRepository,
  durableDocScan,
  eachGuarded,
  type FileListing,
  findEntries,
  guarded,
  isAgentsLink,
  isFile,
  isFolder,
  legacyClaudeEntries,
  legacyClaudeLines,
  type Listing,
  listFiles,
  nestedNodes,
  proseLines,
  ROOT_CONTEXT_FILES,
  ROOT_PERSONAL_FILES,
  readFolder,
  readText,
  repositoryRoot,
  type RoutingGaps,
  routingGaps,
  SPACE,
  textLines,
  UsageError,
  withRootFiles,
} from "./shared";
import { verifySkillLines } from "./verifySkill";

const USAGE = "usage: docks-kit agent-docs agent-first detect | check | convert-agent <path>";
const ROOT_AGENTS = "AGENTS.md";
const CLAUDE_SKILLS = ".claude/skills";
const VERIFY_SKILL = ".agents/skills/verify/SKILL.md";
const PR_NONE_LINE = "pull-request template: none";
const PR_UNUSABLE_PREFIX = "pull-request template: unusable ";
const PR_ERROR_LINE = "ERROR pull-request template check failed (see the message above)";
const VERIFY_UNVERIFIED_PREFIX = "verify unverified: ";
const NODE_LINE_LIMIT = 500;
const STALE_TOLERANCE = /pointers (here )?name concepts/u;
const DESCRIPTION_BLOCK = new RegExp(`^description:[${SPACE}]*[>|][-+]?[${SPACE}]*$`, "u");
const DESCRIPTION_VALUE = new RegExp(`^description:[${SPACE}]*["']?`, "u");
// awk's NF counts fields split on spaces, tabs, and newlines only.
const AWK_FIELD = /[^ \t\n]/u;
const LEADING_SPACE = new RegExp(`^[${SPACE}]+`, "u");
const EAGER_IMPORT = new RegExp(
  `(^|[${SPACE}(\\[])@[A-Za-z0-9._~/-]*[A-Za-z0-9_-]\\.[A-Za-z0-9]+`,
  "u",
);

/** `grep -E pattern file`: true when a line of `text` matches. */
const anyLine = (text: string, pattern: RegExp): boolean =>
  textLines(text).some((line) => pattern.test(line));

/** `wc -l`: the number of newline bytes, or null when no file is there. */
const lineCount = Effect.fn("agentFirst.lineCount")(function* (file: string) {
  const text = yield* readText(file, "latin1");
  return text === null ? null : text.split("\n").length - 1;
});

/** The repository: its root and whether git answers for it. */
interface Repository {
  readonly root: string;
  readonly inGit: boolean;
}

/** The listings of one repository; each lists anew when it runs. */
interface Listings {
  readonly tracked: (...pathspecs: ReadonlyArray<string>) => FileListing;
  readonly legacy: () => FileListing;
  readonly personal: () => FileListing;
  readonly agentsDocs: () => FileListing;
  readonly nodes: () => FileListing;
  readonly routingGaps: () => Effect.Effect<
    RoutingGaps,
    CheckError | SpawnError,
    AgentDocsFiles | AgentDocsGit
  >;
}

function repositoryListings(repo: Repository): Listings {
  const listing: Listing = { root: repo.root, prune: AGENT_FIRST_PRUNE, inGit: repo.inGit };
  return {
    tracked: (...pathspecs) => listFiles({ ...listing, pathspecs, excludeStandard: true }),
    // Each CLAUDE.md and .claude/CLAUDE.md; the root ones also when git ignores them, because omp loads them.
    legacy: () =>
      Effect.flatMap(
        listFiles({ ...listing, pathspecs: [":(glob)**/CLAUDE.md"], excludeStandard: true }),
        (files) => withRootFiles(files, ROOT_CONTEXT_FILES),
      ),
    // CLAUDE.local.md is usually gitignored, so this listing keeps ignored files.
    personal: () =>
      Effect.flatMap(listFiles({ ...listing, pathspecs: [":(glob)**/CLAUDE.local.md"] }), (files) =>
        withRootFiles(files, ROOT_PERSONAL_FILES),
      ),
    agentsDocs: () => agentsDocs(listing),
    nodes: () => nestedNodes(listing),
    routingGaps: () => routingGaps(listing),
  };
}

// --- detect (Step 0) ---

const presence = (label: string, present: boolean): string =>
  `${label}: ${present ? "present" : "missing"}`;

const detectLines = Effect.fn("agentFirst.detectLines")(function* (repo: Repository) {
  const list = repositoryListings(repo);
  const pr = yield* prTemplateLines(repo.inGit ? repo.root : null);
  return [
    presence("root AGENTS.md", yield* isFile(ROOT_AGENTS)),
    presence(".agents/skills", yield* isFolder(".agents/skills")),
    ...(yield* guarded("legacy entries:", legacyClaudeLines())),
    ...(yield* guarded(
      "legacy:",
      Effect.map(list.legacy(), (files) => files.map((file) => `legacy: ${file}`)),
    )),
    ...(yield* guarded(
      "personal:",
      Effect.map(list.personal(), (files) => files.map((file) => `personal: ${file}`)),
    )),
    ...(yield* guarded(
      "node:",
      Effect.map(list.nodes(), (nodes) => nodes.map((node) => `node: ${node}`)),
    )),
    ...(yield* guarded(
      "not-a-symlink:",
      Effect.gen(function* () {
        if (!(yield* claudeSkillsInRepository())) return [];
        return (yield* findEntries(CLAUDE_SKILLS))
          .filter((entry) => entry.kind !== "symlink")
          .map((entry) => `not-a-symlink: ${CLAUDE_SKILLS}/${entry.name}`);
      }),
    )),
    // The shell wrapper dropped the lines found before a failure and printed only its ERROR line.
    ...(pr.ok ? pr.lines : [PR_ERROR_LINE]),
    ...(yield* verifySkillLines()).lines,
  ];
});

// --- check (Step 3) ---

const rootCommandLines = Effect.fn("agentFirst.rootCommandLines")(function* () {
  if (!(yield* isFile(ROOT_AGENTS))) return ["FAIL C1 root AGENTS.md missing"];
  const text = asciiLower((yield* readText(ROOT_AGENTS)) ?? "");
  // `grep -qiw <kind>`: the kind as a whole word, in any ASCII letter case.
  const names = (kind: string): boolean =>
    anyLine(text, new RegExp(`(^|[^a-z0-9_])${kind}([^a-z0-9_]|$)`, "u"));
  return ["build", "test", "lint"]
    .filter((kind) => !names(kind))
    .map(
      (kind) =>
        `FINDING C1 root AGENTS.md names no ${kind} command (add it, or accept: the repo has none or one gate covers it)`,
    );
});

const routingLines = Effect.fn("agentFirst.routingLines")(function* (list: Listings) {
  const { unroutedNodes, deadRoutes } = yield* list.routingGaps();
  return [
    ...unroutedNodes.map((node) => `FAIL C2 node not routed from root: ${node}`),
    ...deadRoutes.map((route) => `FAIL C2 dead route in root table: ${route}`),
  ];
});

const MIGRATE = "migrate it with claude-md-migration";

/**
 * The C3 line for one CLAUDE.md, .claude/CLAUDE.md, or CLAUDE.local.md, as omp loads it: a link to the AGENTS.md of
 * its folder holds no text to migrate, a .claude/CLAUDE.md wins over the AGENTS.md of the folder where a session
 * starts, a CLAUDE.md next to an AGENTS.md is ignored, a CLAUDE.md alone at its depth loads, and omp does not load a
 * CLAUDE.local.md.
 */
const claudeFileLine = Effect.fn("agentFirst.claudeFileLine")(function* (file: string) {
  const folder = path.posix.dirname(file);
  if (path.posix.basename(file) === "CLAUDE.local.md") {
    return `FINDING C3 CLAUDE.local.md that omp does not load (personal file; the user decides: list it in contextFiles.extra, move it to ~/.omp/agent/AGENTS.md, or keep it): ${file}`;
  }
  if (yield* isAgentsLink(file)) {
    return `FAIL C3 CLAUDE.md link to AGENTS.md (remove the link; there is nothing to migrate): ${file}`;
  }
  if (path.posix.basename(folder) === ".claude") {
    return `FAIL C3 .claude/CLAUDE.md (omp loads it instead of the AGENTS.md of that folder when a session starts there; ${MIGRATE}): ${file}`;
  }
  if (yield* isFile(folder === "." ? ROOT_AGENTS : `${folder}/${ROOT_AGENTS}`)) {
    return `FAIL C3 CLAUDE.md next to an AGENTS.md (omp ignores it; ${MIGRATE}): ${file}`;
  }
  return `FINDING C3 CLAUDE.md without an AGENTS.md next to it (it loads, but AGENTS.md is the convention; ${MIGRATE}): ${file}`;
});

const claudeFileLines = Effect.fn("agentFirst.claudeFileLines")(function* (list: Listings) {
  const files = new Set([...(yield* list.legacy()), ...(yield* list.personal())]);
  return yield* eachGuarded("C3", [...files].sort(byteOrder), (file) =>
    Effect.map(claudeFileLine(file), (line) => [line]),
  );
});

/**
 * The names that `.claude/skills/*` expands to: no dot names, in byte order, through a symlinked `.claude/skills` too.
 */
const skillGlobNames = Effect.fn("agentFirst.skillGlobNames")(function* () {
  return (yield* readFolder(CLAUDE_SKILLS))
    .map((entry) => entry.name)
    .filter((name) => !name.startsWith("."))
    .sort(byteOrder);
});

/**
 * C4: each `.claude/skills` entry, each Claude agent file, and each Claude settings file is a legacy entry that the
 * cleanup of agent-first-setup handles. A `.claude` link to a place outside the repository and each other `.claude/`
 * entry are only reported.
 */
const legacyEntryLines = Effect.fn("agentFirst.legacyEntryLines")(function* () {
  const { external, skills, agents, settings, others } = yield* legacyClaudeEntries();
  const skillEntries =
    skills === null ? [] : (yield* skillGlobNames()).map((name) => `${CLAUDE_SKILLS}/${name}`);
  return [
    ...external.map(
      (link) =>
        `FINDING C4 legacy .claude entry outside the repository (report it; never move or remove it): ${link.path}`,
    ),
    ...[...skillEntries, ...agents, ...settings].map(
      (entry) => `FINDING C4 legacy .claude entry (agent-first-setup cleans it up): ${entry}`,
    ),
    ...others.map(
      (entry) => `FINDING C4 legacy .claude entry (report only; the user decides): ${entry}`,
    ),
  ];
});

const durableDocLines = Effect.fn("agentFirst.durableDocLines")(function* (list: Listings) {
  const docs = yield* list.tracked(
    ":(glob)**/AGENTS.md",
    ":(glob)**/SKILL.md",
    ":(glob)**/skills/**/references/*.md",
    ":(exclude,glob)**/node_modules/**/AGENTS.md",
  );
  const staleLines = yield* eachGuarded("C5", yield* list.agentsDocs(), (file) =>
    Effect.map(readText(file), (text) =>
      STALE_TOLERANCE.test(asciiLower(text ?? ""))
        ? []
        : [`FINDING C5 no stale-tolerance line: ${file}`],
    ),
  );
  const scanLines = yield* durableDocScan(docs, { findingLabel: "FINDING C5", errorLabel: "C5" });
  // A file that cannot be read gives one ERROR line, not one for each part of C5.
  return [
    ...scanLines,
    ...staleLines.filter((line) => !(line.startsWith("ERROR") && scanLines.includes(line))),
  ];
});

/**
 * The start of a skill description: the first indented line of a block scalar (`>`, `|`, `>-`, `|-`), else the value
 * after `description:` without an opening quote; null when the file has no description or no file is there.
 */
function descriptionStart(text: string | null): string | null {
  let inBlock = false;
  for (const line of textLines(text ?? "")) {
    if (DESCRIPTION_BLOCK.test(line)) inBlock = true;
    else if (inBlock && AWK_FIELD.test(line)) return line.replace(LEADING_SPACE, "");
    else if (line.startsWith("description:")) return line.replace(DESCRIPTION_VALUE, "");
  }
  return null;
}

const descriptionLines = Effect.fn("agentFirst.descriptionLines")(function* (list: Listings) {
  return yield* eachGuarded("C6", yield* list.tracked(":(glob)**/SKILL.md"), (skill) =>
    Effect.map(readText(skill), (text) =>
      descriptionStart(text)?.startsWith("Use when")
        ? []
        : [`FAIL C6 description does not start with 'Use when': ${skill}`],
    ),
  );
});

/** The bare `@path` imports of one line outside code spans, each without its `@`. */
function eagerImports(line: string): Array<string> {
  const imports: Array<string> = [];
  let rest = line.replace(CODE_SPAN, "");
  for (let match = EAGER_IMPORT.exec(rest); match !== null; match = EAGER_IMPORT.exec(rest)) {
    imports.push(match[0].replace(/^[^@]*@/u, ""));
    rest = rest.slice(match.index + match[0].length);
  }
  return imports;
}

/** Where an import points: absolute, from the home folder, or from the file's folder. */
const importTarget = Effect.fn("agentFirst.importTarget")(function* (
  importPath: string,
  file: string,
) {
  if (importPath.startsWith("/")) return importPath;
  if (importPath.startsWith("~/")) {
    const files = yield* AgentDocsFiles;
    return `${(yield* files.home) ?? ""}/${importPath.slice(2)}`;
  }
  return `${path.posix.dirname(file)}/${importPath}`;
});

const eagerImportLine = Effect.fn("agentFirst.eagerImportLine")(function* (
  file: string,
  number: number,
  importPath: string,
) {
  const target = yield* importTarget(importPath, file);
  const at = `FINDING C7 eager import ${file}:${number}: @${importPath}`;
  if (!(yield* isFile(target))) return `${at} (no file at ${target})`;
  return `${at} (${target}, ${(yield* lineCount(target)) ?? ""} lines, omp expands it when this file loads)`;
});

/** omp expands each bare `@path` in an AGENTS.md into context every time that file loads. */
const eagerImportLines = Effect.fn("agentFirst.eagerImportLines")(function* (list: Listings) {
  return yield* eachGuarded("C7", yield* list.agentsDocs(), (file) =>
    Effect.gen(function* () {
      const lines: Array<string> = [];
      for (const [number, line] of proseLines((yield* readText(file)) ?? ""))
        lines.push(
          ...(yield* eachGuarded("C7", eagerImports(line), (importPath) =>
            Effect.map(eagerImportLine(file, number, importPath), (found) => [found]),
          )),
        );
      return lines;
    }),
  );
});

const nodeSizeLines = Effect.fn("agentFirst.nodeSizeLines")(function* (list: Listings) {
  return yield* eachGuarded("C8", yield* list.agentsDocs(), (file) =>
    Effect.map(lineCount(file), (lines) =>
      lines === null || lines <= NODE_LINE_LIMIT
        ? []
        : [`FINDING C8 over the ${NODE_LINE_LIMIT}-line kit policy: ${file} (${lines} lines)`],
    ),
  );
});

/** C9 from the verify Detect lines: the skill exists, and every command of it showed its expected result. */
const verifySkillCheckLines = Effect.fn("agentFirst.verifySkillCheckLines")(function* () {
  const detect = yield* verifySkillLines();
  if (detect.lines.includes("verify skill: missing")) {
    return [
      "FINDING C9 no .agents/skills/verify/SKILL.md (add it in Step 2b, or accept: the repo has no runnable surface)",
    ];
  }
  const lines: Array<string> = [];
  for (const line of detect.lines.filter((l) => l.startsWith(VERIFY_UNVERIFIED_PREFIX))) {
    const mark = line.slice(VERIFY_UNVERIFIED_PREFIX.length);
    lines.push(
      `FAIL C9 unverified command (rerun every command in Step 2b): ${VERIFY_SKILL}:${mark}`,
    );
  }
  if (!detect.ok) lines.push(`ERROR C9 cannot read ${VERIFY_SKILL}`);
  return lines;
});

/** An error is not a missing template, so it gets its own line. */
const prTemplateCheckLines = Effect.fn("agentFirst.prTemplateCheckLines")(function* (
  repo: Repository,
) {
  const pr = yield* prTemplateLines(repo.inGit ? repo.root : null);
  if (!pr.ok) return ["ERROR C10 pull-request template check failed (see the message above)"];
  const lines = pr.lines
    .filter((line) => line.startsWith(PR_UNUSABLE_PREFIX))
    .map(
      (line) =>
        `FINDING C10 unusable pull-request template: ${line.slice(PR_UNUSABLE_PREFIX.length)}`,
    );
  if (pr.lines.some((line) => line.includes(PR_NONE_LINE))) {
    lines.push(
      "FINDING C10 no usable pull-request template (add it in Step 2c, or accept: the repository wants none)",
    );
  }
  return lines;
});

const checkLines = Effect.fn("agentFirst.checkLines")(function* (repo: Repository) {
  const list = repositoryListings(repo);
  return [
    ...(yield* guarded("C1", rootCommandLines())),
    ...(yield* guarded("C2", routingLines(list))),
    ...(yield* guarded("C3", claudeFileLines(list))),
    ...(yield* guarded("C4", legacyEntryLines())),
    ...(yield* guarded("C5", durableDocLines(list))),
    ...(yield* guarded("C6", descriptionLines(list))),
    ...(yield* guarded("C7", eagerImportLines(list))),
    ...(yield* guarded("C8", nodeSizeLines(list))),
    ...(yield* verifySkillCheckLines()),
    ...(yield* prTemplateCheckLines(repo)),
  ];
});

// --- convert-agent (the .claude cleanup of Step 2a) ---

const FRONTMATTER_FENCE = "---";
const AGENT_FIELD = /^([A-Za-z_][A-Za-z0-9_-]*):(.*)$/u;
const CONTINUATION = /^([ \t]|-[ \t]|$)/u;
// The values that leave a `name` or a `description` empty: the YAML 1.2 core-schema null forms.
const EMPTY_VALUES: ReadonlySet<string> = new Set(["", "~", "null", "Null", "NULL"]);
// The plain values that a YAML 1.2 core-schema reader reads as a boolean or a number, not as a string. Only these
// spellings count, so `tRue`, `.iNf`, and `0X1F` stay strings.
const NON_STRING_PLAIN =
  /^(true|True|TRUE|false|False|FALSE|0o[0-7]+|0x[0-9a-fA-F]+|[-+]?(\.[0-9]+|[0-9]+(\.[0-9]*)?)([eE][-+]?[0-9]+)?|[-+]?\.(inf|Inf|INF)|\.(nan|NaN|NAN))$/u;
// The start of a plain value that makes it a flow collection, an alias, a block sequence, a mapping key, or a
// reserved indicator, not a string.
const NON_STRING_START = /^([[\]{},*%@`]|[-?]([ \t]|$))/u;
// An anchor or a tag; the value may still be a string, but this command does not resolve it.
const ANCHOR_OR_TAG_START = /^[&!]/u;
// A quoted scalar is always a string.
const QUOTED_START = /^["']/u;
// A block scalar starts with `|` or `>`; its header may add an indentation indicator (1 to 9) and a chomping
// indicator (`+` or `-`) in either order, and nothing else but a comment.
const BLOCK_SCALAR_START = /^[|>]/u;
const BLOCK_SCALAR_HEADER = /^[|>]([1-9][-+]?|[-+][1-9]?)?$/u;
// omp reserves these agent names (omp://task-agent-discovery.md, agent definition shape).
const RESERVED_AGENT_NAMES: ReadonlySet<string> = new Set(["main", "sub"]);
// The setup writes `.omp/agents/<name>.md`, so a name must be one safe file name.
const SAFE_AGENT_NAME = /^[a-z0-9]+(-[a-z0-9]+)*$/u;
// The Claude agent fields that convert: the first three stay, the others are dropped, because omp would misread them
// (a Claude model alias fails in omp).
const KEPT_AGENT_FIELDS: ReadonlyArray<string> = ["name", "description", "tools"];
const DROPPED_AGENT_FIELDS: ReadonlyArray<string> = ["model", "color", "effort"];
// Each Claude Code tool that has one omp tool for the same work.
const OMP_TOOL_NAMES: ReadonlyMap<string, string> = new Map([
  ["Read", "read"],
  ["Grep", "grep"],
  ["Glob", "glob"],
  ["Bash", "bash"],
  ["Edit", "edit"],
  ["Write", "write"],
  ["WebSearch", "web_search"],
]);

/** A Claude agent that has no exact omp form; the user ports it by hand. The pure parser throws it. */
class Refusal extends Error {}

/** A refused agent. The command edge prints `ERROR convert-agent <file>: <reason>; port it by hand` and exits 2. */
export class AgentRefusal extends Schema.TaggedError<
  AgentRefusal,
  { readonly brand: unique symbol }
>()("AgentRefusal", {
  file: Schema.String,
  reason: Schema.String,
}) {}

/**
 * An agent file that cannot be read. The command edge names `detail` (the error code or message) on stderr, prints
 * `ERROR convert-agent <file>: cannot read the file`, and exits 2.
 */
export class AgentUnreadable extends Schema.TaggedError<
  AgentUnreadable,
  { readonly brand: unique symbol }
>()("AgentUnreadable", {
  file: Schema.String,
  detail: Schema.String,
}) {}

interface AgentParts {
  readonly fields: Map<string, Array<string>>;
  readonly body: string;
}

/**
 * The frontmatter fields of an agent file, each as its field line and its continuation lines (indented lines, list
 * items, and blank lines), and the body after the closing fence.
 */
function agentParts(text: string): AgentParts {
  const lines = text.replace(/\r\n/gu, "\n").split("\n");
  const close = lines.indexOf(FRONTMATTER_FENCE, 1);
  if (lines[0] !== FRONTMATTER_FENCE || close === -1) throw new Refusal("no frontmatter");
  const fields = new Map<string, Array<string>>();
  let current: Array<string> | null = null;
  for (const line of lines.slice(1, close)) {
    const field = AGENT_FIELD.exec(line);
    if (field !== null) {
      const name = field[1] ?? "";
      if (fields.has(name)) throw new Refusal(`field ${name} appears twice`);
      current = [line];
      fields.set(name, current);
    } else if (current !== null && CONTINUATION.test(line)) current.push(line);
    else if (!line.startsWith("#")) throw new Refusal(`frontmatter line "${line}" is no field`);
  }
  // A blank line between two fields belongs to neither.
  for (const fieldLines of fields.values())
    while (fieldLines.at(-1)?.trim() === "") fieldLines.pop();
  return { fields, body: lines.slice(close + 1).join("\n") };
}

/** Split a tool list at each comma outside parentheses, so `Bash(a, b)` stays one tool. */
function splitTools(text: string): Array<string> {
  const tools = [""];
  let depth = 0;
  for (const char of text) {
    if (char === "(") depth += 1;
    else if (char === ")") depth = Math.max(0, depth - 1);
    if (char === "," && depth === 0) tools.push("");
    else tools[tools.length - 1] += char;
  }
  return tools;
}

/**
 * The index of the quote that closes the quoted scalar that opens at `start`, or -1. In double quotes a `\` escapes
 * the next character; in single quotes `''` is one quote.
 */
function closingQuote(text: string, start: number): number {
  const quote = text[start];
  for (let i = start + 1; i < text.length; i += 1) {
    if (quote === '"' && text[i] === "\\") i += 1;
    else if (text[i] === quote) {
      if (quote === "'" && text[i + 1] === "'") i += 1;
      else return i;
    }
  }
  return -1;
}

/** True when a quote at `i` opens a quoted scalar: at the start, or after a space, a tab, `[`, or `,`. */
const isValueStart = (line: string, i: number): boolean =>
  i === 0 || /[ \t[,]/u.test(line[i - 1] ?? "");

/**
 * One YAML line without a trailing comment: a `#` at the start or after a space or a tab, outside quotes. A quote
 * opens a quoted scalar only where a value starts, so the apostrophe in `don't` opens none.
 */
function withoutComment(line: string): string {
  for (let i = 0; i < line.length; i += 1) {
    if (isValueStart(line, i) && (line[i] === '"' || line[i] === "'")) {
      const end = closingQuote(line, i);
      if (end === -1) break;
      i = end;
    } else if (line[i] === "#" && (i === 0 || line[i - 1] === " " || line[i - 1] === "\t")) {
      return line.slice(0, i).trimEnd();
    }
  }
  return line.trimEnd();
}

/** `text` trimmed, without one pair of outer quotes when they enclose one quoted scalar, so `"a", "b"` keeps its quotes. */
function unquoted(text: string): string {
  const trimmed = text.trim();
  const opensQuote = trimmed.startsWith('"') || trimmed.startsWith("'");
  return opensQuote && closingQuote(trimmed, 0) === trimmed.length - 1
    ? trimmed.slice(1, -1)
    : trimmed;
}

/**
 * The value part of each line of a scalar field: the text after the field name, then each continuation line, without
 * its comment and trimmed.
 */
function lineParts(fieldLines: ReadonlyArray<string>): Array<string> {
  return [(fieldLines[0] ?? "").replace(AGENT_FIELD, "$2"), ...fieldLines.slice(1)].map((line) =>
    withoutComment(line).trim(),
  );
}

/** The value of a scalar field: its parts that are not empty in one line, without one pair of outer quotes. */
function fieldValue(fieldLines: ReadonlyArray<string>): string {
  return unquoted(
    lineParts(fieldLines)
      .filter((part) => part !== "")
      .join(" "),
  );
}

/** True when a YAML 1.2 core-schema reader keeps `text`, a plain value, as a string. */
function isPlainString(text: string): boolean {
  return !NON_STRING_PLAIN.test(text) && !NON_STRING_START.test(text);
}

/**
 * True when `part`, one line of a value, has the `key:` form of a block mapping: a `:` before a space, a tab, or the
 * line end, outside a quoted scalar. A quote opens a quoted scalar only where a value starts, as in withoutComment.
 */
function hasMappingKey(part: string): boolean {
  for (let i = 0; i < part.length; i += 1) {
    if (isValueStart(part, i) && (part[i] === '"' || part[i] === "'")) {
      const end = closingQuote(part, i);
      if (end === -1) return false;
      i = end;
    } else if (
      part[i] === ":" &&
      (i === part.length - 1 || part[i + 1] === " " || part[i + 1] === "\t")
    ) {
      return true;
    }
  }
  return false;
}

/**
 * Refuse a `name` or a `description` that is empty, or that omp would not read as a string. A block scalar needs a
 * valid header and one content line that is not blank; its body keeps each `#`, because in a block scalar it is text.
 * Any other value is empty when it is a null form. An anchor or a tag is refused, as this command does not resolve
 * them. One quoted scalar is a string. A continuation line in the `key:` form makes a block mapping, and a plain value
 * must stay a string; a value that starts on a `- ` continuation line is a block sequence.
 */
function checkStringField(field: string, fieldLines: ReadonlyArray<string>): void {
  const parts = lineParts(fieldLines);
  const start = parts.findIndex((part) => part !== "");
  const first = parts[start] ?? "";
  if (BLOCK_SCALAR_START.test(first)) {
    if (!BLOCK_SCALAR_HEADER.test(first)) throw new Refusal(`${field} is no YAML string`);
    if (fieldLines.slice(start + 1).every((line) => line.trim() === ""))
      throw new Refusal(`no ${field} field`);
    return;
  }
  const value = parts.filter((part) => part !== "").join(" ");
  if (EMPTY_VALUES.has(unquoted(value))) throw new Refusal(`no ${field} field`);
  if (ANCHOR_OR_TAG_START.test(value)) throw new Refusal(`${field} uses a YAML anchor or tag`);
  if (QUOTED_START.test(value) && closingQuote(value, 0) === value.length - 1) return;
  if (parts.slice(1).some(hasMappingKey)) throw new Refusal(`${field} is no YAML string`);
  if (!QUOTED_START.test(value) && !isPlainString(value))
    throw new Refusal(`${field} is no YAML string`);
}

/**
 * The tool names of a `tools` field: a comma list, a flow list `[a, b]`, or a block list of `- a` items. A trailing
 * comment goes first, then one pair of outer quotes, of the value and of each item.
 */
function toolNames(fieldLines: ReadonlyArray<string>): Array<string> {
  const value = withoutComment((fieldLines[0] ?? "").replace(AGENT_FIELD, "$2")).trim();
  const rest = fieldLines
    .slice(1)
    .map((line) => withoutComment(line).trim())
    .filter((line) => line !== "");
  let tools: Array<string>;
  if (value === "") tools = rest.map((line) => line.replace(/^-[ \t]*/u, ""));
  else {
    const list = unquoted([value, ...rest].join(" "));
    tools = splitTools(list.startsWith("[") && list.endsWith("]") ? list.slice(1, -1) : list);
  }
  return tools.map(unquoted).filter((tool) => tool !== "");
}

/** The omp tool name of one Claude tool, or a Refusal. */
function ompToolName(tool: string): string {
  if (tool.includes("(")) throw new Refusal(`tool ${tool} has a pattern`);
  const name = OMP_TOOL_NAMES.get(tool);
  if (name === undefined) throw new Refusal(`tool ${tool} has no omp name`);
  return name;
}

interface OmpAgent {
  readonly agent: string;
  readonly dropped: ReadonlyArray<string>;
}

/**
 * The omp agent text of one Claude agent, and the names of the dropped fields. Only the simple case converts, because
 * omp adds its MCP, extension, and custom tools to every explicit tools list, and a Claude denial has no omp form.
 * Throws a Refusal for an agent that has no exact omp form.
 */
function ompAgent(text: string): OmpAgent {
  const { fields, body } = agentParts(text);
  if (fields.has("disallowedTools")) throw new Refusal("disallowedTools has no omp form");
  for (const name of fields.keys()) {
    if (!KEPT_AGENT_FIELDS.includes(name) && !DROPPED_AGENT_FIELDS.includes(name)) {
      throw new Refusal(`field ${name} has no omp form`);
    }
  }
  for (const field of ["name", "description"]) {
    const fieldLines = fields.get(field);
    if (fieldLines === undefined) throw new Refusal(`no ${field} field`);
    checkStringField(field, fieldLines);
  }
  const name = fieldValue(fields.get("name") ?? []);
  if (RESERVED_AGENT_NAMES.has(asciiLower(name)))
    throw new Refusal(`name ${name} is reserved in omp`);
  if (!SAFE_AGENT_NAME.test(name)) throw new Refusal(`name ${name} is not a safe file name`);
  const toolLines = fields.get("tools");
  const tools = toolLines === undefined ? [] : toolNames(toolLines);
  if (tools.length === 0) throw new Refusal("no tools list");
  const header = [
    FRONTMATTER_FENCE,
    // The name goes out without its quotes; a safe name that would read as a number or a boolean goes out in double
    // quotes, so that omp still reads a string.
    `name: ${isPlainString(name) ? name : JSON.stringify(name)}`,
    ...(fields.get("description") ?? []),
    `tools: ${tools.map(ompToolName).join(", ")}`,
    FRONTMATTER_FENCE,
  ];
  return {
    agent: `${header.join("\n")}\n${body}`,
    dropped: DROPPED_AGENT_FIELDS.filter((field) => fields.has(field)),
  };
}

/** Print the omp agent text of one Claude agent file on stdout; write no file. */
const convertAgent = Effect.fn("agentFirst.convertAgent")(function* (file: string) {
  const files = yield* AgentDocsFiles;
  const text = yield* files
    .readFile(file, "utf8")
    .pipe(
      Effect.catchTag("FileError", (error) =>
        Effect.fail(new AgentUnreadable({ file, detail: errorDetail(error) })),
      ),
    );
  const result = yield* Effect.try({
    try: () => ompAgent(text),
    catch: (error) =>
      new AgentRefusal({ file, reason: error instanceof Error ? error.message : String(error) }),
  });
  if (result.dropped.length > 0) {
    yield* writeStderr(
      `convert-agent: dropped ${result.dropped.join(", ")} of ${file}; omp does not read these Claude values (a Claude model alias fails in omp)\n`,
    );
  }
  yield* writeStdout(result.agent);
  return 0;
});

/**
 * Run `agent-first <args>` and return its exit status. A usage error fails with UsageError; a refused or unreadable
 * agent fails with AgentRefusal or AgentUnreadable.
 */
export const runAgentFirst = Effect.fn("agentFirst.run")(function* (args: ReadonlyArray<string>) {
  const [command, ...rest] = args;
  const [agentFile] = rest;
  if (command === "convert-agent" && rest.length === 1 && agentFile !== undefined)
    return yield* convertAgent(agentFile);
  if ((command !== "detect" && command !== "check") || rest.length > 0)
    return yield* new UsageError({ usage: USAGE });
  const files = yield* AgentDocsFiles;
  const gitRoot = yield* repositoryRoot();
  const repo: Repository = {
    root: gitRoot ?? (yield* files.workingFolder),
    inGit: gitRoot !== null,
  };
  // Every check reads paths relative to the root, as the skill runs its blocks from there.
  yield* files.changeFolder(repo.root);
  const lines =
    command === "detect" ? [repo.root, ...(yield* detectLines(repo))] : yield* checkLines(repo);
  yield* printLines(lines);
  return lines.some((line) => line.startsWith("ERROR")) ? 2 : 0;
});
