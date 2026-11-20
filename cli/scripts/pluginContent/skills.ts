import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { basename, dirname, isAbsolute, join, relative, sep } from "node:path";
import config from "./config.json" with { type: "json" };
import {
  bodyAfterFrontmatter,
  extractFrontmatter,
  findSkillByName,
  findSkillFiles,
  frontmatterBlock,
  frontmatterName,
  type FrontmatterMapping,
  mappingField,
  parseFrontmatter,
  skillCandidateDirs,
  skillsDir,
  splitLines,
} from "./frontmatter.ts";

/**
 * The skill checks of the DocksDocks/docks gate, ported to the kit plugin:
 * the layout and name check of `scripts/ci.mjs gateSkills`, the frontmatter
 * rules of `scripts/lib/validate-skills.mjs`, the report section and shared
 * copy checks of `scripts/skills/guard.mjs`, `scripts/skills/transform-guard.mjs`,
 * and the score floor of `gateSkills`. Each check takes a repository root and
 * returns one message per problem; a message names the file relative to the root.
 */

export interface ScoreRow {
  readonly name: string;
  readonly score: number;
}

export interface ScoreResult {
  readonly rows: ReadonlyArray<ScoreRow>;
  readonly failures: ReadonlyArray<string>;
}

const MAX_NAME_LENGTH = 64;
const MAX_DESCRIPTION_LENGTH = 1024;
const MAX_BODY_LINES = 500;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const NAME_PATTERN = /^[a-z0-9-]+$/;
const HASH_PATTERN = /^[0-9a-f]{64}$/;

/** The shipped scorer, relative to the skills folder. */
const SCORER = join("write-skill", "scripts", "skill-guard.mjs");

const shown = (repoRoot: string, file: string): string =>
  relative(repoRoot, file).split(sep).join("/") || file;

/** Each skill sits at skills/<name>/SKILL.md, and its frontmatter name is <name>. */
export function checkSkillLayout(repoRoot: string): Array<string> {
  const root = skillsDir(repoRoot);
  const failures: Array<string> = [];
  for (const file of findSkillFiles(root)) {
    const [folder, ...rest] = relative(root, file).split(sep);
    if (rest.length !== 1) {
      failures.push(`${shown(repoRoot, file)} is not at skills/<name>/SKILL.md`);
      continue;
    }
    const name = frontmatterName(frontmatterBlock(readFileSync(file, "utf8")) ?? "");
    if (name !== folder) {
      failures.push(
        `${shown(repoRoot, file)} has the name '${String(name)}', not its folder name '${folder}'`,
      );
    }
  }
  return failures;
}

/** A plain description with ` #` reads as a YAML comment from that point. */
function hasPlainCommentHazard(frontmatterText: string): boolean {
  const line = frontmatterText.split(/\r?\n/).find((entry) => /^description:/.test(entry)) ?? "";
  if (line === "") return false;
  const raw = line.replace(/^description:\s*/, "");
  if (raw === "" || /^["'|>]/.test(raw)) return false;
  return /(^|[ \t])#/.test(raw);
}

function bodyLineCount(body: string): number {
  if (body === "") return 0;
  const trimmed = body.endsWith("\n") ? body.slice(0, -1) : body;
  return trimmed === "" ? 0 : trimmed.split(/\r?\n/).length;
}

function commonErrors(
  file: string,
  frontmatterText: string,
  frontmatter: FrontmatterMapping,
): Array<string> {
  const errors: Array<string> = [];
  const { name, description } = frontmatter;
  if (typeof name !== "string" || name.trim() === "") {
    errors.push("frontmatter `name` must be a non-empty string");
  } else {
    if (!NAME_PATTERN.test(name)) {
      errors.push(`name ${JSON.stringify(name)} must be lowercase hyphen-case`);
    }
    if (name.startsWith("-") || name.endsWith("-") || name.includes("--")) {
      errors.push(
        `name ${JSON.stringify(name)} cannot start/end with hyphen or contain consecutive hyphens`,
      );
    }
    if (name.length > MAX_NAME_LENGTH) {
      errors.push(`name exceeds maximum length of ${MAX_NAME_LENGTH} characters (${name.length})`);
    }
    const folder = basename(dirname(file));
    if (name !== folder) {
      errors.push(`name ${JSON.stringify(name)} must match directory ${JSON.stringify(folder)}`);
    }
  }
  if (typeof description !== "string" || description.trim() === "") {
    errors.push("frontmatter `description` must be a non-empty string");
  } else {
    if (description.length > MAX_DESCRIPTION_LENGTH) {
      errors.push(
        `description exceeds maximum length of ${MAX_DESCRIPTION_LENGTH} characters (${description.length})`,
      );
    }
    if (hasPlainCommentHazard(frontmatterText)) {
      errors.push(
        "plain YAML description contains `#`; YAML reads ` #` as the start of a comment, so quote it",
      );
    }
  }
  return errors;
}

/** The agentskills.io rules: a body under 500 lines, and references one level deep. */
function structureErrors(file: string, body: string): Array<string> {
  const errors: Array<string> = [];
  const lines = bodyLineCount(body);
  if (lines > MAX_BODY_LINES) {
    errors.push(`body is ${lines} lines (cap: ${MAX_BODY_LINES}); extract detail into references/`);
  }
  const referencesDir = join(dirname(file), "references");
  if (existsSync(referencesDir) && statSync(referencesDir).isDirectory()) {
    for (const entry of readdirSync(referencesDir, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        errors.push(
          `references/ must stay one level deep; nested directory ${JSON.stringify(entry.name)} is not allowed (agentskills.io: avoid deep reference chains)`,
        );
      }
    }
  }
  return errors;
}

/** The docks rules: `Use when`, `user-invocable`, `metadata.updated`, and the hash format. */
function docksErrors(frontmatter: FrontmatterMapping): Array<string> {
  const errors: Array<string> = [];
  const upstream = Boolean(frontmatter["upstream"]);
  const description = frontmatter["description"];
  const metadata = mappingField(frontmatter, "metadata");
  if (!upstream && typeof description === "string" && !/^use when/i.test(description)) {
    errors.push("description must start with `Use when` unless the skill has an `upstream:` block");
  }
  if (!upstream && typeof frontmatter["user-invocable"] !== "boolean") {
    errors.push("frontmatter `user-invocable` must be present and boolean");
  }
  if (!upstream) {
    const updated = metadata?.["updated"];
    if (typeof updated !== "string" || !DATE_PATTERN.test(updated)) {
      errors.push("metadata.updated must be present in YYYY-MM-DD format");
    }
  }
  const contentHash = metadata?.["content_hash"];
  if (
    contentHash !== undefined &&
    (typeof contentHash !== "string" || !HASH_PATTERN.test(contentHash))
  ) {
    errors.push("metadata.content_hash must be a 64-character lowercase hex string when present");
  }
  return errors;
}

/** The frontmatter rules of the skill validator, for each SKILL.md below the skills folder. */
export function checkSkillFrontmatter(repoRoot: string): Array<string> {
  const root = skillsDir(repoRoot);
  const files = findSkillFiles(root);
  if (files.length === 0) return [`${shown(repoRoot, root)}: no SKILL.md files found`];
  const failures: Array<string> = [];
  for (const file of files) {
    const extracted = extractFrontmatter(readFileSync(file, "utf8"));
    const errors: Array<string> = [];
    if (!extracted.ok) {
      errors.push(extracted.error);
    } else {
      const parsed = parseFrontmatter(extracted.text);
      if (!parsed.ok) {
        errors.push(`invalid YAML frontmatter: ${parsed.error}`);
      } else {
        errors.push(
          ...commonErrors(file, extracted.text, parsed.value),
          ...structureErrors(file, extracted.body),
          ...docksErrors(parsed.value),
        );
      }
    }
    for (const error of errors) failures.push(`${shown(repoRoot, file)}: ${error}`);
  }
  return failures;
}

/**
 * Each skill ends with the canonical report section, byte for byte. The files
 * are read as latin1 (one character per byte), so line endings and the final
 * newline count. The last heading starts the section, because a skill can
 * quote the heading in its body.
 */
export function checkReportSection(
  repoRoot: string,
  section: string = config.reportSection,
): Array<string> {
  const canonical = Buffer.from(section, "utf8").toString("latin1");
  const heading = canonical.split("\n", 1)[0] ?? "";
  if (!heading.startsWith("## ")) {
    return ["config.json reportSection: the first line must be the `## ` heading of the section"];
  }
  const escaped = heading.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const headingLine = new RegExp(`^${escaped}$`, "gm");
  const failures: Array<string> = [];
  for (const file of findSkillFiles(skillsDir(repoRoot))) {
    const content = readFileSync(file, "latin1");
    const start = [...content.matchAll(headingLine)].at(-1)?.index;
    if (start === undefined) {
      failures.push(
        `${shown(repoRoot, file)}: missing the Report section; end the file with the reportSection text of config.json`,
      );
    } else if (content.slice(start) !== canonical) {
      failures.push(
        `${shown(repoRoot, file)}: the Report section differs from the reportSection text of config.json; copy that text over it`,
      );
    }
  }
  return failures;
}

export interface SharedFileGroup {
  readonly canonical: string;
  readonly copies: ReadonlyArray<string>;
}

/** Each copy of a shared file equals its canonical file, byte for byte. */
export function checkSharedCopies(
  repoRoot: string,
  groups: ReadonlyArray<SharedFileGroup> = config.sharedFiles,
): Array<string> {
  const failures: Array<string> = [];
  const isPath = (value: string): boolean => value !== "" && !isAbsolute(value);
  if (
    !groups.every(
      (group) => isPath(group.canonical) && group.copies.length > 0 && group.copies.every(isPath),
    )
  ) {
    return [
      'config.json sharedFiles: must be a list of { "canonical": "<path>", "copies": ["<path>", ...] }, with relative paths',
    ];
  }
  const read = (path: string): Buffer | undefined => {
    try {
      return readFileSync(join(repoRoot, path));
    } catch (error) {
      failures.push(`${path}: cannot read the shared file (${String(error)})`);
      return undefined;
    }
  };
  for (const { canonical, copies } of groups) {
    const canonicalBytes = read(canonical);
    for (const copy of copies) {
      const copyBytes = read(copy);
      if (
        canonicalBytes !== undefined &&
        copyBytes !== undefined &&
        !copyBytes.equals(canonicalBytes)
      ) {
        failures.push(`${copy}: differs from ${canonical}; copy that file over it`);
      }
    }
  }
  return failures;
}

const PRESERVATION_PATTERN =
  /content loss|no content|preserv|verbatim|net.?shrink|byte.?delta|section presence|drop a section|relocate.{0,12}verbatim/i;
/**
 * A heading, not prose: the block must be a section that a reader can find. The
 * heading text is free, for example "## Verification" or "### Step 6 - Verify".
 */
const VERIFY_HEADING_PATTERN = /^#{2,3}[^\n]*\bverif(y|ication)\b/im;

/**
 * Each curated content-transforming skill keeps a preservation `<constraint>`
 * and a verification heading, so that an edit cannot strip its data-loss guard.
 */
export function checkTransformGuard(
  repoRoot: string,
  names: ReadonlyArray<string> = config.transformingSkills,
): Array<string> {
  const root = skillsDir(repoRoot);
  const failures: Array<string> = [];
  for (const name of names) {
    const file = findSkillByName(root, name);
    if (file === null) {
      failures.push(
        `listed transforming skill '${name}' has no SKILL.md under ${shown(repoRoot, root)}`,
      );
      continue;
    }
    const body = bodyAfterFrontmatter(splitLines(readFileSync(file, "utf8"))).join("\n");
    let missing = "";
    if (!PRESERVATION_PATTERN.test(body)) missing += "preservation <constraint>; ";
    if (!VERIFY_HEADING_PATTERN.test(body)) missing += "## Verification block; ";
    if (missing !== "") {
      failures.push(
        `${shown(repoRoot, file)}: ${name} lacks: ${missing}(was hardened — regression?)`,
      );
    }
  }
  return failures;
}

export interface ScoreFloorInput {
  /** The kind in each message, such as `skill` or `agent`. */
  readonly kind: string;
  readonly rows: ReadonlyArray<ScoreRow>;
  /** The names that the scorer must score, from the folder on disk. */
  readonly onDisk: ReadonlyArray<string>;
  readonly floor: number;
  /** The names that the per-file floor skips. */
  readonly exempt?: ReadonlySet<string>;
}

/**
 * The score floor of the docks gate. The score rows are the only input, so a
 * scorer that skipped an item would pass both floors; the row set must
 * therefore cover the names on disk, once each, before the floors apply. Then
 * the total must reach `rows × floor`, and each row must reach the floor.
 */
export function scoreFloorFailures(input: ScoreFloorInput): Array<string> {
  const { kind, rows, onDisk, floor } = input;
  if (onDisk.length === 0) return [`no ${kind} on disk, so no ${kind} score set to check`];
  const nonFinite = rows.filter((row) => !Number.isFinite(row.score));
  if (nonFinite.length > 0) {
    return [
      `the ${kind} scorer gave non-finite scores: ${nonFinite.map((row) => row.name).join(", ")}`,
    ];
  }
  const counts = new Map<string, number>();
  for (const row of rows) counts.set(row.name, (counts.get(row.name) ?? 0) + 1);
  const disk = new Set(onDisk);
  const unscored = onDisk.filter((name) => !counts.has(name));
  const notOnDisk = [...counts.keys()].filter((name) => !disk.has(name));
  const duplicates = [...counts].filter(([, count]) => count > 1).map(([name]) => name);
  if (rows.length !== onDisk.length || unscored.length + notOnDisk.length + duplicates.length > 0) {
    const details = [
      unscored.length > 0 ? `unscored on disk: ${unscored.join(", ")}` : null,
      notOnDisk.length > 0 ? `not on disk: ${notOnDisk.join(", ")}` : null,
      duplicates.length > 0 ? `duplicate score rows: ${duplicates.join(", ")}` : null,
    ].filter((detail) => detail !== null);
    return [
      `the ${kind} score set does not cover the tree: expected ${onDisk.length} on disk, parsed ${rows.length} score rows` +
        (details.length > 0 ? ` — ${details.join(" — ")}` : ""),
    ];
  }
  const failures: Array<string> = [];
  const total = rows.reduce((sum, row) => sum + row.score, 0);
  if (total < rows.length * floor) {
    failures.push(
      `${kind} score total ${total} below floor ${rows.length * floor} (${rows.length} × ${floor})`,
    );
  }
  for (const row of rows) {
    if (input.exempt?.has(row.name) !== true && row.score < floor) {
      failures.push(`${kind} ${row.name} score ${row.score} below per-file floor ${floor}`);
    }
  }
  return failures;
}

/**
 * Run the shipped scorer `write-skill/scripts/skill-guard.mjs score --per-file`
 * with Bun on the skills folder, and apply the score floor. The scorer skips a
 * folder without a SKILL.md, so the names on disk come from the folders. An
 * upstream skill counts in the total but skips the per-file floor.
 */
export function scoreSkills(repoRoot: string, floor: number = config.floors.skills): ScoreResult {
  const root = skillsDir(repoRoot);
  const scorer = join(root, SCORER);
  const command = `bun ${shown(repoRoot, scorer)} score --per-file ${shown(repoRoot, root)}`;
  const run = spawnSync("bun", [scorer, "score", "--per-file", root], { encoding: "utf8" });
  if (run.error !== undefined || run.status !== 0) {
    const detail = `${run.stdout ?? ""}${run.stderr ?? ""}`.trim();
    return {
      rows: [],
      failures: [
        `the skill scorer exited ${String(run.status)}${run.error === undefined ? "" : ` (${run.error.message})`}, so no score set to check (${command})${detail === "" ? "" : `: ${detail}`}`,
      ],
    };
  }
  const rows = run.stdout
    .trim()
    .split("\n")
    .filter((line) => line !== "")
    .map((line) => {
      const [name = "", score = ""] = line.split(" ");
      return { name, score: Number.parseInt(score, 10) };
    });
  const candidates = skillCandidateDirs(root);
  const exempt = new Set(
    candidates
      .filter(({ file }) => existsSync(file) && /^upstream:/m.test(readFileSync(file, "utf8")))
      .map(({ name }) => name),
  );
  const failures = scoreFloorFailures({
    kind: "skill",
    rows,
    onDisk: candidates.map(({ name }) => name),
    floor,
    exempt,
  });
  return { rows, failures };
}
