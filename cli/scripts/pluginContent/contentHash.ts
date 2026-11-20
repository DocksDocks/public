import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { skillDirs } from "./frontmatter.ts";

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

/** The content hash of the skill in `dir`. */
export function hashSkill(dir: string): string {
  const file = join(dir, "SKILL.md");
  if (!existsSync(file)) throw new Error(`${file} not found`);
  let assembled = strippedSkillText(readFileSync(file, "utf8"));
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

/**
 * Write `hash` and the date `today` into the `metadata` block of the SKILL.md
 * in `dir`. The hash leaves out `updated:`, so the date is set here, where the
 * meaning changed: the stored date and the stored hash then describe the same
 * edit. A SKILL.md without a `metadata:` block does not change.
 */
function writeHash(dir: string, hash: string, today: string): void {
  const file = join(dir, "SKILL.md");
  const lines = readFileSync(file, "utf8").split("\n");
  const updatedLine = `  updated: "${today}"`;
  const hashLine = `  content_hash: "${hash}"`;
  const out: Array<string> = [];
  let inFrontmatter = false;
  let inMetadata = false;
  let hashDone = false;
  let dateDone = false;
  const closeMetadata = (): void => {
    if (!dateDone) out.push(updatedLine);
    if (!hashDone) out.push(hashLine);
    dateDone = true;
    hashDone = true;
  };
  for (const [index, line] of lines.entries()) {
    if (index === 0 && line === "---") {
      inFrontmatter = true;
      out.push(line);
    } else if (inFrontmatter && line === "---") {
      if (inMetadata) closeMetadata();
      inFrontmatter = false;
      inMetadata = false;
      out.push(line);
    } else if (inFrontmatter && /^metadata:/.test(line)) {
      inMetadata = true;
      out.push(line);
    } else if (inFrontmatter && inMetadata && /^[ \t]*updated:/.test(line)) {
      out.push(updatedLine);
      dateDone = true;
    } else if (inFrontmatter && inMetadata && /^[ \t]*content_hash:/.test(line)) {
      out.push(hashLine);
      hashDone = true;
    } else if (inFrontmatter && inMetadata && /^[^ \t]/.test(line)) {
      closeMetadata();
      inMetadata = false;
      out.push(line);
    } else {
      out.push(line);
    }
  }
  writeFileSync(file, out.join("\n"));
}

/**
 * Refresh `metadata.content_hash` and `metadata.updated` of each skill below
 * `skillsRoot` whose stored hash differs from its content. Returns the names
 * of the written skills. Upstream skills are skipped.
 */
export function writeContentHashes(
  skillsRoot: string,
  today: string = new Date().toISOString().slice(0, 10),
): Array<string> {
  const written: Array<string> = [];
  for (const { name, dir } of skillDirs(skillsRoot)) {
    if (isUpstream(dir)) continue;
    const fresh = hashSkill(dir);
    if (storedHash(dir) !== fresh) {
      writeHash(dir, fresh, today);
      written.push(name);
    }
  }
  return written;
}
