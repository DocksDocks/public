import { describe, it } from "vitest";

import { expectRun, fixture } from "../../lib/agentDocs/harness";
import { DEFAULT_SCORE_ROOT } from "../../lib/skills/entry";
import {
  RECENT,
  SKILLS_HOST_SUPPORTED,
  bodyLines,
  daysAgo,
  run,
  skillText,
} from "../../lib/skills/harness";
import { SPAWN_TIMEOUT_MS } from "../../lib/spawnTimeout";

// Ported from DocksDocks/docks scripts/tests/author-tooling.mjs (testSkillGuardScoresFlatSkills): each skill is a
// folder `<root>/<name>/SKILL.md`, one level below the skills root; a folder without a SKILL.md is not a skill, and
// the scorer does not go into it.
const flatSkill = (name: string): string =>
  `${[
    "---",
    `name: ${name}`,
    `description: Use when a test scores the ${name} fixture. Not for real work.`,
    "---",
    `# ${name}`,
    "",
    "## Workflow",
    "",
    "1. Score the fixture.",
    "",
  ].join("\n")}`;

const FLAT_FILES = {
  "skills/alpha/SKILL.md": flatSkill("alpha"),
  "skills/beta/SKILL.md": flatSkill("beta"),
  "skills/group/nested/SKILL.md": flatSkill("nested"),
  "skills/AGENTS.md": "# Skills\n",
};

describe.skipIf(!SKILLS_HOST_SUPPORTED)("skill score", { timeout: SPAWN_TIMEOUT_MS }, () => {
  it("--per-file prints one row per <root>/<name>/SKILL.md and none for a deeper skill or a file (docks author-tooling.mjs:548)", () => {
    const fx = fixture({ git: false, files: FLAT_FILES });
    expectRun(run("score", ["--per-file", "skills"], fx), 0, ["alpha 6", "beta 6"]);
  });

  it("without --per-file prints the total of the rows (docks author-tooling.mjs:559)", () => {
    const fx = fixture({ git: false, files: FLAT_FILES });
    expectRun(run("score", ["skills"], fx), 0, ["12"]);
  });

  it("without a root reads the default folder of the entry and not the other tree (docks author-tooling.mjs:571)", () => {
    const fx = fixture({
      git: false,
      files: {
        "plugins/docks/skills/plugin-one/SKILL.md": flatSkill("plugin-one"),
        "plugins/docks/skills/plugin-two/SKILL.md": flatSkill("plugin-two"),
        ".agents/skills/project-one/SKILL.md": skillText(
          ["name: project-one", "description: Scores the project tree."],
          ["# project-one"],
        ),
      },
    });
    const rows =
      DEFAULT_SCORE_ROOT === "plugins/docks/skills"
        ? ["plugin-one 6", "plugin-two 6"]
        : ["project-one 4"];
    expectRun(run("score", ["--per-file"], fx), 0, rows);
    expectRun(run("score", [], fx), 0, [
      DEFAULT_SCORE_ROOT === "plugins/docks/skills" ? "12" : "4",
    ]);
  });

  it("an empty root prints no row and a total of 0", () => {
    const fx = fixture({ git: false, dirs: ["skills"] });
    expectRun(run("score", ["--per-file", "skills"], fx), 0, []);
    expectRun(run("score", ["skills"], fx), 0, ["0"]);
  });

  it("sorts the rows by folder name in code-unit order, not by the name field", () => {
    const fx = fixture({
      git: false,
      files: {
        "skills/beta/SKILL.md": flatSkill("zeta"),
        "skills/Alpha/SKILL.md": flatSkill("alpha"),
        "skills/alpha/SKILL.md": flatSkill("alpha"),
      },
    });
    expectRun(run("score", ["--per-file", "skills"], fx), 0, ["Alpha 6", "alpha 6", "beta 6"]);
  });
});

// The 16-point rubric, one planted skill per branch. The base skill scores 4: a description of 1-500 characters (2)
// and no slop word (2). Each row changes one input and names the points it expects.
const BASE_DESCRIPTION = "description: Probes the rubric.";
type RubricRow = {
  readonly label: string;
  readonly frontmatter?: ReadonlyArray<string>;
  readonly body?: ReadonlyArray<string>;
  readonly points: number;
};
const withBase = (...lines: ReadonlyArray<string>): Array<string> => [
  "name: probe",
  BASE_DESCRIPTION,
  ...lines,
];
const described = (description: string): Array<string> => [
  "name: probe",
  `description: ${description}`,
];
const astral = (count: number): string => "\u{1F600}".repeat(count);
const constraints = (count: number): Array<string> =>
  Array.from({ length: count }, (_, i) => `<constraint>Rule ${i + 1}.</constraint>`);

const RUBRIC: ReadonlyArray<RubricRow> = [
  { label: "the base skill", points: 4 },
  {
    label: "a description that starts with Use when: +2",
    frontmatter: described("Use when probing the rubric."),
    points: 6,
  },
  {
    label: "a lower-case use when start: +2",
    frontmatter: described("use when probing the rubric."),
    points: 6,
  },
  {
    label: "a double-quoted Use when description: the quotes do not count",
    frontmatter: described('"Use when probing the rubric."'),
    points: 6,
  },
  {
    label: "a single-quoted Use when description: the quotes do not count",
    frontmatter: described("'Use when probing the rubric.'"),
    points: 6,
  },
  {
    label: "use when after the start, without upstream: no points",
    frontmatter: described("Probes it; use when testing."),
    points: 4,
  },
  {
    label: "use when after the start, with upstream: +2",
    frontmatter: [
      ...described("Probes it; use when testing."),
      "upstream:",
      "  repo: example/probe",
    ],
    points: 6,
  },
  {
    label: "a description of 500 characters: +2",
    frontmatter: described("x".repeat(500)),
    points: 4,
  },
  {
    label: "a description of 501 characters: +1",
    frontmatter: described("x".repeat(501)),
    points: 3,
  },
  {
    label: "a description of 1000 characters: +1",
    frontmatter: described("x".repeat(1000)),
    points: 3,
  },
  {
    label: "a description of 1001 characters: no points",
    frontmatter: described("x".repeat(1001)),
    points: 2,
  },
  {
    label: "500 astral characters count as 500: +2",
    frontmatter: described(astral(500)),
    points: 4,
  },
  {
    label: "501 astral characters count as 501: +1",
    frontmatter: described(astral(501)),
    points: 3,
  },
  {
    label: "an empty description: no points",
    frontmatter: ["name: probe", "description:"],
    points: 2,
  },
  { label: "no description line: no points", frontmatter: ["name: probe"], points: 2 },
  {
    label: "a block description: the first line holds only the indicator",
    frontmatter: ["name: probe", "description: >-", "  Use when probing the rubric."],
    points: 4,
  },
  {
    label: "metadata.updated 180 days ago: +1",
    frontmatter: withBase("metadata:", `  updated: "${daysAgo(180)}"`),
    points: 5,
  },
  {
    label: "metadata.updated 181 days ago: no point",
    frontmatter: withBase("metadata:", `  updated: "${daysAgo(181)}"`),
    points: 4,
  },
  {
    label: "an unquoted metadata.updated: +1",
    frontmatter: withBase("metadata:", `  updated: ${RECENT}`),
    points: 5,
  },
  {
    label: "metadata.updated that is no date: no point",
    frontmatter: withBase("metadata:", '  updated: "2026-13-45"'),
    points: 4,
  },
  {
    label: "an updated field outside metadata: no point",
    frontmatter: withBase("metadata:", "  owner: probe", `updated: "${RECENT}"`),
    points: 4,
  },
  {
    label: "upstream.vendored_at recent without metadata.updated: +1",
    frontmatter: withBase("upstream:", `  vendored_at: "${RECENT}"`),
    points: 5,
  },
  {
    label: "upstream.vendored_at without upstream: no point",
    frontmatter: withBase("source:", `  vendored_at: "${RECENT}"`),
    points: 4,
  },
  { label: "one constraint line: +1", body: constraints(1), points: 5 },
  { label: "three constraint lines: +3", body: constraints(3), points: 7 },
  { label: "four constraint lines: +3 at most", body: constraints(4), points: 7 },
  { label: "BAD and GOOD: +2", body: ["BAD: guess.", "GOOD: measure."], points: 6 },
  { label: "BAD without GOOD: no points", body: ["BAD: guess."], points: 4 },
  { label: "# BAD and // GOOD markers: +2", body: ["#BAD", "//GOOD"], points: 6 },
  {
    label: "wrong fix and right fix: +2",
    body: ["The wrong fix hides it.", "The Right Fix names it."],
    points: 6,
  },
  {
    label: "lower-case bad and good: no points",
    body: ["bad: guess.", "good: measure."],
    points: 4,
  },
  { label: "one slop line: +1 instead of +2", body: ["A robust and seamless check."], points: 3 },
  {
    label: "two slop lines: no slop points",
    body: ["A robust check.", "An elegant check."],
    points: 2,
  },
  {
    label: "slop words in code spans and fences do not count",
    body: ["Avoid `robust`.", "```", "comprehensive", "```"],
    points: 4,
  },
  { label: "a table row: +1", body: ["| a | b |"], points: 5 },
  { label: "a fence with a language: +1", body: ["```ts", "const a = 1;", "```"], points: 5 },
  {
    label: "a fence with an upper-case language: no point",
    body: ["```TS", "const a = 1;", "```"],
    points: 4,
  },
  { label: "a body of 79 lines: no points", body: bodyLines(79), points: 4 },
  { label: "a body of 80 lines: +2", body: bodyLines(80), points: 6 },
  { label: "a body of 310 lines: +2", body: bodyLines(310), points: 6 },
  { label: "a body of 311 lines: no points", body: bodyLines(311), points: 4 },
  {
    label: "every branch: 16",
    frontmatter: [
      "name: probe",
      "description: Use when probing the rubric.",
      "metadata:",
      `  updated: "${RECENT}"`,
    ],
    body: [
      ...constraints(3),
      "BAD: guess.",
      "GOOD: measure.",
      "| a | b |",
      "```ts",
      "const a = 1;",
      "```",
      ...bodyLines(72),
    ],
    points: 16,
  },
];

describe.skipIf(!SKILLS_HOST_SUPPORTED)("skill score rubric", { timeout: SPAWN_TIMEOUT_MS }, () => {
  it.each(RUBRIC)("$label: $points", ({ frontmatter = withBase(), body = ["# probe"], points }) => {
    const fx = fixture({
      git: false,
      files: { "skills/probe/SKILL.md": skillText(frontmatter, body) },
    });
    expectRun(run("score", ["--per-file", "skills"], fx), 0, [`probe ${points}`]);
  });

  it("scores a SKILL.md without a final newline and with CRLF line ends", () => {
    const fx = fixture({
      git: false,
      files: {
        "skills/crlf/SKILL.md":
          "---\r\nname: crlf\r\ndescription: Use when probing.\r\n---\r\n# crlf\r\n",
        "skills/open/SKILL.md": "---\nname: open\ndescription: Use when probing.\n---\n# open",
      },
    });
    // A CRLF fence is not `---`, so the body is empty; the description keeps its CR and still starts with Use when.
    expectRun(run("score", ["--per-file", "skills"], fx), 0, ["crlf 6", "open 6"]);
  });
});
