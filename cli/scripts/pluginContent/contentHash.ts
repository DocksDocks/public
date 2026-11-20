import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { extractFrontmatter, mappingField, parseFrontmatter, skillDirs } from "./frontmatter.ts";

/**
 * The skill content hash of DocksDocks/docks (`scripts/skills/content-hash.mjs`),
 * ported to the kit plugin. The hash covers the meaning of a skill: the
 * frontmatter without the `updated:` and `content_hash:` lines, the body, and
 * the sorted `references/*.md` files, after normalization. Each stored
 * `metadata.content_hash` depends on this algorithm, so keep it byte-stable.
 */

export interface StaleSkill {
  readonly name: string;
  readonly reason: "no content_hash" | "content changed";
}

/**
 * Strip trailing white space from each line, drop each CR, and collapse each
 * run of blank lines into one (`sed 's/[[:space:]]*$//' | tr -d '\r' | cat -s`).
 */
function normalize(text: string): string {
  const out: Array<string> = [];
  let previousBlank = false;
  for (const raw of text.split("\n")) {
    const line = raw.replace(/[ \t\r\f\v]*$/, "").replace(/\r/g, "");
    const blank = line === "";
    if (blank && previousBlank) continue;
    out.push(line);
    previousBlank = blank;
  }
  return out.join("\n");
}

/** True when the frontmatter of the skill in `dir` has an `upstream:` key. */
export function isUpstream(dir: string): boolean {
  const file = join(dir, "SKILL.md");
  if (!existsSync(file)) return false;
  const lines = readFileSync(file, "utf8").split(/\r?\n/);
  const start = lines.indexOf("---");
  if (start === -1) return false;
  const end = lines.indexOf("---", start + 1);
  if (end === -1) return false;
  return lines.slice(start + 1, end).some((line) => /^upstream:/.test(line));
}

/**
 * The SKILL.md text without the `updated:` and `content_hash:` lines of the
 * frontmatter, with a newline after each kept line.
 */
function strippedSkillText(content: string): string {
  const records = (content.endsWith("\n") ? content.slice(0, -1) : content).split("\n");
  let inFrontmatter = false;
  const kept: Array<string> = [];
  for (const [index, line] of records.entries()) {
    if (index === 0 && line === "---") {
      inFrontmatter = true;
      kept.push(line);
    } else if (inFrontmatter && line === "---") {
      inFrontmatter = false;
      kept.push(line);
    } else if (!(inFrontmatter && /^[ \t]*(updated|content_hash):/.test(line))) {
      kept.push(line);
    }
  }
  return kept.map((line) => `${line}\n`).join("");
}

/** The content hash of the skill in `dir`, with `skillText` as its SKILL.md text. */
function hashSkillText(dir: string, skillText: string): string {
  let assembled = strippedSkillText(skillText);
  const referencesDir = join(dir, "references");
  if (existsSync(referencesDir) && statSync(referencesDir).isDirectory()) {
    for (const name of readdirSync(referencesDir)
      .filter((entry) => entry.endsWith(".md"))
      .sort()) {
      const reference = join(referencesDir, name);
      if (statSync(reference).isFile()) assembled += readFileSync(reference, "utf8");
    }
  }
  return createHash("sha256").update(normalize(assembled), "utf8").digest("hex");
}

/** The content hash of the skill in `dir`. */
export function hashSkill(dir: string): string {
  const file = join(dir, "SKILL.md");
  if (!existsSync(file)) throw new Error(`${file} not found`);
  return hashSkillText(dir, readFileSync(file, "utf8"));
}

/** The stored `content_hash` value of the skill in `dir`, or "" when it has none. */
function storedHash(dir: string): string {
  const line = readFileSync(join(dir, "SKILL.md"), "utf8")
    .split("\n")
    .find((entry) => /^[ \t]*content_hash:/.test(entry));
  return line === undefined ? "" : (line.split('"')[1] ?? "");
}

/** Each skill below `skillsRoot` whose stored hash is missing or stale. Upstream skills are skipped. */
export function checkContentHashes(skillsRoot: string): Array<StaleSkill> {
  const stale: Array<StaleSkill> = [];
  for (const { name, dir } of skillDirs(skillsRoot)) {
    if (isUpstream(dir)) continue;
    const stored = storedHash(dir);
    if (stored === "") stale.push({ name, reason: "no content_hash" });
    else if (stored !== hashSkill(dir)) stale.push({ name, reason: "content changed" });
  }
  return stale;
}

type Edited =
  | { readonly ok: true; readonly text: string }
  | { readonly ok: false; readonly error: string };

const NOT_BLOCK = "metadata is not a block mapping; edit it by hand";

/** The leading spaces and tabs of a line. */
const indentOf = (line: string): string => /^[ \t]*/.exec(line)?.[0] ?? "";

/**
 * Set `metadata.updated` and `metadata.content_hash` in the frontmatter of
 * `content`. The edit changes only direct children of a block-style
 * `metadata:` mapping, at the exact indent of its first child, and adds a
 * missing child after the last line of the block. Without a `metadata:` key,
 * it adds the block before the closing `---`. It refuses each other shape,
 * such as a flow mapping, because a line edit of it can make invalid YAML.
 */
function withHash(content: string, hash: string, today: string): Edited {
  const lines = content.split("\n");
  if (lines[0] !== "---")
    return { ok: false, error: "SKILL.md has no frontmatter; edit it by hand" };
  const close = lines.indexOf("---", 1);
  if (close === -1) return { ok: false, error: "frontmatter fence is not closed; edit it by hand" };
  const updated = `updated: "${today}"`;
  const contentHash = `content_hash: "${hash}"`;
  const start = lines.findIndex(
    (line, index) => index > 0 && index < close && /^metadata:/.test(line),
  );
  if (start === -1) {
    const block = ["metadata:", `  ${updated}`, `  ${contentHash}`];
    return {
      ok: true,
      text: [...lines.slice(0, close), ...block, ...lines.slice(close)].join("\n"),
    };
  }
  const value = lines[start]!.slice("metadata:".length).trim();
  if (value !== "" && !value.startsWith("#")) return { ok: false, error: NOT_BLOCK };
  // The block runs to the next line at column 0 or to the closing fence.
  let end = start + 1;
  while (end < close && (lines[end]!.trim() === "" || /^[ \t]/.test(lines[end]!))) end += 1;
  const entries = lines
    .slice(start + 1, end)
    .map((line, offset) => ({ line, index: start + 1 + offset }))
    .filter(({ line }) => line.trim() !== "" && !line.trim().startsWith("#"));
  const indent = entries.length === 0 ? "  " : indentOf(entries[0]!.line);
  if (indent.includes("\t")) return { ok: false, error: NOT_BLOCK };
  const out = [...lines];
  let dateDone = false;
  let hashDone = false;
  for (const { line, index } of entries) {
    const own = indentOf(line);
    if (own.length < indent.length || own.includes("\t")) return { ok: false, error: NOT_BLOCK };
    if (own.length > indent.length) continue;
    const entry = line.slice(indent.length);
    if (!/^[^\s#:-][^:]*:(?:[ \t]|$)/.test(entry)) return { ok: false, error: NOT_BLOCK };
    if (/^updated:/.test(entry)) {
      out[index] = `${indent}${updated}`;
      dateDone = true;
    } else if (/^content_hash:/.test(entry)) {
      out[index] = `${indent}${contentHash}`;
      hashDone = true;
    }
  }
  const added = [
    ...(dateDone ? [] : [`${indent}${updated}`]),
    ...(hashDone ? [] : [`${indent}${contentHash}`]),
  ];
  const after = (entries.at(-1)?.index ?? start) + 1;
  out.splice(after, 0, ...added);
  return { ok: true, text: out.join("\n") };
}

export interface WriteResult {
  /** The names of the refreshed skills. */
  readonly written: ReadonlyArray<string>;
  /** One `<skill>: <problem>` message per skill that the write refused or could not refresh. */
  readonly failures: ReadonlyArray<string>;
}

/**
 * Write a fresh `metadata.content_hash` and the date `today` into the SKILL.md
 * in `dir`, or return the problem. The hash leaves out `updated:`, so the date
 * is set here, where the meaning changed: the stored date and the stored hash
 * then describe the same edit. A new `metadata:` line is part of the hashed
 * text, so the hash comes from the edited text. After the write, the file is
 * read again; when the stored hash still differs, the original text goes back.
 */
function writeHash(dir: string, today: string): string | null {
  const file = join(dir, "SKILL.md");
  const original = readFileSync(file, "utf8");
  const draft = withHash(original, "0".repeat(64), today);
  if (!draft.ok) return draft.error;
  const fresh = hashSkillText(dir, draft.text);
  const edited = withHash(original, fresh, today);
  if (!edited.ok) return edited.error;
  writeFileSync(file, edited.text);
  const extracted = extractFrontmatter(readFileSync(file, "utf8"));
  const parsed = extracted.ok ? parseFrontmatter(extracted.text) : undefined;
  const metadata = parsed?.ok === true ? mappingField(parsed.value, "metadata") : undefined;
  if (
    metadata?.["content_hash"] === fresh &&
    storedHash(dir) === fresh &&
    hashSkill(dir) === fresh
  ) {
    return null;
  }
  writeFileSync(file, original);
  return "the stored hash does not match after the write; the file is unchanged; edit it by hand";
}

/**
 * Refresh `metadata.content_hash` and `metadata.updated` of each skill below
 * `skillsRoot` whose stored hash differs from its content. Upstream skills are
 * skipped.
 */
export function writeContentHashes(
  skillsRoot: string,
  today: string = new Date().toISOString().slice(0, 10),
): WriteResult {
  const written: Array<string> = [];
  const failures: Array<string> = [];
  for (const { name, dir } of skillDirs(skillsRoot)) {
    if (isUpstream(dir) || storedHash(dir) === hashSkill(dir)) continue;
    const problem = writeHash(dir, today);
    if (problem === null) written.push(name);
    else failures.push(`${name}: ${problem}`);
  }
  return { written, failures };
}
