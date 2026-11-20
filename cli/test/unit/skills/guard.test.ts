import { describe, it } from "vitest";

import { expectRun, fixture } from "../../lib/agentDocs/harness";
import {
  RECENT,
  SKILLS_HOST_SUPPORTED,
  bodyLines,
  bodyWarning,
  daysAgo,
  failed,
  passed,
  run,
  scoreLine,
  skillText,
} from "../../lib/skills/harness";
import { SPAWN_TIMEOUT_MS } from "../../lib/spawnTimeout";

const DESCRIPTION_WARNING = (length: number): string =>
  `description is ${length} chars (>500 crowds the aggregate listing budget)`;
const NODE_FAIL =
  "  FAIL: description must be a plain, quoted, or block scalar string (no YAML alias, anchor, or tag)";

// Ported from DocksDocks/docks scripts/tests/author-tooling.mjs (testSkillGuardValidateRules). The validator has no
// `anthropic`/`claude` name rule and no angle-bracket description rule, gives the agentskills.io reason for the body
// line target, and measures the description as YAML reads it. The docks fixtures set metadata.updated to 2026-07-20;
// these set a date 30 days back, so the output does not change with the day of the run.
const portedSkill = (name: string, description: ReadonlyArray<string>): string =>
  `${[
    "---",
    `name: ${name}`,
    ...description,
    "user-invocable: false",
    "metadata:",
    `  updated: "${RECENT}"`,
    "---",
    `# ${name}`,
    "",
  ].join("\n")}`;

const text = (n: number): string => `Use when ${"x".repeat(n - 9)}`;
const word = (n: number): string => "y".repeat(n);
const indent = (lines: ReadonlyArray<string>): Array<string> =>
  lines.map((l) => (l === "" ? "" : `  ${l}`));

type LengthRow = {
  readonly name: string;
  readonly description: ReadonlyArray<string>;
  readonly length: number;
  /** The warnings between the length warning and the body warning. */
  readonly warnings?: ReadonlyArray<string>;
  readonly points: number;
};

const LENGTHS: ReadonlyArray<LengthRow> = [
  {
    name: "literal-clip",
    description: ["description: |", ...indent([text(100), ...Array<string>(10).fill(word(100))])],
    length: 1111,
    points: 5,
  },
  {
    name: "literal-strip",
    description: [
      "description: |-",
      ...indent([text(100), ...Array<string>(9).fill(word(100)), word(14)]),
    ],
    length: 1024,
    points: 5,
  },
  {
    name: "literal-indicator",
    description: [
      "description: |2-",
      `    ${text(100)}`,
      ...Array<string>(4).fill(`    ${word(100)}`),
    ],
    length: 514,
    warnings: ["  WARN: description should start with 'Use when'"],
    points: 5,
  },
  {
    name: "literal-keep",
    description: [
      "description: |+",
      ...indent([text(101), ...Array<string>(9).fill(word(101))]),
      "",
      "",
      "",
      "",
      "",
    ],
    length: 1025,
    points: 5,
  },
  {
    name: "folded-blank",
    description: [
      "description: >",
      ...indent([
        text(101),
        ...Array<Array<string>>(9)
          .fill(["", word(101)])
          .flat(),
      ]),
    ],
    length: 1020,
    points: 5,
  },
  {
    name: "folded-strip",
    description: [
      "description: >-",
      ...indent([text(101), ...Array<string>(8).fill(word(101)), word(107)]),
    ],
    length: 1025,
    points: 5,
  },
  {
    name: "folded-more-indented",
    description: ["description: >", ...indent([text(500), `  ${word(20)}`, word(500)])],
    length: 1025,
    points: 5,
  },
  {
    name: "double-quoted",
    description: [
      `description: "${text(500)}`,
      ...indent([word(500), `say \\"hi\\" ${word(30)}"`]),
    ],
    length: 1041,
    points: 7,
  },
  {
    name: "double-escaped-break",
    description: [`description: "${text(500)}\\`, ...indent([`${word(524)}"`])],
    length: 1024,
    points: 6,
  },
  {
    name: "double-one-line",
    description: [`description: "${text(1000)} \\"${word(20)}\\""`],
    length: 1023,
    points: 5,
  },
  {
    name: "single-quoted",
    description: [`description: '${text(500)} it''s`, "", ...indent([`${word(520)}'`])],
    length: 1026,
    points: 6,
  },
  {
    name: "plain-multi-line",
    description: [`description: ${text(600)}`, ...indent([word(500)])],
    length: 1101,
    points: 6,
  },
  {
    name: "plain-next-line",
    description: ["description:", ...indent([text(600), word(500)])],
    length: 1101,
    points: 3,
  },
];

type NodeRow = {
  readonly name: string;
  readonly description: ReadonlyArray<string>;
  readonly bad: boolean;
  readonly points: number;
};

const NODES: ReadonlyArray<NodeRow> = [
  {
    name: "alias",
    description: [`summary: &text "${text(1100)}"`, "description: *text"],
    bad: true,
    points: 5,
  },
  {
    name: "alias-next-line",
    description: [`summary: &text "${text(1100)}"`, "description:", "  *text"],
    bad: true,
    points: 3,
  },
  { name: "anchor", description: [`description: &a ${text(100)}`], bad: true, points: 5 },
  { name: "tag", description: [`description: !!str ${text(100)}`], bad: true, points: 5 },
  {
    name: "tag-next-line",
    description: ["description:", `  !!str ${text(100)}`],
    bad: true,
    points: 3,
  },
  { name: "plain", description: [`description: ${text(100)}`], bad: false, points: 7 },
  { name: "quoted", description: [`description: "${text(100)} & more"`], bad: false, points: 7 },
  {
    name: "block",
    description: ["description: >-", `  ${text(100)}`, "  *not an alias"],
    bad: false,
    points: 5,
  },
];

describe.skipIf(!SKILLS_HOST_SUPPORTED)(
  "skill guard (ported)",
  { timeout: SPAWN_TIMEOUT_MS },
  () => {
    it("passes skills named claude-* and anthropic-* with a <placeholder> and an arrow in the description (docks author-tooling.mjs:751)", () => {
      const description = [
        "description: Use when a test passes a <placeholder> and an arrow -> to the validator. Not for real work.",
      ];
      const fx = fixture({
        git: false,
        files: {
          "skills/claude-probe/SKILL.md": portedSkill("claude-probe", description),
          "skills/anthropic-probe/SKILL.md": portedSkill("anthropic-probe", description),
        },
      });
      expectRun(run("guard", ["skills"], fx), 0, [
        "== skills/anthropic-probe",
        `  WARN: ${bodyWarning(1)}`,
        scoreLine(7),
        "== skills/claude-probe",
        `  WARN: ${bodyWarning(1)}`,
        scoreLine(7),
        passed(2, 2),
      ]);
    });

    // docks author-tooling.mjs:811
    it.each(LENGTHS)(
      "measures the $name description as YAML reads it: $length chars (docks author-tooling.mjs:811)",
      ({ name, description, length, warnings = [], points }) => {
        const fx = fixture({
          git: false,
          files: { [`lengths/${name}/SKILL.md`]: portedSkill(name, description) },
        });
        const over = length > 1024;
        const warns = [
          `  WARN: ${DESCRIPTION_WARNING(length)}`,
          ...warnings,
          `  WARN: ${bodyWarning(1)}`,
        ];
        expectRun(run("guard", [`lengths/${name}`], fx), over ? 1 : 0, [
          `== lengths/${name}`,
          ...(over ? [`  FAIL: description exceeds 1024 chars (${length})`] : []),
          ...warns,
          scoreLine(points),
          over ? failed(1, warns.length, 1) : passed(1, warns.length),
        ]);
      },
    );

    // Each node case warns only about its one-line body.
    it.each(NODES)(
      "$name: a YAML alias, anchor, or tag fails: $bad (docks author-tooling.mjs:851)",
      ({ name, description, bad, points }) => {
        const fx = fixture({
          git: false,
          files: { [`nodes/${name}/SKILL.md`]: portedSkill(name, description) },
        });
        expectRun(run("guard", [`nodes/${name}`], fx), bad ? 1 : 0, [
          `== nodes/${name}`,
          ...(bad ? [NODE_FAIL] : []),
          `  WARN: ${bodyWarning(1)}`,
          scoreLine(points),
          bad ? failed(1, 1, 1) : passed(1, 1),
        ]);
      },
    );
  },
);

// The validator rules, one planted skill per rule. The base skill passes without a warning and scores 9: Use when
// (2), a description of 1-500 characters (2), a recent metadata.updated (1), no slop word (2), and 80 body lines (2).
const BASE_FRONTMATTER = [
  "name: probe",
  "description: Use when probing the validator.",
  "user-invocable: false",
  "metadata:",
  `  updated: "${RECENT}"`,
];
const BASE_BODY = bodyLines(80);
const BASE_POINTS = 9;

/** The base frontmatter with the line that starts with `field` replaced by `lines` (removed when empty). */
const replaced = (field: string, ...lines: ReadonlyArray<string>): Array<string> => {
  const at = BASE_FRONTMATTER.findIndex((l) => l.startsWith(field));
  return [...BASE_FRONTMATTER.slice(0, at), ...lines, ...BASE_FRONTMATTER.slice(at + 1)];
};

type FailRow = {
  readonly label: string;
  /** The SKILL.md text, or the skill folder's files relative to it. */
  readonly files: Readonly<Record<string, string>>;
  readonly dir?: string;
  readonly dirs?: ReadonlyArray<string>;
  /** The FAIL lines, then the WARN lines, in output order (without their indent and kind). */
  readonly lines: ReadonlyArray<string>;
  readonly fails: number;
  readonly warns: number;
  readonly points: number;
};
const plant = (
  frontmatter: ReadonlyArray<string>,
  body: ReadonlyArray<string> = BASE_BODY,
): Readonly<Record<string, string>> => ({ "SKILL.md": skillText(frontmatter, body) });

const FAILS: ReadonlyArray<FailRow> = [
  {
    label: "no opening frontmatter fence",
    files: { "SKILL.md": `${[...BASE_FRONTMATTER, "---", ...BASE_BODY].join("\n")}\n` },
    lines: [
      "  FAIL: SKILL.md must start with YAML frontmatter fence ---",
      `  WARN: ${bodyWarning(0)}`,
    ],
    fails: 1,
    warns: 1,
    points: 7,
  },
  {
    label: "a frontmatter fence that is not closed",
    files: { "SKILL.md": `${["---", ...BASE_FRONTMATTER, ...BASE_BODY].join("\n")}\n` },
    lines: ["  FAIL: frontmatter fence is not closed", `  WARN: ${bodyWarning(0)}`],
    fails: 1,
    warns: 1,
    points: 7,
  },
  {
    label: "a name that is not lower-case hyphen-case",
    dir: "Probe_One",
    files: plant(replaced("name:", "name: Probe_One")),
    lines: ["  FAIL: name 'Probe_One' must be lowercase hyphen-case"],
    fails: 1,
    warns: 0,
    points: BASE_POINTS,
  },
  {
    label: "a name of 65 characters",
    dir: "a".repeat(65),
    files: plant(replaced("name:", `name: ${"a".repeat(65)}`)),
    lines: ["  FAIL: name exceeds 64 chars (65)"],
    fails: 1,
    warns: 0,
    points: BASE_POINTS,
  },
  {
    label: "a name that differs from its folder",
    files: plant(replaced("name:", 'name: "other"')),
    lines: ["  FAIL: name 'other' must match directory 'probe'"],
    fails: 1,
    warns: 0,
    points: BASE_POINTS,
  },
  {
    label: "a YAML anchor in the description",
    files: plant(replaced("description:", "description: &d Use when probing the validator.")),
    lines: [NODE_FAIL],
    fails: 1,
    warns: 0,
    points: 7,
  },
  {
    label: "an empty description",
    files: plant(replaced("description:", "description:")),
    lines: ["  FAIL: description must be non-empty"],
    fails: 1,
    warns: 0,
    points: 5,
  },
  {
    label: "no description line",
    files: plant(replaced("description:")),
    lines: ["  FAIL: description must be non-empty"],
    fails: 1,
    warns: 0,
    points: 5,
  },
  {
    label: "a description of 1025 characters",
    files: plant(replaced("description:", `description: ${text(1025)}`)),
    lines: [
      "  FAIL: description exceeds 1024 chars (1025)",
      `  WARN: ${DESCRIPTION_WARNING(1025)}`,
    ],
    fails: 1,
    warns: 1,
    points: 7,
  },
  {
    label: "a plain description with a # comment",
    files: plant(replaced("description:", "description: Use when probing # the validator.")),
    lines: [
      "  FAIL: unquoted description contains '#' — quote it (YAML reads ' #' as the start of a comment)",
    ],
    fails: 1,
    warns: 0,
    points: BASE_POINTS,
  },
  {
    label: "a body of 501 lines",
    files: plant(BASE_FRONTMATTER, bodyLines(501)),
    lines: [
      "  FAIL: body is 501 lines (hard cap 500) — extract detail into references/",
      `  WARN: ${bodyWarning(501)}`,
    ],
    fails: 1,
    warns: 1,
    points: 7,
  },
  {
    label: "a folder inside references/",
    files: { ...plant(BASE_FRONTMATTER), "references/deep/a.md": "# a\n" },
    lines: [
      "  FAIL: references/ must stay one level deep (agentskills.io: avoid deep reference chains)",
    ],
    fails: 1,
    warns: 0,
    points: BASE_POINTS,
  },
];

type WarnRow = {
  readonly label: string;
  readonly frontmatter?: ReadonlyArray<string>;
  readonly body?: ReadonlyArray<string>;
  readonly warnings: ReadonlyArray<string>;
  readonly points: number;
};

const WARNS: ReadonlyArray<WarnRow> = [
  {
    label: "a description of 501 characters",
    frontmatter: replaced("description:", `description: ${text(501)}`),
    warnings: [DESCRIPTION_WARNING(501)],
    points: 8,
  },
  {
    label: "a description that does not start with Use when",
    frontmatter: replaced("description:", "description: Probes the validator; use when testing."),
    warnings: ["description should start with 'Use when'"],
    points: 7,
  },
  {
    label: "an upstream skill whose description lacks Use when",
    frontmatter: [
      ...replaced("description:", "description: Probes the validator."),
      "upstream:",
      "  repo: example/probe",
    ],
    warnings: ["description should contain 'Use when'"],
    points: 7,
  },
  {
    label: "no user-invocable",
    frontmatter: replaced("user-invocable:"),
    warnings: ["frontmatter 'user-invocable' missing"],
    points: BASE_POINTS,
  },
  {
    label: "a user-invocable that is no boolean",
    frontmatter: replaced("user-invocable:", "user-invocable: yes"),
    warnings: ["frontmatter 'user-invocable' missing"],
    points: BASE_POINTS,
  },
  {
    label: "no metadata.updated",
    frontmatter: BASE_FRONTMATTER.slice(0, 3),
    warnings: ["metadata.updated missing (YYYY-MM-DD)"],
    points: 8,
  },
  {
    label: "a metadata.updated 181 days old",
    frontmatter: replaced("  updated:", `  updated: "${daysAgo(181)}"`),
    warnings: ["metadata.updated is 181d old (>180d reads stale)"],
    points: 8,
  },
  { label: "a body of 79 lines", body: bodyLines(79), warnings: [bodyWarning(79)], points: 7 },
  { label: "a body of 311 lines", body: bodyLines(311), warnings: [bodyWarning(311)], points: 7 },
  {
    label: "slop words on two lines",
    body: ["A robust check.", "A seamless and elegant check.", ...bodyLines(78)],
    warnings: ["2 slop word(s) in prose (comprehensive/robust/elegant/seamless)"],
    points: 7,
  },
];

describe.skipIf(!SKILLS_HOST_SUPPORTED)("skill guard rules", { timeout: SPAWN_TIMEOUT_MS }, () => {
  it("passes the base skill without a warning, as a skill folder and as a root", () => {
    const fx = fixture({
      git: false,
      files: { "skills/probe/SKILL.md": skillText(BASE_FRONTMATTER, BASE_BODY) },
    });
    const lines = ["== skills/probe", scoreLine(BASE_POINTS), passed(1, 0)];
    expectRun(run("guard", ["skills/probe"], fx), 0, lines);
    expectRun(run("guard", ["skills"], fx), 0, lines);
    expectRun(run("guard", ["--strict", "skills"], fx), 0, lines);
  });

  it.each(FAILS)("FAIL: $label", ({ files, dir = "probe", lines, fails, warns, points }) => {
    const fx = fixture({
      git: false,
      files: Object.fromEntries(
        Object.entries(files).map(([path, body]) => [`skills/${dir}/${path}`, body]),
      ),
    });
    expectRun(run("guard", [`skills/${dir}`], fx), 1, [
      `== skills/${dir}`,
      ...lines,
      scoreLine(points),
      failed(fails, warns, 1),
    ]);
  });

  it.each(WARNS)(
    "WARN and FAIL(strict): $label",
    ({ frontmatter = BASE_FRONTMATTER, body = BASE_BODY, warnings, points }) => {
      const fx = fixture({
        git: false,
        files: { "skills/probe/SKILL.md": skillText(frontmatter, body) },
      });
      expectRun(run("guard", ["skills/probe"], fx), 0, [
        "== skills/probe",
        ...warnings.map((w) => `  WARN: ${w}`),
        scoreLine(points),
        passed(1, warnings.length),
      ]);
      expectRun(run("guard", ["skills/probe", "--strict"], fx), 1, [
        "== skills/probe",
        ...warnings.map((w) => `  FAIL(strict): ${w}`),
        scoreLine(points),
        failed(warnings.length, 0, 1),
      ]);
    },
  );

  it("an upstream skill with Use when inside its description and no metadata.updated gets no warning", () => {
    const fx = fixture({
      git: false,
      files: {
        "skills/probe/SKILL.md": skillText(
          [
            "name: probe",
            "description: Probes the validator; use when testing.",
            "user-invocable: true",
            "upstream:",
            `  vendored_at: "${RECENT}"`,
          ],
          BASE_BODY,
        ),
      },
    });
    expectRun(run("guard", ["skills/probe"], fx), 0, [
      "== skills/probe",
      scoreLine(9),
      passed(1, 0),
    ]);
  });

  it("a skill without a name line takes the folder name, and a metadata.updated that is no date gets no warning", () => {
    const fx = fixture({
      git: false,
      files: {
        "skills/probe/SKILL.md": skillText(
          [...replaced("name:").slice(0, -1), '  updated: "2026-13-45"'],
          BASE_BODY,
        ),
        "skills/probe/references/a.md": "# a\n",
      },
    });
    expectRun(run("guard", ["skills/probe"], fx), 0, [
      "== skills/probe",
      scoreLine(8),
      passed(1, 0),
    ]);
  });

  it("walks a root in sorted path order into nested folders and skips node_modules", () => {
    const planted = (name: string): string =>
      skillText(replaced("name:", `name: ${name}`), BASE_BODY);
    const fx = fixture({
      git: false,
      files: {
        "skills/beta/SKILL.md": planted("beta"),
        "skills/alpha/SKILL.md": planted("alpha"),
        "skills/group/nested/SKILL.md": planted("nested"),
        "skills/node_modules/hidden/SKILL.md": planted("hidden"),
      },
    });
    expectRun(run("guard", ["skills"], fx), 0, [
      "== skills/alpha",
      scoreLine(BASE_POINTS),
      "== skills/beta",
      scoreLine(BASE_POINTS),
      "== skills/group/nested",
      scoreLine(BASE_POINTS),
      passed(3, 0),
    ]);
  });

  it("a root without a skill and a path that is no folder fail on stderr, and the counts add up across arguments", () => {
    const fx = fixture({
      git: false,
      files: {
        "skills/probe/SKILL.md": skillText(replaced("user-invocable:"), BASE_BODY),
        "notes.txt": "notes\n",
      },
      dirs: ["empty"],
    });
    const result = run("guard", ["skills/probe", "empty", "missing", "notes.txt"], fx);
    expectRun(
      result,
      1,
      [
        "== skills/probe",
        "  WARN: frontmatter 'user-invocable' missing",
        scoreLine(BASE_POINTS),
        failed(3, 1, 1),
      ],
      "FAIL: no SKILL.md found under empty\nFAIL: not a directory: missing\nFAIL: not a directory: notes.txt\n",
    );
  });

  it("an argument that starts with -- other than --strict is a path", () => {
    const fx = fixture({ git: false });
    expectRun(
      run("guard", ["--per-file"], fx),
      1,
      [failed(1, 0, 0)],
      "FAIL: not a directory: --per-file\n",
    );
  });
});
