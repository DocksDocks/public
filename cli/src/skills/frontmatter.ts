import { existsSync, readdirSync, statSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { parseDocument } from "yaml";
import config from "./config.json" with { type: "json" };

/**
 * Shared parse and walk helpers for the kit plugin content checks. They port
 * `scripts/lib/skills-parse.mjs`, `scripts/lib/skills-walk.mjs`, the
 * frontmatter steps of `scripts/lib/validate-skills.mjs`, and the frontmatter
 * helpers of `scripts/ci.mjs` from DocksDocks/docks.
 */

/** The kit plugin folder below a repository root. */
export const pluginDir = (repoRoot: string): string => join(repoRoot, config.pluginDir);

/** The skills folder of the kit plugin below a repository root. */
export const skillsDir = (repoRoot: string): string => join(pluginDir(repoRoot), "skills");

/** The agents folder of the kit plugin below a repository root. */
export const agentsDir = (repoRoot: string): string => join(pluginDir(repoRoot), "agents");

/** A frontmatter value that YAML parsed into a mapping. */
export type FrontmatterMapping = { readonly [key: string]: unknown };

export type Extracted =
  | { readonly ok: true; readonly text: string; readonly body: string }
  | { readonly ok: false; readonly error: string };

export type Parsed =
  | { readonly ok: true; readonly value: FrontmatterMapping }
  | { readonly ok: false; readonly error: string };

const isMapping = (value: unknown): value is FrontmatterMapping =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** Split a SKILL.md into its frontmatter text and its body, as the validator does. */
export function extractFrontmatter(content: string): Extracted {
  const lines = content.split(/\r?\n/);
  if (lines[0] !== "---") {
    return { ok: false, error: "SKILL.md must start with YAML frontmatter fence `---`" };
  }
  const end = lines.findIndex((line, index) => index > 0 && line === "---");
  if (end === -1) return { ok: false, error: "frontmatter fence is not closed" };
  return {
    ok: true,
    text: lines.slice(1, end).join("\n"),
    body: lines.slice(end + 1).join("\n"),
  };
}

/** Parse frontmatter text as strict YAML with unique string keys. */
export function parseFrontmatter(text: string): Parsed {
  const doc = parseDocument(text, {
    prettyErrors: true,
    strict: true,
    uniqueKeys: true,
    stringKeys: true,
  });
  if (doc.errors.length > 0) {
    return { ok: false, error: doc.errors.map((error) => error.message).join("; ") };
  }
  let value: unknown;
  try {
    // `toJS` throws on a value that the parse step accepts, such as an alias
    // to an anchor that does not exist.
    value = doc.toJS();
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
  if (!isMapping(value)) return { ok: false, error: "frontmatter must be a YAML mapping/object" };
  return { ok: true, value };
}

/** Read a nested mapping value, or undefined when the key is not a mapping. */
export const mappingField = (
  value: FrontmatterMapping,
  key: string,
): FrontmatterMapping | undefined => {
  const field = value[key];
  return isMapping(field) ? field : undefined;
};

/** The frontmatter block of a markdown file, or null when it has none. */
export const frontmatterBlock = (text: string): string | null =>
  /^---\n([\s\S]*?)\n---(?:\n|$)/u.exec(text)?.[1] ?? null;

/** The keys of the top-level lines of a frontmatter block. */
export const frontmatterKeys = (block: string): ReadonlySet<string> =>
  new Set(block.split("\n").flatMap((line) => /^([A-Za-z][\w-]*):/u.exec(line)?.[1] ?? []));

/** The `name` value of a frontmatter block, without quotes, or null when it has none. */
export const frontmatterName = (block: string): string | null =>
  /^name:[ \t]*(.*)$/mu
    .exec(block)?.[1]
    ?.trim()
    .replace(/^(["'])(.*)\1$/u, "$2") ?? null;

/** Each SKILL.md below `root`, sorted. The walk skips node_modules, .git, and symbolic links. */
export function findSkillFiles(root: string): Array<string> {
  const out: Array<string> = [];
  const walk = (dir: string): void => {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch (error) {
      throw new Error(`cannot read skills directory ${resolve(dir)}: ${String(error)}`, {
        cause: error,
      });
    }
    for (const entry of entries) {
      if (entry.name === "node_modules" || entry.name === ".git" || entry.isSymbolicLink()) {
        continue;
      }
      const full = join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name === "SKILL.md") out.push(full);
    }
  };
  walk(root);
  return out.sort();
}

export interface SkillDir {
  readonly name: string;
  readonly dir: string;
  readonly file: string;
}

/**
 * Each `<root>/<skill>/` folder, sorted, also one without a SKILL.md. The
 * scorer skips a folder without a SKILL.md, so a count from this list sees
 * that folder. `statSync` follows symbolic links, as the scorer does.
 */
export function skillCandidateDirs(root: string): Array<SkillDir> {
  if (!existsSync(root)) return [];
  return readdirSync(root)
    .sort()
    .map((name) => ({ name, dir: join(root, name), file: join(root, name, "SKILL.md") }))
    .filter(({ dir }) => statSync(dir).isDirectory());
}

/** Each `<root>/<skill>/` folder, sorted, that holds a SKILL.md. */
export const skillDirs = (root: string): Array<SkillDir> =>
  skillCandidateDirs(root).filter(({ file }) => existsSync(file));

/** The first SKILL.md below `root` whose folder is `name`, or null. */
export const findSkillByName = (root: string, name: string): string | null =>
  findSkillFiles(root).find((file) => basename(dirname(file)) === name) ?? null;
