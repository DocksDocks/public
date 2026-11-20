import { readFileSync } from "node:fs";
import { basename, dirname, relative, sep } from "node:path";
import { findSkillFiles, skillsDir } from "../../src/skills/frontmatter.ts";

/**
 * The trigger collision check of DocksDocks/docks (`tests/skill-trigger-collision.mjs`),
 * ported to the kit plugin. It finds two skills whose descriptions share
 * enough significant trigger tokens to compete for the same prompt, and fails
 * the pair when neither description names the other skill (the
 * "Not for … (use <sibling>)" form). It is a heuristic, not a semantic test.
 * Raise OVERLAP_FAIL only to admit a new routed pair, never to hide an
 * unrouted collision.
 */

/** The shared significant tokens at or above which an unrouted pair fails. */
const OVERLAP_FAIL = 5;

/** Tokens with no trigger signal: structure words and words that every skill uses. */
const STOP = new Set([
  "use",
  "when",
  "not",
  "for",
  "the",
  "a",
  "an",
  "or",
  "and",
  "of",
  "to",
  "in",
  "on",
  "with",
  "into",
  "from",
  "via",
  "per",
  "its",
  "it",
  "this",
  "that",
  "these",
  "those",
  "is",
  "are",
  "be",
  "as",
  "at",
  "by",
  "if",
  "then",
  "than",
  "also",
  "each",
  "any",
  "you",
  "your",
  "they",
  "them",
  "their",
  "one",
  "two",
  "three",
  "new",
  "existing",
  "skill",
  "skills",
  "agent",
  "agents",
  "project",
  "projects",
  "code",
  "codebase",
  "file",
  "files",
  "user",
  "users",
  "docks",
  "claude",
  "codex",
  "runtime",
  "tool",
  "tools",
  "work",
  "working",
  "run",
  "runs",
  "running",
  "using",
  "used",
  "uses",
  "over",
  "after",
  "before",
  "every",
  "all",
  "between",
  "across",
  "about",
  "against",
  "set",
  "up",
  "out",
  "no",
  "do",
  "does",
  "doing",
  "done",
  "e",
  "g",
  "eg",
  "ie",
  "page",
  "pages",
  "gaps",
  "gap",
  "incl",
  "etc",
  "multiple",
  "single",
  "list",
]);

interface TriggerSkill {
  readonly name: string;
  readonly file: string;
  readonly description: string;
  readonly tokens: ReadonlySet<string>;
}

function tokens(description: string): Set<string> {
  return new Set(
    description
      .toLowerCase()
      .replace(/[^a-z0-9/+.-]+/g, " ")
      .split(/\s+/)
      .map((word) => word.replace(/^[./-]+|[./-]+$/g, ""))
      .filter((word) => word.length >= 3 && !STOP.has(word) && !/^\d+$/.test(word)),
  );
}

/**
 * The positive trigger surface: the text before "Not for". The words of the
 * exclusion clause send a prompt away, so they do not count as overlap. The
 * routing test still reads the full description.
 */
function positiveSurface(description: string): string {
  const match = /\bNot for\b|[.;]\s+Not\s/i.exec(description);
  return match === null ? description : description.slice(0, match.index);
}

/**
 * The `description` text of a SKILL.md, joined across continuation lines up to
 * the next top-level key. This is enough for token extraction.
 */
function readDescription(file: string): string | null {
  const lines = readFileSync(file, "utf8").split(/\r?\n/);
  if (lines[0] !== "---") return null;
  const end = lines.findIndex((line, index) => index > 0 && line === "---");
  if (end === -1) return null;
  const frontmatter = lines.slice(1, end);
  const start = frontmatter.findIndex((line) => /^description:/.test(line));
  if (start === -1) return null;
  let raw = frontmatter[start]!.replace(/^description:\s*/, "");
  for (const line of frontmatter.slice(start + 1)) {
    if (/^[a-zA-Z_-]+:/.test(line)) break;
    raw += ` ${line.trim()}`;
  }
  return raw
    .replace(/^["'|>]\s*/, "")
    .replace(/["']\s*$/, "")
    .trim();
}

/** A pair routes when one description names the other skill. */
const routes = (a: TriggerSkill, b: TriggerSkill): boolean =>
  a.description.toLowerCase().includes(b.name.toLowerCase()) ||
  b.description.toLowerCase().includes(a.name.toLowerCase());

/** Each unrouted pair of skills that shares OVERLAP_FAIL or more trigger tokens. */
export function checkTriggerCollisions(repoRoot: string): Array<string> {
  const skills: Array<TriggerSkill> = [];
  for (const file of findSkillFiles(skillsDir(repoRoot))) {
    const description = readDescription(file);
    if (description === null || description === "") continue;
    skills.push({
      name: basename(dirname(file)),
      file: relative(repoRoot, file).split(sep).join("/"),
      description,
      tokens: tokens(positiveSurface(description)),
    });
  }
  const failures: Array<string> = [];
  for (const [index, a] of skills.entries()) {
    for (const b of skills.slice(index + 1)) {
      const shared = [...a.tokens].filter((token) => b.tokens.has(token));
      if (shared.length >= OVERLAP_FAIL && !routes(a, b)) {
        failures.push(
          `${a.file} and ${b.file} share ${shared.length} trigger tokens [${shared.join(" ")}], but neither description routes to the other (add a "Not for… (use <sibling>)" clause)`,
        );
      }
    }
  }
  return failures;
}
