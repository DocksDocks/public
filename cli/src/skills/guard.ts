/**
 * The portable SKILL.md validator of `docks-kit skill guard`, ported from the former skill-guard script of
 * write-skill: the frontmatter and structure rules, pure over the file text, and the walk that finds each SKILL.md
 * below a skills root.
 * The kit-only rules (report section, shared copies, transform guard, score floors) live in `kitGate.ts`.
 */
import { basename, join } from "node:path";

import { Effect } from "effect";

import { SkillFiles } from "./files";
import {
  ageDays,
  anyLine,
  bodyAfterFrontmatter,
  dateSeconds,
  FRESH_DAYS,
  metadataUpdated,
  slopCount,
  upstreamCount,
} from "./rubric";

const MAX_NAME_LENGTH = 64;
const MAX_DESCRIPTION_LENGTH = 1024;
const LISTING_DESCRIPTION_LENGTH = 500;
const MAX_BODY_LINES = 500;
const MIN_TARGET_BODY_LINES = 80;
const MAX_TARGET_BODY_LINES = 310;

/** One validator message: a failure, or a warning that `--strict` turns into a failure. */
export interface Finding {
  readonly level: "fail" | "warn";
  readonly message: string;
}

const fail = (message: string): Finding => ({ level: "fail", message });
const warn = (message: string): Finding => ({ level: "warn", message });

// ---- the description value as a YAML parser reads it ----

const indentOf = (line: string): number => /^ */.exec(line)?.[0].length ?? 0;

const DOUBLE_QUOTE_ESCAPES: Readonly<Record<string, string>> = {
  "0": "\0",
  a: "\x07",
  b: "\b",
  t: "\t",
  "\t": "\t",
  n: "\n",
  v: "\v",
  f: "\f",
  r: "\r",
  e: "\x1b",
  " ": " ",
  '"': '"',
  "/": "/",
  "\\": "\\",
  N: "\x85",
  _: "\xa0",
  L: "\u2028",
  P: "\u2029",
};

/** True when the text ends with an odd run of backslashes, so its last one escapes the line break. */
const endsEscaped = (text: string): boolean => /(^|[^\\])(\\\\)*\\$/.test(text);

function unescapeDouble(text: string): string {
  return text.replace(
    /\\(x[0-9A-Fa-f]{2}|u[0-9A-Fa-f]{4}|U[0-9A-Fa-f]{8}|.)/g,
    (match, escape: string) => {
      if (escape.length === 1) return DOUBLE_QUOTE_ESCAPES[escape] ?? match;
      const codePoint = Number.parseInt(escape.slice(1), 16);
      return codePoint <= 0x10ffff ? String.fromCodePoint(codePoint) : match;
    },
  );
}

/** The lines between the frontmatter fences (to the end when the closing fence is missing). */
function frontmatterLines(lines: ReadonlyArray<string>): ReadonlyArray<string> {
  const start = lines[0] === "---" ? 1 : 0;
  const end = lines.indexOf("---", start);
  return lines.slice(start, end === -1 ? undefined : end);
}

/**
 * `|` keeps line breaks, `>` folds them to spaces except around empty and more-indented lines; the content indentation
 * (indicator or first text line) is stripped; chomping `-` drops the final line break, clip keeps one, `+` keeps it and
 * the trailing empty lines.
 */
function blockScalar(
  folded: boolean,
  indicator: string | undefined,
  chomp: string | undefined,
  rest: ReadonlyArray<string>,
): string {
  const first = rest.find((line) => line.trim() !== "");
  const indent = indicator ? Number(indicator) : first === undefined ? 0 : indentOf(first);
  const body: Array<string> = [];
  for (const line of rest) {
    if (line.trim() === "") body.push("");
    else if (indent > 0 && indentOf(line) >= indent) body.push(line.slice(indent));
    else break;
  }
  let end = body.length;
  while (end > 0 && body[end - 1] === "") end -= 1;
  const trailing = body.length - end;
  let text = "";
  let previous: string | null = null;
  let empties = 0;
  for (const line of body.slice(0, end)) {
    if (line === "") {
      empties += 1;
      continue;
    }
    if (previous === null) text = "\n".repeat(empties) + line;
    else if (!folded || /^[ \t]/.test(previous) || /^[ \t]/.test(line)) {
      text += "\n".repeat(empties + 1) + line;
    } else text += (empties === 0 ? " " : "\n".repeat(empties)) + line;
    previous = line;
    empties = 0;
  }
  if (previous === null) return chomp === "+" ? "\n".repeat(trailing) : "";
  if (chomp === "-") return text;
  return chomp === "+" ? `${text}\n${"\n".repeat(trailing)}` : `${text}\n`;
}

interface QuotedPart {
  readonly text: string;
  readonly joined: boolean;
}

/**
 * A quoted value up to its closing quote: a line break folds to a space, empty lines become line breaks, and the space
 * around a break is dropped; `"` reads escapes (`\` at the end of a line joins the next line), `'` reads `''` as one
 * quote.
 */
function quotedScalar(head: string, rest: ReadonlyArray<string>): string {
  const quote = head[0];
  const raw: Array<string> = [];
  for (const [index, line] of [head.slice(1), ...rest].entries()) {
    if (index > 0 && line.trim() !== "" && indentOf(line) === 0) break;
    let close = -1;
    for (let column = 0; column < line.length && close === -1; column += 1) {
      if (quote === '"' && line[column] === "\\") column += 1;
      else if (line[column] === quote && quote === "'" && line[column + 1] === "'") column += 1;
      else if (line[column] === quote) close = column;
    }
    raw.push(close === -1 ? line : line.slice(0, close));
    if (close !== -1) break;
  }
  const decode =
    quote === '"' ? unescapeDouble : (text: string): string => text.replaceAll("''", "'");
  const parts = raw.map((line, index): QuotedPart => {
    let text = index === 0 ? line : line.replace(/^[ \t]+/, "");
    if (index === raw.length - 1) return { text, joined: false };
    if (quote === '"' && endsEscaped(text)) return { text: text.slice(0, -1), joined: true };
    const trimmed = text.replace(/[ \t]+$/, "");
    text = quote === '"' && endsEscaped(trimmed) ? text.slice(0, trimmed.length + 1) : trimmed;
    return { text, joined: false };
  });
  const [first, ...later] = parts;
  if (first === undefined) return "";
  let value = decode(first.text);
  let previous = first;
  let empties = 0;
  for (const [offset, part] of later.entries()) {
    if (part.text === "" && offset + 1 < later.length) {
      empties += 1;
      continue;
    }
    value += (previous.joined || empties > 0 ? "" : " ") + "\n".repeat(empties) + decode(part.text);
    previous = part;
    empties = 0;
  }
  return value;
}

interface Description {
  readonly value: string;
  /** True when a plain value holds a ` #` comment. */
  readonly comment: boolean;
  /** True when the value starts with a YAML alias (`*`), anchor (`&`), or tag (`!`), which this reader does not resolve. */
  readonly node: boolean;
}

/** A plain value: it ends at a ` #` comment or a less-indented line; lines fold as in quotes. */
function plainScalar(head: string, rest: ReadonlyArray<string>): Omit<Description, "node"> {
  const texts: Array<string> = [];
  let comment = false;
  for (const [index, line] of [head, ...rest].entries()) {
    if (index > 0 && line.trim() !== "" && indentOf(line) === 0) break;
    const hash = /(^|[ \t])#/.exec(line);
    texts.push((hash ? line.slice(0, hash.index) : line).trim());
    if (hash) {
      comment = true;
      break;
    }
  }
  let value = "";
  let empties = 0;
  for (const text of texts) {
    if (text === "") {
      empties += 1;
      continue;
    }
    value += value === "" ? text : (empties === 0 ? " " : "\n".repeat(empties)) + text;
    empties = 0;
  }
  return { value, comment };
}

/** The top-level description value of the frontmatter. */
function readDescription(lines: ReadonlyArray<string>): Description {
  const frontmatter = frontmatterLines(lines);
  const at = frontmatter.findIndex((line) => /^description:/.test(line));
  const line = frontmatter[at];
  if (line === undefined) return { value: "", comment: false, node: false };
  const head = line.slice("description:".length).trim();
  const rest = frontmatter.slice(at + 1);
  const block = /^([|>])(?:([1-9])([+-])?|([+-])([1-9])?)?(?:[ \t]+#.*)?$/.exec(head);
  if (block) {
    const value = blockScalar(block[1] === ">", block[2] || block[5], block[3] || block[4], rest);
    return { value, comment: false, node: false };
  }
  if (head.startsWith('"') || head.startsWith("'")) {
    return { value: quotedScalar(head, rest), comment: false, node: false };
  }
  const plain = plainScalar(head, rest);
  return { ...plain, node: /^[*&!]/.test(plain.value) };
}

// ---- the rules ----

/**
 * The findings of one SKILL.md before its `references/` check: the frontmatter fence, the name, the description,
 * `user-invocable`, `metadata.updated`, and the body length. `dir` is the skill folder as the command prints it.
 */
export function frontFindings(
  dir: string,
  lines: ReadonlyArray<string>,
  nowMillis: number,
): Array<Finding> {
  const findings: Array<Finding> = [];
  if (lines[0] !== "---")
    findings.push(fail("SKILL.md must start with YAML frontmatter fence ---"));
  else if (!lines.slice(1).some((line) => line === "---")) {
    findings.push(fail("frontmatter fence is not closed"));
  }

  const folder = basename(dir);
  const name =
    (lines.find((line) => /^name:/.test(line)) ?? "")
      .replace(/^name:\s*/, "")
      .replace(/^["']|["']$/g, "") || folder;
  const nameLength = [...name].length;
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(name)) {
    findings.push(fail(`name '${name}' must be lowercase hyphen-case`));
  }
  if (nameLength > MAX_NAME_LENGTH) findings.push(fail(`name exceeds 64 chars (${nameLength})`));
  if (name !== folder) findings.push(fail(`name '${name}' must match directory '${folder}'`));

  const description = readDescription(lines);
  const vendored = upstreamCount(lines) > 0;
  if (description.node) {
    findings.push(
      fail(
        "description must be a plain, quoted, or block scalar string (no YAML alias, anchor, or tag)",
      ),
    );
  } else if (description.value === "") findings.push(fail("description must be non-empty"));
  else {
    const length = [...description.value].length;
    if (length > MAX_DESCRIPTION_LENGTH) {
      findings.push(fail(`description exceeds 1024 chars (${length})`));
    }
    if (description.comment) {
      findings.push(
        fail(
          "unquoted description contains '#' — quote it (YAML reads ' #' as the start of a comment)",
        ),
      );
    }
    if (length > LISTING_DESCRIPTION_LENGTH) {
      findings.push(
        warn(`description is ${length} chars (>500 crowds the aggregate listing budget)`),
      );
    }
    if (vendored) {
      if (!/use when/i.test(description.value)) {
        findings.push(warn("description should contain 'Use when'"));
      }
    } else if (!/^use when/i.test(description.value)) {
      findings.push(warn("description should start with 'Use when'"));
    }
  }
  if (!anyLine(lines, /^user-invocable:\s*(true|false)/)) {
    findings.push(warn("frontmatter 'user-invocable' missing"));
  }
  const updated = metadataUpdated(lines);
  if (updated === "") {
    if (!vendored) findings.push(warn("metadata.updated missing (YYYY-MM-DD)"));
  } else {
    const seconds = dateSeconds(updated);
    if (seconds > 0) {
      const age = ageDays(Math.floor(nowMillis / 1000), seconds);
      if (age > FRESH_DAYS)
        findings.push(warn(`metadata.updated is ${age}d old (>180d reads stale)`));
    }
  }

  const bodyLines = bodyAfterFrontmatter(lines).length;
  if (bodyLines > MAX_BODY_LINES) {
    findings.push(
      fail(`body is ${bodyLines} lines (hard cap 500) — extract detail into references/`),
    );
  }
  if (bodyLines < MIN_TARGET_BODY_LINES || bodyLines > MAX_TARGET_BODY_LINES) {
    findings.push(
      warn(
        `body is ${bodyLines} lines, outside the 80-310 target (agentskills.io: keep the body under 5000 tokens and 500 lines)`,
      ),
    );
  }
  return findings;
}

/** The finding of a `references/` folder that holds a folder. */
export const NESTED_REFERENCES: Finding = fail(
  "references/ must stay one level deep (agentskills.io: avoid deep reference chains)",
);

/** The slop warning of one SKILL.md, after its `references/` check. */
export function slopFindings(lines: ReadonlyArray<string>): Array<Finding> {
  const slop = slopCount(lines);
  return slop > 0
    ? [warn(`${slop} slop word(s) in prose (comprehensive/robust/elegant/seamless)`)]
    : [];
}

/** The last line of one skill's report. */
export const scoreLine = (score: number): string =>
  `  score: ${score}/16 (docks rubric; per-file floor set by the project's scoring.json; aim 14+)`;

// ---- the walk ----

/**
 * Each SKILL.md below `root`, sorted. The walk skips `node_modules` and does not enter a symlink; a folder that it
 * cannot read is skipped.
 */
export const walkSkillFiles = Effect.fn("skills.walkSkillFiles")(function* (root: string) {
  const files = yield* SkillFiles;
  const out: Array<string> = [];
  const walk: (folder: string) => Effect.Effect<void> = Effect.fnUntraced(function* (folder) {
    const entries = yield* files
      .readFolder(folder)
      .pipe(Effect.catchTag("FileError", () => Effect.succeed([])));
    for (const entry of entries) {
      if (entry.name === "node_modules") continue;
      const full = join(folder, entry.name);
      if (entry.isDirectory) yield* walk(full);
      else if (entry.name === "SKILL.md") out.push(full);
    }
  });
  yield* walk(root);
  return out.sort();
});
