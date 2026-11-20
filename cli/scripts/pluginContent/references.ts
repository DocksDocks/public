import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { findSkillFiles, pluginDir, skillsDir } from "./frontmatter.ts";

/**
 * The reference checks of the DocksDocks/docks gate, ported to the kit plugin:
 * `scripts/skills/refs-guard.mjs` (broken local links, orphan references, and
 * a contents section in a long reference) and `scripts/skills/durable-anchors.mjs`
 * (no live `path:line` anchor in shipped text).
 */

const TOC_LINE_THRESHOLD = 100;
const TOC_HEADING_MIN = 3;

const shown = (repoRoot: string, file: string): string =>
  relative(repoRoot, file).split(sep).join("/") || file;

interface ReferenceShape {
  readonly lineCount: number;
  readonly headings: number;
  readonly hasToc: boolean;
}

/**
 * Count the `##` and `###` headings outside code fences, and find a contents
 * heading in the first 30 lines. A fence closes only on a marker at least as
 * long as its opener. The line count is the `wc -l` count.
 */
function analyzeReference(content: string): ReferenceShape {
  const lines = content.split(/\r?\n/);
  let fenceLength = 0;
  let headings = 0;
  let hasToc = false;
  for (const [index, line] of lines.entries()) {
    const fence = /^(`{3,}|~{3,})/.exec(line);
    if (fence !== null) {
      const length = fence[1]!.length;
      if (fenceLength === 0) fenceLength = length;
      else if (length >= fenceLength) fenceLength = 0;
      continue;
    }
    if (fenceLength > 0) continue;
    if (index < 30 && /^##\s+(Contents|Table of contents)\b/i.test(line)) hasToc = true;
    if (/^#{2,3}\s+\S/.test(line)) headings += 1;
  }
  const lineCount = content.endsWith("\n") ? lines.length - 1 : lines.length;
  return { lineCount, headings, hasToc };
}

/** The `references/` and `assets/` link targets of a markdown text, relative to its skill. */
function localLinkTargets(content: string): Set<string> {
  const pattern = /\]\(\s*(?:\.\/)?((?:references|assets)\/[^)\s#]+)(?:#[^)]*)?\s*\)/g;
  return new Set([...content.matchAll(pattern)].map((match) => match[1]!));
}

/**
 * For each skill: each local link resolves, each reference file is named in
 * SKILL.md, and each reference over 100 lines with 3 or more headings has a
 * `## Contents` section. A mention of another skill's path is not a local link.
 */
export function checkReferences(repoRoot: string): Array<string> {
  const failures: Array<string> = [];
  for (const file of findSkillFiles(skillsDir(repoRoot))) {
    const dir = dirname(file);
    const name = shown(repoRoot, file);
    const content = readFileSync(file, "utf8");
    for (const target of localLinkTargets(content)) {
      if (!existsSync(join(dir, target))) failures.push(`${name}: broken local link -> ${target}`);
    }
    const referencesDir = join(dir, "references");
    if (!existsSync(referencesDir) || !statSync(referencesDir).isDirectory()) continue;
    for (const entry of readdirSync(referencesDir)) {
      const reference = join(referencesDir, entry);
      if (!statSync(reference).isFile()) continue;
      if (!content.includes(entry)) {
        failures.push(
          `${name}: orphan reference references/${entry} (never mentioned in SKILL.md)`,
        );
      }
      if (entry.endsWith(".md")) {
        const shape = analyzeReference(readFileSync(reference, "utf8"));
        if (
          shape.lineCount > TOC_LINE_THRESHOLD &&
          shape.headings >= TOC_HEADING_MIN &&
          !shape.hasToc
        ) {
          failures.push(
            `${shown(repoRoot, reference)}: ${shape.lineCount} lines, ${shape.headings} headings, no "## Contents" TOC (rule: TOC for reference files > 100 lines)`,
          );
        }
      }
    }
  }
  return failures;
}

/** Folder names that the docks anchor guard skipped, and the kit build output folders. */
const SKIPPED_NAMES: ReadonlyArray<string> = [
  ".git",
  "node_modules",
  "target",
  ".claude",
  ".codex",
];
const SKIPPED_PATHS: ReadonlyArray<string> = ["cli/dist", "cli/dist-test"];

/** Each markdown file below `root`. The walk skips symbolic links and the skipped folders. */
function markdownFiles(root: string, dir: string = root, out: Array<string> = []): Array<string> {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isSymbolicLink()) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      const skipped =
        SKIPPED_NAMES.includes(entry.name) || SKIPPED_PATHS.includes(shown(root, full));
      if (!skipped) markdownFiles(root, full, out);
    } else if (entry.name.endsWith(".md")) out.push(full);
  }
  return out;
}

const ANCHOR = /[A-Za-z0-9_./-]+\.[a-z]{1,5}:\d+/gi;

/**
 * Long-lived text does not carry a live `path:line` anchor: an anchor whose
 * path resolves to a file in this repository goes stale on the next edit above
 * that line. The scope is each markdown file of the kit plugin and each
 * `AGENTS.md` node of the repository. A fictional path, such as
 * `src/api/users.ts:87`, does not resolve and passes. An existing path outside
 * the repository is an external reference and passes too.
 */
export function checkDurableAnchors(repoRoot: string): Array<string> {
  const root = resolve(repoRoot);
  const inRepository = (candidate: string): boolean => {
    const path = relative(root, candidate);
    return path === "" || (path !== ".." && !path.startsWith(`..${sep}`) && !isAbsolute(path));
  };
  const failures: Array<string> = [];
  const plugin = pluginDir(root);
  const inScope = (file: string): boolean =>
    basename(file) === "AGENTS.md" || !relative(plugin, file).startsWith("..");
  for (const file of markdownFiles(root).filter(inScope).sort()) {
    const lines = readFileSync(file, "utf8").split("\n");
    for (const [index, line] of lines.entries()) {
      for (const hit of line.match(ANCHOR) ?? []) {
        const target = resolve(root, hit.slice(0, hit.lastIndexOf(":")));
        if (inRepository(target) && existsSync(target)) {
          failures.push(`${shown(root, file)}:${index + 1}: live line anchor \`${hit}\``);
        }
      }
    }
  }
  return failures;
}
