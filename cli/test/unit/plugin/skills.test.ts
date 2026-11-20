import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import config from "../../../scripts/pluginContent/config.json" with { type: "json" };
import { skillCandidateDirs } from "../../../scripts/pluginContent/frontmatter.ts";
import { checkDurableAnchors, checkReferences } from "../../../scripts/pluginContent/references.ts";
import {
  checkReportSection,
  checkSharedCopies,
  checkSkillFrontmatter,
  checkSkillLayout,
  checkTransformGuard,
  scoreSkills,
} from "../../../scripts/pluginContent/skills.ts";
import { checkTriggerCollisions } from "../../../scripts/pluginContent/triggers.ts";

/**
 * The docks skill content checks, ported from DocksDocks/docks, on the kit
 * plugin skills. The live tree must pass each check. Each red test copies the
 * plugin folder into a temporary repository root, plants one violation, and
 * expects the check to fail with a message that names the file.
 */
const REPO_ROOT = resolve(import.meta.dirname, "..", "..", "..", "..");
const SKILLS = `${config.pluginDir}/skills`;

const fixtures: Array<string> = [];

afterEach(() => {
  for (const root of fixtures.splice(0)) rmSync(root, { recursive: true, force: true });
});

/** A temporary repository root with a copy of the kit plugin folder. */
function copyFixture(): string {
  const root = mkdtempSync(join(tmpdir(), "kit-plugin-skills-"));
  fixtures.push(root);
  cpSync(join(REPO_ROOT, config.pluginDir), join(root, config.pluginDir), { recursive: true });
  return root;
}

function edit(root: string, relative: string, change: (text: string) => string): void {
  const file = join(root, relative);
  const before = readFileSync(file, "utf8");
  const after = change(before);
  expect(after, `the planted change did not change ${relative}`).not.toBe(before);
  writeFileSync(file, after);
}

function plant(root: string, relative: string, text: string): void {
  const file = join(root, relative);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, text);
}

const skillFile = (name: string): string => `${SKILLS}/${name}/SKILL.md`;

/** Expect a failure that names `file` and contains `detail`. */
function expectFailure(failures: ReadonlyArray<string>, file: string, detail: string): void {
  expect(
    failures.some((failure) => failure.includes(file) && failure.includes(detail)),
    `no failure names ${file} with "${detail}"; failures: ${JSON.stringify(failures)}`,
  ).toBe(true);
}

/** A minimal skill that passes the frontmatter rules. */
const minimalSkill = (name: string, description: string, body = "# Body\n"): string =>
  `---\nname: ${name}\ndescription: "${description}"\nuser-invocable: false\nmetadata:\n  updated: "2026-01-01"\n---\n\n${body}`;

describe("kit plugin skills: live tree", () => {
  it("passes the layout, frontmatter, report section, and shared copy checks", () => {
    expect(checkSkillLayout(REPO_ROOT)).toEqual([]);
    expect(checkSkillFrontmatter(REPO_ROOT)).toEqual([]);
    expect(checkReportSection(REPO_ROOT)).toEqual([]);
    expect(checkSharedCopies(REPO_ROOT)).toEqual([]);
  });

  it("passes the reference, anchor, transform, and trigger checks", () => {
    expect(checkReferences(REPO_ROOT)).toEqual([]);
    expect(checkDurableAnchors(REPO_ROOT)).toEqual([]);
    expect(checkTransformGuard(REPO_ROOT)).toEqual([]);
    expect(checkTriggerCollisions(REPO_ROOT)).toEqual([]);
  });

  it("gives each skill folder one score row at or above the floor", () => {
    const result = scoreSkills(REPO_ROOT);
    expect(result.failures).toEqual([]);
    const onDisk = skillCandidateDirs(join(REPO_ROOT, SKILLS)).map(({ name }) => name);
    expect(onDisk.length).toBeGreaterThan(0);
    expect(result.rows.map((row) => row.name)).toEqual(onDisk);
    for (const row of result.rows) {
      expect(row.score, row.name).toBeGreaterThanOrEqual(config.floors.skills);
    }
  });
});

describe("kit plugin skills: layout and name", () => {
  it("fails a skill whose name differs from its folder", () => {
    const root = copyFixture();
    edit(root, skillFile("accessibility"), (text) =>
      text.replace("name: accessibility", "name: accessible"),
    );
    expectFailure(checkSkillLayout(root), skillFile("accessibility"), "'accessible'");
    expectFailure(checkSkillFrontmatter(root), skillFile("accessibility"), "must match directory");
  });

  it("fails a SKILL.md below skills/<name>/", () => {
    const root = copyFixture();
    plant(root, `${SKILLS}/group/nested/SKILL.md`, minimalSkill("nested", "Use when nesting."));
    expectFailure(
      checkSkillLayout(root),
      `${SKILLS}/group/nested/SKILL.md`,
      "is not at skills/<name>/SKILL.md",
    );
  });
});

describe("kit plugin skills: frontmatter rules", () => {
  const file = skillFile("accessibility");
  const cases: ReadonlyArray<{
    readonly rule: string;
    readonly change: (text: string) => string;
    readonly detail: string;
  }> = [
    {
      rule: "a missing description",
      change: (text) => text.replace(/^description: .*\n/m, ""),
      detail: "`description` must be a non-empty string",
    },
    {
      rule: "a description without Use when",
      change: (text) => text.replace('description: "Use when', 'description: "For'),
      detail: "must start with `Use when`",
    },
    {
      rule: "a description longer than 1024 characters",
      change: (text) =>
        text.replace('description: "Use when', `description: "Use when ${"x".repeat(1024)}`),
      detail: "description exceeds maximum length",
    },
    {
      rule: "a plain description with a comment hazard",
      change: (text) => text.replace(/^description: .*$/m, "description: Use when a #tag"),
      detail: "contains `#`",
    },
    {
      rule: "a missing user-invocable",
      change: (text) => text.replace(/^user-invocable: .*\n/m, ""),
      detail: "`user-invocable` must be present and boolean",
    },
    {
      rule: "a bad metadata.updated",
      change: (text) => text.replace(/updated: "[^"]*"/, 'updated: "October"'),
      detail: "metadata.updated must be present",
    },
    {
      rule: "a bad metadata.content_hash",
      change: (text) => text.replace(/content_hash: "[^"]*"/, 'content_hash: "ABC"'),
      detail: "metadata.content_hash must be a 64-character",
    },
    {
      rule: "a name that is not hyphen-case",
      change: (text) => text.replace("name: accessibility", "name: Access_ibility"),
      detail: "must be lowercase hyphen-case",
    },
    {
      rule: "a missing frontmatter fence",
      change: (text) => text.replace(/^---\n/, ""),
      detail: "must start with YAML frontmatter fence",
    },
    {
      rule: "invalid YAML",
      change: (text) =>
        text.replace("user-invocable: false", "user-invocable: false\nuser-invocable: true"),
      detail: "invalid YAML frontmatter",
    },
    {
      rule: "a body over 500 lines",
      change: (text) => `${text}${"line\n".repeat(500)}`,
      detail: "(cap: 500)",
    },
  ];

  for (const { rule, change, detail } of cases) {
    it(`fails ${rule}`, () => {
      const root = copyFixture();
      edit(root, file, change);
      expectFailure(checkSkillFrontmatter(root), file, detail);
    });
  }

  it("fails a nested folder under references/", () => {
    const root = copyFixture();
    plant(root, `${SKILLS}/accessibility/references/deep/note.md`, "# Note\n");
    expectFailure(checkSkillFrontmatter(root), file, "must stay one level deep");
  });
});

describe("kit plugin skills: report section and shared copies", () => {
  it("fails a changed report section", () => {
    const root = copyFixture();
    edit(root, skillFile("zoom-out"), (text) =>
      text.replace("Leave out secrets", "Leave out passwords"),
    );
    expectFailure(checkReportSection(root), skillFile("zoom-out"), "Report section differs");
  });

  it("fails a skill without the report section", () => {
    const root = copyFixture();
    edit(root, skillFile("zoom-out"), (text) =>
      text.replace("## Report a problem with this skill", "## Report"),
    );
    expectFailure(checkReportSection(root), skillFile("zoom-out"), "missing the Report section");
  });

  it("fails an edit to one shared copy", () => {
    const root = copyFixture();
    const group = config.sharedFiles[0]!;
    const copy = group.copies[0]!;
    edit(root, copy, (text) => `${text}\nAn extra line.\n`);
    expectFailure(checkSharedCopies(root), copy, `differs from ${group.canonical}`);
  });
});

describe("kit plugin skills: references", () => {
  it("fails a broken local link", () => {
    const root = copyFixture();
    edit(root, skillFile("accessibility"), (text) => `${text}\nSee [x](references/missing.md).\n`);
    expectFailure(
      checkReferences(root),
      skillFile("accessibility"),
      "broken local link -> references/missing.md",
    );
  });

  it("fails an orphan reference", () => {
    const root = copyFixture();
    plant(root, `${SKILLS}/accessibility/references/orphan-note.md`, "# Orphan\n");
    expectFailure(
      checkReferences(root),
      skillFile("accessibility"),
      "orphan reference references/orphan-note.md",
    );
  });

  it("fails a long reference without a Contents section", () => {
    const root = copyFixture();
    const headings = "## One\n\n## Two\n\n## Three\n\n";
    plant(
      root,
      `${SKILLS}/accessibility/references/long-note.md`,
      `# Long\n\n${headings}${"line\n".repeat(100)}`,
    );
    edit(root, skillFile("accessibility"), (text) => `${text}\nSee references/long-note.md.\n`);
    expectFailure(
      checkReferences(root),
      `${SKILLS}/accessibility/references/long-note.md`,
      'no "## Contents" TOC',
    );
  });

  it("fails an anchor to an existing repository file and passes a fictional one", () => {
    const root = copyFixture();
    plant(root, "AGENTS.md", "# Agents\n");
    edit(root, skillFile("accessibility"), (text) => `${text}\nSee missing/file.ts:3.\n`);
    expect(checkDurableAnchors(root)).toEqual([]);
    edit(root, skillFile("accessibility"), (text) => `${text}\nSee AGENTS.md:42.\n`);
    expectFailure(checkDurableAnchors(root), skillFile("accessibility"), "`AGENTS.md:42`");
  });

  it("fails an anchor in an AGENTS.md node and skips the folders the guard skips", () => {
    const root = copyFixture();
    plant(root, "cli/src/main.ts", "export {};\n");
    for (const skipped of ["node_modules/pkg", ".git", "cli/dist", "cli/dist-test"]) {
      plant(root, `${skipped}/AGENTS.md`, "See cli/src/main.ts:42.\n");
    }
    expect(checkDurableAnchors(root)).toEqual([]);
    plant(root, "cli/AGENTS.md", "# CLI\n\nSee cli/src/main.ts:42.\n");
    expect(checkDurableAnchors(root)).toEqual([
      "cli/AGENTS.md:3: live line anchor `cli/src/main.ts:42`",
    ]);
  });
});

describe("kit plugin skills: transform guard", () => {
  const preservation =
    /content loss|no content|preserv|verbatim|net.?shrink|byte.?delta|section presence|drop a section|relocate.{0,12}verbatim/gi;

  it("fails a curated skill without the preservation words", () => {
    const root = copyFixture();
    edit(root, skillFile("refactor"), (text) => text.replace(preservation, "kept"));
    expectFailure(checkTransformGuard(root), skillFile("refactor"), "preservation <constraint>");
  });

  it("fails a curated skill without a verify heading", () => {
    const root = copyFixture();
    edit(root, skillFile("refactor"), (text) =>
      text.replace(/^(#{2,3}[^\n]*)\bverif(y|ication)\b/gim, "$1Checks"),
    );
    expectFailure(checkTransformGuard(root), skillFile("refactor"), "## Verification block");
  });

  it("fails a curated skill that is missing", () => {
    const root = copyFixture();
    rmSync(join(root, SKILLS, "refactor"), { recursive: true });
    expectFailure(checkTransformGuard(root), "refactor", "has no SKILL.md");
  });
});

describe("kit plugin skills: trigger collisions", () => {
  const surface = "Use when frobnicating quantum widgets, gizmos, sprockets, and turbines.";

  it("fails two unrouted skills with the same five-token trigger", () => {
    const root = copyFixture();
    plant(root, skillFile("alpha-one"), minimalSkill("alpha-one", surface));
    plant(root, skillFile("beta-two"), minimalSkill("beta-two", surface));
    const failures = checkTriggerCollisions(root);
    expectFailure(failures, skillFile("alpha-one"), skillFile("beta-two"));
  });

  it("passes the same pair when one routes to the other", () => {
    const root = copyFixture();
    plant(root, skillFile("alpha-one"), minimalSkill("alpha-one", surface));
    plant(
      root,
      skillFile("beta-two"),
      minimalSkill("beta-two", `${surface} Not for gears (use alpha-one).`),
    );
    expect(checkTriggerCollisions(root)).toEqual([]);
  });
});

describe("kit plugin skills: score floor", () => {
  it("fails a skill below the per-file floor", () => {
    const root = copyFixture();
    plant(root, skillFile("weak"), "---\nname: weak\ndescription: weak\n---\n\nWeak.\n");
    expectFailure(
      scoreSkills(root).failures,
      "weak",
      `below per-file floor ${config.floors.skills}`,
    );
  });

  it("fails a skill folder that the scorer skips", () => {
    const root = copyFixture();
    mkdirSync(join(root, SKILLS, "no-skill-file"));
    expectFailure(scoreSkills(root).failures, "no-skill-file", "unscored on disk");
  });
});
