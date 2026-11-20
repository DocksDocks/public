#!/usr/bin/env node
// Detect the agent-doc state of a repository (Step 0 of agent-first-setup), run the
// agent-first check C1 to C10 (Step 3), and convert one Claude Code agent file to the omp
// form (the .claude cleanup of Step 2a). Each command reads only; none writes a file. The
// meaning of each line and the reaction to it live in the SKILL.md of agent-first-setup.
//
// Usage (from any folder inside the repository, or from the folder to check outside git):
//   node agent-first-check.mjs detect
//   node agent-first-check.mjs check
//   node agent-first-check.mjs convert-agent <path>
//
// Output lines:
//   detect  the repository root (the current folder outside git); then
//           `root AGENTS.md: present|missing`, `.agents/skills: present|missing`;
//           `legacy external: <path> -> <link target>` for each of `.claude`,
//           `.claude/skills`, and `.claude/agents` that is a symlink to a place outside the
//           repository (no line for an entry below it), `legacy skills: .claude/skills` when
//           that folder is there, one `legacy agents: <path>` line for each
//           `.claude/agents/*.md` file, one `legacy settings: <path>` line for each
//           `.claude/settings.json` and `.claude/settings.local.json`, one
//           `legacy other: .claude/<name>` line for each other `.claude/` entry; one
//           `legacy: <path>` line for each CLAUDE.md and .claude/CLAUDE.md (the root ones also
//           when git ignores them), one `personal: <path>` line for each CLAUDE.local.md, one
//           `node: <path>` line for each AGENTS.md below the root (none under node_modules),
//           one `not-a-symlink: <path>` line for each `.claude/skills` entry that is no
//           symlink; then the lines of `pr-template.mjs detect` and `verify-skill.mjs detect`.
//           A listing that fails prints `ERROR <label>: file listing failed (see the message
//           above)` in place of the lines of that label; the label of the `.claude` entries
//           is `legacy entries:`.
//   check   one `FAIL C<n> ...` (a contract break), `FINDING C<n> ...` (a risk or cleanup
//           item a human judges), or `ERROR C<n> ...` (a check that could not run) line per
//           problem, in the order C1 to C10. A failed listing gives `ERROR C<n> file listing
//           failed (see the message above)`, and a file that is there but cannot be read gives
//           `ERROR C<n> cannot read <file>`. No output means every check passed.
//   convert-agent
//           the omp agent text of the Claude agent file at <path> (relative to the current
//           folder): `name`, `description`, and `tools` with omp tool names, then the body.
//           The dropped `model`, `color`, and `effort` fields are named on stderr. An agent
//           that has no exact omp form gives one `ERROR convert-agent <path>: <reason>; port
//           it by hand` line and no agent text. A repeated field, an empty or null `name` or
//           `description` (a block scalar without content lines counts as empty), a `name` or
//           `description` that a YAML reader reads as no string (`<field> is no YAML string`:
//           a YAML 1.2 core-schema boolean or number in its exact spelling, a flow
//           collection, an alias, a block list, a block mapping, a plain value that starts
//           with `]`, `}`, `,`, or a reserved indicator, or a block scalar header that is not
//           valid), a `name` or `description` with an anchor or a tag (`<field> uses a YAML
//           anchor or tag`), a reserved `name` (`main`, `sub`), and a `name` that is no safe
//           file name (`^[a-z0-9]+(-[a-z0-9]+)*$`) have no exact omp form. A quoted name that
//           would read as no string goes out in double quotes.
//   Paths are relative to the repository root, without a leading `./`. Outside git, the
//   listings walk the folder and skip each .git, node_modules, and vendor folder.
//
// Exit status: 2 after an ERROR line (its cause is on stderr, or in the line for a refused
// agent), 1 for a usage error, otherwise 0.
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { pathToFileURL } from 'node:url';
import {
  AGENT_FIRST_PRUNE,
  agentsDocs,
  asciiLower,
  byteOrder,
  CODE_SPAN,
  claudeSkillsInRepository,
  durableDocScan,
  findEntries,
  guarded,
  isAgentsLink,
  isFile,
  isFolder,
  legacyClaudeEntries,
  legacyClaudeLines,
  listFiles,
  nestedNodes,
  proseLines,
  ROOT_CONTEXT_FILES,
  ROOT_PERSONAL_FILES,
  readFolder,
  readText,
  repositoryRoot,
  routingGaps,
  SPACE,
  textLines,
  withRootFiles,
} from './agent-docs.mjs';
import { prTemplateLines } from './pr-template.mjs';
import { verifySkillLines } from './verify-skill.mjs';

const USAGE = 'usage: agent-first-check.mjs detect | check | convert-agent <path>';
const ROOT_AGENTS = 'AGENTS.md';
const CLAUDE_SKILLS = '.claude/skills';
const VERIFY_SKILL = '.agents/skills/verify/SKILL.md';
const PR_NONE_LINE = 'pull-request template: none';
const PR_UNUSABLE_PREFIX = 'pull-request template: unusable ';
const VERIFY_UNVERIFIED_PREFIX = 'verify unverified: ';
const NODE_LINE_LIMIT = 500;
const STALE_TOLERANCE = /pointers (here )?name concepts/u;
const DESCRIPTION_BLOCK = new RegExp(`^description:[${SPACE}]*[>|][-+]?[${SPACE}]*$`, 'u');
const DESCRIPTION_VALUE = new RegExp(`^description:[${SPACE}]*["']?`, 'u');
// awk's NF counts fields split on spaces, tabs, and newlines only.
const AWK_FIELD = /[^ \t\n]/u;
const LEADING_SPACE = new RegExp(`^[${SPACE}]+`, 'u');
const EAGER_IMPORT = new RegExp(`(^|[${SPACE}(\\[])@[A-Za-z0-9._~/-]*[A-Za-z0-9_-]\\.[A-Za-z0-9]+`, 'u');

// `grep -E pattern file`: true when a line of `text` matches.
const anyLine = (text, pattern) => textLines(text).some((line) => pattern.test(line));

// `wc -l`: the number of newline bytes, or null when no file is there.
function lineCount(file) {
  const text = readText(file, 'latin1');
  return text === null ? null : text.split('\n').length - 1;
}

// The lines of `check` for each item; an item that cannot be read gives its ERROR line.
const eachGuarded = (check, items, lines) => items.flatMap((item) => guarded(check, () => lines(item)));

// The listings of one repository: the root and whether git answers for it.
function repositoryListings(repo) {
  const listing = { root: repo.root, prune: AGENT_FIRST_PRUNE, inGit: repo.inGit };
  return {
    tracked: (...pathspecs) => listFiles({ ...listing, pathspecs, excludeStandard: true }),
    // Each CLAUDE.md and .claude/CLAUDE.md; the root ones also when git ignores them, because omp loads them.
    legacy: () =>
      withRootFiles(
        listFiles({ ...listing, pathspecs: [':(glob)**/CLAUDE.md'], excludeStandard: true }),
        ROOT_CONTEXT_FILES,
      ),
    // CLAUDE.local.md is usually gitignored, so this listing keeps ignored files.
    personal: () =>
      withRootFiles(listFiles({ ...listing, pathspecs: [':(glob)**/CLAUDE.local.md'] }), ROOT_PERSONAL_FILES),
    agentsDocs: () => agentsDocs(listing),
    nodes: () => nestedNodes(listing),
    routingGaps: () => routingGaps(listing),
  };
}

// --- detect (Step 0) ---

const presence = (label, present) => `${label}: ${present ? 'present' : 'missing'}`;

function detectLines(repo) {
  const list = repositoryListings(repo);
  const pr = prTemplateLines(repo.inGit ? repo.root : null);
  return [
    presence('root AGENTS.md', isFile(ROOT_AGENTS)),
    presence('.agents/skills', isFolder('.agents/skills')),
    ...guarded('legacy entries:', legacyClaudeLines),
    ...guarded('legacy:', () => list.legacy().map((file) => `legacy: ${file}`)),
    ...guarded('personal:', () => list.personal().map((file) => `personal: ${file}`)),
    ...guarded('node:', () => list.nodes().map((node) => `node: ${node}`)),
    ...guarded('not-a-symlink:', () =>
      claudeSkillsInRepository()
        ? findEntries(CLAUDE_SKILLS)
            .filter((entry) => !entry.isSymbolicLink())
            .map((entry) => `not-a-symlink: ${CLAUDE_SKILLS}/${entry.name}`)
        : [],
    ),
    // The shell wrapper dropped the lines found before a failure and printed only its ERROR line.
    ...(pr.ok ? pr.lines : ['ERROR pull-request template check failed (see the message above)']),
    ...verifySkillLines().lines,
  ];
}

// --- check (Step 3) ---

function rootCommandLines() {
  if (!isFile(ROOT_AGENTS)) return ['FAIL C1 root AGENTS.md missing'];
  const text = asciiLower(readText(ROOT_AGENTS) ?? '');
  // `grep -qiw <kind>`: the kind as a whole word, in any ASCII letter case.
  const names = (kind) => anyLine(text, new RegExp(`(^|[^a-z0-9_])${kind}([^a-z0-9_]|$)`, 'u'));
  return ['build', 'test', 'lint']
    .filter((kind) => !names(kind))
    .map(
      (kind) =>
        `FINDING C1 root AGENTS.md names no ${kind} command (add it, or accept: the repo has none or one gate covers it)`,
    );
}

function routingLines(list) {
  const { unroutedNodes, deadRoutes } = list.routingGaps();
  return [
    ...unroutedNodes.map((node) => `FAIL C2 node not routed from root: ${node}`),
    ...deadRoutes.map((route) => `FAIL C2 dead route in root table: ${route}`),
  ];
}

const MIGRATE = 'migrate it with claude-md-migration';

// The C3 line for one CLAUDE.md, .claude/CLAUDE.md, or CLAUDE.local.md, as omp loads it: a
// link to the AGENTS.md of its folder holds no text to migrate, a .claude/CLAUDE.md wins over
// the AGENTS.md of the folder where a session starts, a CLAUDE.md next to an AGENTS.md is
// ignored, a CLAUDE.md alone at its depth loads, and omp does not load a CLAUDE.local.md.
function claudeFileLine(file) {
  const folder = path.posix.dirname(file);
  if (path.posix.basename(file) === 'CLAUDE.local.md') {
    return `FINDING C3 CLAUDE.local.md that omp does not load (personal file; the user decides: list it in contextFiles.extra, move it to ~/.omp/agent/AGENTS.md, or keep it): ${file}`;
  }
  if (isAgentsLink(file)) {
    return `FAIL C3 CLAUDE.md link to AGENTS.md (remove the link; there is nothing to migrate): ${file}`;
  }
  if (path.posix.basename(folder) === '.claude') {
    return `FAIL C3 .claude/CLAUDE.md (omp loads it instead of the AGENTS.md of that folder when a session starts there; ${MIGRATE}): ${file}`;
  }
  if (isFile(folder === '.' ? ROOT_AGENTS : `${folder}/${ROOT_AGENTS}`)) {
    return `FAIL C3 CLAUDE.md next to an AGENTS.md (omp ignores it; ${MIGRATE}): ${file}`;
  }
  return `FINDING C3 CLAUDE.md without an AGENTS.md next to it (it loads, but AGENTS.md is the convention; ${MIGRATE}): ${file}`;
}

function claudeFileLines(list) {
  const files = new Set([...list.legacy(), ...list.personal()]);
  return eachGuarded('C3', [...files].sort(byteOrder), (file) => [claudeFileLine(file)]);
}

// The names that `.claude/skills/*` expands to: no dot names, in byte order, through a
// symlinked `.claude/skills` too.
function skillGlobNames() {
  return readFolder(CLAUDE_SKILLS)
    .map((entry) => entry.name)
    .filter((name) => !name.startsWith('.'))
    .sort(byteOrder);
}

// C4: each `.claude/skills` entry, each Claude agent file, and each Claude settings file is a
// legacy entry that the cleanup of agent-first-setup handles. A `.claude` link to a place
// outside the repository and each other `.claude/` entry are only reported.
function legacyEntryLines() {
  const { external, skills, agents, settings, others } = legacyClaudeEntries();
  const skillEntries = skills === null ? [] : skillGlobNames().map((name) => `${CLAUDE_SKILLS}/${name}`);
  return [
    ...external.map(
      (link) =>
        `FINDING C4 legacy .claude entry outside the repository (report it; never move or remove it): ${link.path}`,
    ),
    ...[...skillEntries, ...agents, ...settings].map(
      (entry) => `FINDING C4 legacy .claude entry (agent-first-setup cleans it up): ${entry}`,
    ),
    ...others.map((entry) => `FINDING C4 legacy .claude entry (report only; the user decides): ${entry}`),
  ];
}

function durableDocLines(list) {
  const docs = list.tracked(
    ':(glob)**/AGENTS.md',
    ':(glob)**/SKILL.md',
    ':(glob)**/skills/**/references/*.md',
    ':(exclude,glob)**/node_modules/**/AGENTS.md',
  );
  const staleLines = eachGuarded('C5', list.agentsDocs(), (file) =>
    STALE_TOLERANCE.test(asciiLower(readText(file) ?? '')) ? [] : [`FINDING C5 no stale-tolerance line: ${file}`],
  );
  const scanLines = durableDocScan(docs, { findingLabel: 'FINDING C5', errorLabel: 'C5' });
  // A file that cannot be read gives one ERROR line, not one for each part of C5.
  return [...scanLines, ...staleLines.filter((line) => !(line.startsWith('ERROR') && scanLines.includes(line)))];
}

// The start of a skill description: the first indented line of a block scalar (`>`, `|`,
// `>-`, `|-`), else the value after `description:` without an opening quote; null when the
// file has no description or no file is there.
function descriptionStart(text) {
  let inBlock = false;
  for (const line of textLines(text ?? '')) {
    if (DESCRIPTION_BLOCK.test(line)) inBlock = true;
    else if (inBlock && AWK_FIELD.test(line)) return line.replace(LEADING_SPACE, '');
    else if (line.startsWith('description:')) return line.replace(DESCRIPTION_VALUE, '');
  }
  return null;
}

function descriptionLines(list) {
  return eachGuarded('C6', list.tracked(':(glob)**/SKILL.md'), (skill) =>
    descriptionStart(readText(skill))?.startsWith('Use when')
      ? []
      : [`FAIL C6 description does not start with 'Use when': ${skill}`],
  );
}

// The bare `@path` imports of one line outside code spans, each without its `@`.
function eagerImports(line) {
  const imports = [];
  let rest = line.replace(CODE_SPAN, '');
  for (let match = EAGER_IMPORT.exec(rest); match !== null; match = EAGER_IMPORT.exec(rest)) {
    imports.push(match[0].replace(/^[^@]*@/u, ''));
    rest = rest.slice(match.index + match[0].length);
  }
  return imports;
}

// Where an import points: absolute, from the home folder, or from the file's folder.
function importTarget(importPath, file) {
  if (importPath.startsWith('/')) return importPath;
  if (importPath.startsWith('~/')) return `${process.env.HOME ?? ''}/${importPath.slice(2)}`;
  return `${path.posix.dirname(file)}/${importPath}`;
}

function eagerImportLine(file, number, importPath) {
  const target = importTarget(importPath, file);
  const at = `FINDING C7 eager import ${file}:${number}: @${importPath}`;
  if (!isFile(target)) return `${at} (no file at ${target})`;
  return `${at} (${target}, ${lineCount(target) ?? ''} lines, omp expands it when this file loads)`;
}

// omp expands each bare `@path` in an AGENTS.md into context every time that file loads.
function eagerImportLines(list) {
  return eachGuarded('C7', list.agentsDocs(), (file) =>
    proseLines(readText(file) ?? '').flatMap(([number, line]) =>
      eachGuarded('C7', eagerImports(line), (importPath) => [eagerImportLine(file, number, importPath)]),
    ),
  );
}

function nodeSizeLines(list) {
  return eachGuarded('C8', list.agentsDocs(), (file) => {
    const lines = lineCount(file);
    if (lines === null || lines <= NODE_LINE_LIMIT) return [];
    return [`FINDING C8 over the ${NODE_LINE_LIMIT}-line kit policy: ${file} (${lines} lines)`];
  });
}

// C9 from the verify Detect lines: the skill exists, and every command of it showed its
// expected result.
function verifySkillCheckLines() {
  const detect = verifySkillLines();
  if (detect.lines.includes('verify skill: missing')) {
    return [
      'FINDING C9 no .agents/skills/verify/SKILL.md (add it in Step 2b, or accept: the repo has no runnable surface)',
    ];
  }
  const lines = [];
  for (const line of detect.lines.filter((l) => l.startsWith(VERIFY_UNVERIFIED_PREFIX))) {
    const mark = line.slice(VERIFY_UNVERIFIED_PREFIX.length);
    lines.push(`FAIL C9 unverified command (rerun every command in Step 2b): ${VERIFY_SKILL}:${mark}`);
  }
  if (!detect.ok) lines.push(`ERROR C9 cannot read ${VERIFY_SKILL}`);
  return lines;
}

// An error is not a missing template, so it gets its own line.
function prTemplateCheckLines(repo) {
  const pr = prTemplateLines(repo.inGit ? repo.root : null);
  if (!pr.ok) return ['ERROR C10 pull-request template check failed (see the message above)'];
  const lines = pr.lines
    .filter((line) => line.startsWith(PR_UNUSABLE_PREFIX))
    .map((line) => `FINDING C10 unusable pull-request template: ${line.slice(PR_UNUSABLE_PREFIX.length)}`);
  if (pr.lines.some((line) => line.includes(PR_NONE_LINE))) {
    lines.push('FINDING C10 no usable pull-request template (add it in Step 2c, or accept: the repository wants none)');
  }
  return lines;
}

function checkLines(repo) {
  const list = repositoryListings(repo);
  return [
    ...guarded('C1', rootCommandLines),
    ...guarded('C2', () => routingLines(list)),
    ...guarded('C3', () => claudeFileLines(list)),
    ...guarded('C4', legacyEntryLines),
    ...guarded('C5', () => durableDocLines(list)),
    ...guarded('C6', () => descriptionLines(list)),
    ...guarded('C7', () => eagerImportLines(list)),
    ...guarded('C8', () => nodeSizeLines(list)),
    ...verifySkillCheckLines(),
    ...prTemplateCheckLines(repo),
  ];
}

// --- convert-agent (the .claude cleanup of Step 2a) ---

const FRONTMATTER_FENCE = '---';
const AGENT_FIELD = /^([A-Za-z_][A-Za-z0-9_-]*):(.*)$/u;
const CONTINUATION = /^([ \t]|-[ \t]|$)/u;
// The values that leave a `name` or a `description` empty: the YAML 1.2 core-schema null forms.
const EMPTY_VALUES = new Set(['', '~', 'null', 'Null', 'NULL']);
// The plain values that a YAML 1.2 core-schema reader reads as a boolean or a number, not as a
// string. Only these spellings count, so `tRue`, `.iNf`, and `0X1F` stay strings.
const NON_STRING_PLAIN =
  /^(true|True|TRUE|false|False|FALSE|0o[0-7]+|0x[0-9a-fA-F]+|[-+]?(\.[0-9]+|[0-9]+(\.[0-9]*)?)([eE][-+]?[0-9]+)?|[-+]?\.(inf|Inf|INF)|\.(nan|NaN|NAN))$/u;
// The start of a plain value that makes it a flow collection, an alias, a block sequence, a
// mapping key, or a reserved indicator, not a string.
const NON_STRING_START = /^([[\]{},*%@`]|[-?]([ \t]|$))/u;
// An anchor or a tag; the value may still be a string, but this script does not resolve it.
const ANCHOR_OR_TAG_START = /^[&!]/u;
// A quoted scalar is always a string.
const QUOTED_START = /^["']/u;
// A block scalar starts with `|` or `>`; its header may add an indentation indicator (1 to 9)
// and a chomping indicator (`+` or `-`) in either order, and nothing else but a comment.
const BLOCK_SCALAR_START = /^[|>]/u;
const BLOCK_SCALAR_HEADER = /^[|>]([1-9][-+]?|[-+][1-9]?)?$/u;
// omp reserves these agent names (omp://task-agent-discovery.md, agent definition shape).
const RESERVED_AGENT_NAMES = new Set(['main', 'sub']);
// The setup writes `.omp/agents/<name>.md`, so a name must be one safe file name.
const SAFE_AGENT_NAME = /^[a-z0-9]+(-[a-z0-9]+)*$/u;
// The Claude agent fields that convert: the first three stay, the others are dropped, because
// omp would misread them (a Claude model alias fails in omp).
const KEPT_AGENT_FIELDS = ['name', 'description', 'tools'];
const DROPPED_AGENT_FIELDS = ['model', 'color', 'effort'];
// Each Claude Code tool that has one omp tool for the same work.
const OMP_TOOL_NAMES = new Map([
  ['Read', 'read'],
  ['Grep', 'grep'],
  ['Glob', 'glob'],
  ['Bash', 'bash'],
  ['Edit', 'edit'],
  ['Write', 'write'],
  ['WebSearch', 'web_search'],
]);

// A Claude agent that has no exact omp form; the user ports it by hand.
class Refusal extends Error {}

// The frontmatter fields of an agent file, each as its field line and its continuation lines
// (indented lines, list items, and blank lines), and the body after the closing fence.
function agentParts(text) {
  const lines = text.replace(/\r\n/gu, '\n').split('\n');
  const close = lines.indexOf(FRONTMATTER_FENCE, 1);
  if (lines[0] !== FRONTMATTER_FENCE || close === -1) throw new Refusal('no frontmatter');
  const fields = new Map();
  let current = null;
  for (const line of lines.slice(1, close)) {
    const field = AGENT_FIELD.exec(line);
    if (field !== null) {
      if (fields.has(field[1])) throw new Refusal(`field ${field[1]} appears twice`);
      current = [line];
      fields.set(field[1], current);
    } else if (current !== null && CONTINUATION.test(line)) current.push(line);
    else if (!line.startsWith('#')) throw new Refusal(`frontmatter line "${line}" is no field`);
  }
  // A blank line between two fields belongs to neither.
  for (const fieldLines of fields.values()) while (fieldLines.at(-1)?.trim() === '') fieldLines.pop();
  return { fields, body: lines.slice(close + 1).join('\n') };
}

// Split a tool list at each comma outside parentheses, so `Bash(a, b)` stays one tool.
function splitTools(text) {
  const tools = [''];
  let depth = 0;
  for (const char of text) {
    if (char === '(') depth += 1;
    else if (char === ')') depth = Math.max(0, depth - 1);
    if (char === ',' && depth === 0) tools.push('');
    else tools[tools.length - 1] += char;
  }
  return tools;
}

// The index of the quote that closes the quoted scalar that opens at `start`, or -1. In double
// quotes a `\` escapes the next character; in single quotes `''` is one quote.
function closingQuote(text, start) {
  const quote = text[start];
  for (let i = start + 1; i < text.length; i += 1) {
    if (quote === '"' && text[i] === '\\') i += 1;
    else if (text[i] === quote) {
      if (quote === "'" && text[i + 1] === "'") i += 1;
      else return i;
    }
  }
  return -1;
}

// One YAML line without a trailing comment: a `#` at the start or after a space or a tab,
// outside quotes. A quote opens a quoted scalar only where a value starts (at the start, or
// after a space, a tab, `[`, or `,`), so the apostrophe in `don't` opens none.
function withoutComment(line) {
  for (let i = 0; i < line.length; i += 1) {
    const valueStart = i === 0 || /[ \t[,]/u.test(line[i - 1]);
    if (valueStart && (line[i] === '"' || line[i] === "'")) {
      const end = closingQuote(line, i);
      if (end === -1) break;
      i = end;
    } else if (line[i] === '#' && (i === 0 || line[i - 1] === ' ' || line[i - 1] === '\t')) {
      return line.slice(0, i).trimEnd();
    }
  }
  return line.trimEnd();
}

// `text` trimmed, without one pair of outer quotes when they enclose one quoted scalar, so
// `"a", "b"` keeps its quotes.
function unquoted(text) {
  const trimmed = text.trim();
  const opensQuote = trimmed.startsWith('"') || trimmed.startsWith("'");
  return opensQuote && closingQuote(trimmed, 0) === trimmed.length - 1 ? trimmed.slice(1, -1) : trimmed;
}

// The value part of each line of a scalar field: the text after the field name, then each
// continuation line, without its comment and trimmed.
function lineParts(fieldLines) {
  return [fieldLines[0].replace(AGENT_FIELD, '$2'), ...fieldLines.slice(1)].map((line) => withoutComment(line).trim());
}

// The parts of a scalar field: its line parts that are not empty.
function fieldParts(fieldLines) {
  return lineParts(fieldLines).filter((part) => part !== '');
}

// The value of a scalar field: its parts in one line, without one pair of outer quotes.
function fieldValue(fieldLines) {
  return unquoted(fieldParts(fieldLines).join(' '));
}

// True when a YAML 1.2 core-schema reader keeps `text`, a plain value, as a string.
function isPlainString(text) {
  return !NON_STRING_PLAIN.test(text) && !NON_STRING_START.test(text);
}

// True when `part`, one line of a value, has the `key:` form of a block mapping: a `:` before a
// space, a tab, or the line end, outside a quoted scalar. A quote opens a quoted scalar only
// where a value starts, as in withoutComment.
function hasMappingKey(part) {
  for (let i = 0; i < part.length; i += 1) {
    const valueStart = i === 0 || /[ \t[,]/u.test(part[i - 1]);
    if (valueStart && (part[i] === '"' || part[i] === "'")) {
      const end = closingQuote(part, i);
      if (end === -1) return false;
      i = end;
    } else if (part[i] === ':' && (i === part.length - 1 || part[i + 1] === ' ' || part[i + 1] === '\t')) {
      return true;
    }
  }
  return false;
}

// Refuse a `name` or a `description` that is empty, or that omp would not read as a string.
// A block scalar needs a valid header and one content line that is not blank; its body keeps
// each `#`, because in a block scalar it is text. Any other value is empty when it is a null
// form. An anchor or a tag is refused, as this script does not resolve them. One quoted
// scalar is a string. A continuation line in the `key:` form makes a block mapping, and a
// plain value must stay a string; a value that starts on a `- ` continuation line is a block
// sequence.
function checkStringField(field, fieldLines) {
  const parts = lineParts(fieldLines);
  const start = parts.findIndex((part) => part !== '');
  const first = parts[start] ?? '';
  if (BLOCK_SCALAR_START.test(first)) {
    if (!BLOCK_SCALAR_HEADER.test(first)) throw new Refusal(`${field} is no YAML string`);
    if (fieldLines.slice(start + 1).every((line) => line.trim() === '')) throw new Refusal(`no ${field} field`);
    return;
  }
  const value = parts.filter((part) => part !== '').join(' ');
  if (EMPTY_VALUES.has(unquoted(value))) throw new Refusal(`no ${field} field`);
  if (ANCHOR_OR_TAG_START.test(value)) throw new Refusal(`${field} uses a YAML anchor or tag`);
  if (QUOTED_START.test(value) && closingQuote(value, 0) === value.length - 1) return;
  if (parts.slice(1).some(hasMappingKey)) throw new Refusal(`${field} is no YAML string`);
  if (!QUOTED_START.test(value) && !isPlainString(value)) throw new Refusal(`${field} is no YAML string`);
}

// The tool names of a `tools` field: a comma list, a flow list `[a, b]`, or a block list of
// `- a` items. A trailing comment goes first, then one pair of outer quotes, of the value and
// of each item.
function toolNames(fieldLines) {
  const value = withoutComment(fieldLines[0].replace(AGENT_FIELD, '$2')).trim();
  const rest = fieldLines
    .slice(1)
    .map((line) => withoutComment(line).trim())
    .filter((line) => line !== '');
  let tools;
  if (value === '') tools = rest.map((line) => line.replace(/^-[ \t]*/u, ''));
  else {
    const list = unquoted([value, ...rest].join(' '));
    tools = splitTools(list.startsWith('[') && list.endsWith(']') ? list.slice(1, -1) : list);
  }
  return tools.map(unquoted).filter((tool) => tool !== '');
}

// The omp tool name of one Claude tool, or a Refusal.
function ompToolName(tool) {
  if (tool.includes('(')) throw new Refusal(`tool ${tool} has a pattern`);
  const name = OMP_TOOL_NAMES.get(tool);
  if (name === undefined) throw new Refusal(`tool ${tool} has no omp name`);
  return name;
}

// The omp agent text of one Claude agent, and the names of the dropped fields. Only the
// simple case converts, because omp adds its MCP, extension, and custom tools to every
// explicit tools list, and a Claude denial has no omp form.
function ompAgent(text) {
  const { fields, body } = agentParts(text);
  if (fields.has('disallowedTools')) throw new Refusal('disallowedTools has no omp form');
  for (const name of fields.keys()) {
    if (!KEPT_AGENT_FIELDS.includes(name) && !DROPPED_AGENT_FIELDS.includes(name)) {
      throw new Refusal(`field ${name} has no omp form`);
    }
  }
  for (const field of ['name', 'description']) {
    if (!fields.has(field)) throw new Refusal(`no ${field} field`);
    checkStringField(field, fields.get(field));
  }
  const name = fieldValue(fields.get('name'));
  if (RESERVED_AGENT_NAMES.has(asciiLower(name))) throw new Refusal(`name ${name} is reserved in omp`);
  if (!SAFE_AGENT_NAME.test(name)) throw new Refusal(`name ${name} is not a safe file name`);
  const tools = fields.has('tools') ? toolNames(fields.get('tools')) : [];
  if (tools.length === 0) throw new Refusal('no tools list');
  const header = [
    FRONTMATTER_FENCE,
    // The name goes out without its quotes; a safe name that would read as a number or a
    // boolean goes out in double quotes, so that omp still reads a string.
    `name: ${isPlainString(name) ? name : JSON.stringify(name)}`,
    ...fields.get('description'),
    `tools: ${tools.map(ompToolName).join(', ')}`,
    FRONTMATTER_FENCE,
  ];
  return { agent: `${header.join('\n')}\n${body}`, dropped: DROPPED_AGENT_FIELDS.filter((field) => fields.has(field)) };
}

// Print the omp agent text of one Claude agent file on stdout; write no file.
function convertAgent(file) {
  const errorLine = (reason) => {
    process.stdout.write(`ERROR convert-agent ${file}: ${reason}\n`);
    return 2;
  };
  let text;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch (error) {
    process.stderr.write(`agent-first-check: cannot read ${file} (${error.code ?? error.message})\n`);
    return errorLine('cannot read the file');
  }
  let result;
  try {
    result = ompAgent(text);
  } catch (error) {
    if (!(error instanceof Refusal)) throw error;
    return errorLine(`${error.message}; port it by hand`);
  }
  if (result.dropped.length > 0) {
    process.stderr.write(
      `convert-agent: dropped ${result.dropped.join(', ')} of ${file}; omp does not read these Claude values (a Claude model alias fails in omp)\n`,
    );
  }
  process.stdout.write(result.agent);
  return 0;
}

function main(args) {
  const [command, ...rest] = args;
  if (command === 'convert-agent' && rest.length === 1) return convertAgent(rest[0]);
  if (!['detect', 'check'].includes(command) || rest.length > 0) {
    process.stderr.write(`${USAGE}\n`);
    return 1;
  }
  const gitRoot = repositoryRoot();
  const repo = { root: gitRoot ?? process.cwd(), inGit: gitRoot !== null };
  // Every check reads paths relative to the root, as the skill runs its blocks from there.
  process.chdir(repo.root);
  const lines = command === 'detect' ? [repo.root, ...detectLines(repo)] : checkLines(repo);
  if (lines.length > 0) process.stdout.write(`${lines.join('\n')}\n`);
  return lines.some((line) => line.startsWith('ERROR')) ? 2 : 0;
}

// Run the CLI only when node started this file (through any symlink), not on import.
if (process.argv[1] && import.meta.url === pathToFileURL(fs.realpathSync(process.argv[1])).href) {
  process.exitCode = main(process.argv.slice(2));
}
