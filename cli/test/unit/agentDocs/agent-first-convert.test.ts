import { describe, expect, it } from "vitest";

import type { HelperResult } from "../../lib/agentDocs/entry";
import {
  AGENT_DOCS_HOST_SUPPORTED,
  ROOT_AGENTS,
  expectRun,
  expectUsage,
  fixture,
  run,
  treeEntries,
} from "../../lib/agentDocs/harness";
import { SPAWN_TIMEOUT_MS } from "../../lib/spawnTimeout";

const AGENT_PATH = ".claude/agents/rev.md";
const AGENT_NAME = "name: rev";
const AGENT_DESCRIPTION = "description: Reviews a diff for bugs.";
const claudeAgent = (...fields: ReadonlyArray<string>): string =>
  `---\n${fields.join("\n")}\n---\n\nYou review diffs.\n`;

// One convert-agent run on a Claude agent file; the run must leave every entry of the fixture as it was.
function convertAgent(text: string, args: ReadonlyArray<string> = [AGENT_PATH]): HelperResult {
  const fx = fixture({ files: { "AGENTS.md": ROOT_AGENTS, [AGENT_PATH]: text } });
  const before = treeEntries(fx.dir);
  const result = run("agent-first", ["convert-agent", ...args], fx);
  expect(treeEntries(fx.dir), "convert-agent writes no file").toEqual(before);
  return result;
}

/** The omp agent text that a converted agent with these frontmatter lines prints. */
const converted = (...fields: ReadonlyArray<string>): Array<string> => [
  "---",
  ...fields,
  "---",
  "",
  "You review diffs.",
];

/** A refusal: one ERROR line that names the agent file and the reason, exit 2, and nothing on stderr. */
function expectRefusalOf(result: HelperResult, reason: string): void {
  expectRun(result, 2, [`ERROR convert-agent ${AGENT_PATH}: ${reason}; port it by hand`]);
}

function expectRefusal(fields: ReadonlyArray<string>, reason: string): void {
  expectRefusalOf(convertAgent(claudeAgent(AGENT_NAME, AGENT_DESCRIPTION, ...fields)), reason);
}

describe.skipIf(!AGENT_DOCS_HOST_SUPPORTED)(
  "agent-first convert-agent",
  { timeout: SPAWN_TIMEOUT_MS },
  () => {
    it("prints the omp agent text of a simple agent with tools: read, grep, names the dropped model, color, and effort on stderr, and writes no file", () => {
      const result = convertAgent(
        claudeAgent(
          AGENT_NAME,
          AGENT_DESCRIPTION,
          "tools: Read, Grep",
          "model: sonnet",
          "color: blue",
          "effort: high",
        ),
      );
      expectRun(
        result,
        0,
        converted(AGENT_NAME, AGENT_DESCRIPTION, "tools: read, grep"),
        `convert-agent: dropped model, color, effort of ${AGENT_PATH}; omp does not read these Claude values (a Claude model alias fails in omp)\n`,
      );
    });

    it("maps Read, Grep, Glob, Bash, Edit, Write, and WebSearch to their omp names", () => {
      const tools = "tools: Read, Grep, Glob, Bash, Edit, Write, WebSearch";
      expectRun(
        convertAgent(claudeAgent(AGENT_NAME, AGENT_DESCRIPTION, tools)),
        0,
        converted(
          AGENT_NAME,
          AGENT_DESCRIPTION,
          "tools: read, grep, glob, bash, edit, write, web_search",
        ),
      );
    });

    it("a missing path or a second path is a usage error", () => {
      const text = claudeAgent(AGENT_NAME, AGENT_DESCRIPTION, "tools: Read");
      expectUsage(convertAgent(text, []), "agent-first");
      expectUsage(convertAgent(text, [AGENT_PATH, AGENT_PATH]), "agent-first");
    });

    it("refuses an agent without a tools list", () => {
      expectRefusal(["model: sonnet"], "no tools list");
    });

    it("refuses disallowedTools, also when no tools list is there", () => {
      expectRefusal(["disallowedTools: Write, Edit, Bash"], "disallowedTools has no omp form");
    });

    it("refuses a tool with no omp name", () => {
      expectRefusal(["tools: Read, WebFetch"], "tool WebFetch has no omp name");
    });

    it("refuses a tool with a pattern", () => {
      expectRefusal(["tools: Read, Bash(git status)"], "tool Bash(git status) has a pattern");
    });

    it("refuses permissionMode", () => {
      expectRefusal(
        ["tools: Read", "permissionMode: plan"],
        "field permissionMode has no omp form",
      );
    });

    it("refuses an unknown field", () => {
      expectRefusal(["tools: Read", "unknownField: yes"], "field unknownField has no omp form");
    });

    it("refuses an agent without name or without description", () => {
      for (const [fields, reason] of [
        [[AGENT_DESCRIPTION, "tools: Read"], "no name field"],
        [[AGENT_NAME, "tools: Read"], "no description field"],
      ] as const) {
        expectRefusalOf(convertAgent(claudeAgent(...fields)), reason);
      }
    });

    // Each value leaves the field empty after its comment and its outer quotes go.
    it("refuses an empty or null name or description", () => {
      for (const value of [
        "",
        ' ""',
        " ''",
        " ~",
        " null",
        " NULL",
        " # no value",
        ' "" # empty',
      ]) {
        for (const [fields, reason] of [
          [[`name:${value}`, AGENT_DESCRIPTION, "tools: Read"], "no name field"],
          [[AGENT_NAME, `description:${value}`, "tools: Read"], "no description field"],
        ] as const) {
          expectRefusalOf(convertAgent(claudeAgent(...fields)), reason);
        }
      }
    });

    it("refuses a field that appears twice", () => {
      expectRefusal(["tools: Read", "tools: Grep"], "field tools appears twice");
      expectRefusalOf(
        convertAgent(claudeAgent(AGENT_NAME, AGENT_NAME, AGENT_DESCRIPTION, "tools: Read")),
        "field name appears twice",
      );
    });

    it("refuses a name that omp reserves, in any letter case and quoted", () => {
      for (const [value, name] of [
        ["main", "main"],
        ["sub", "sub"],
        ["Main", "Main"],
        ['"sub" # quoted', "sub"],
      ] as const) {
        expectRefusalOf(
          convertAgent(claudeAgent(`name: ${value}`, AGENT_DESCRIPTION, "tools: Read")),
          `name ${name} is reserved in omp`,
        );
      }
    });

    it("refuses a name that is no safe file name", () => {
      for (const name of [
        "Rev",
        "my agent",
        "../rev",
        "team/rev",
        "rev-",
        "-rev",
        "rev--x",
        "rev_x",
        "rev.md",
      ]) {
        expectRefusalOf(
          convertAgent(claudeAgent(`name: ${name}`, AGENT_DESCRIPTION, "tools: Read")),
          `name ${name} is not a safe file name`,
        );
      }
    });

    it("writes the name without its quotes and comment", () => {
      const result = convertAgent(
        claudeAgent('name: "code-review-2" # the reviewer', AGENT_DESCRIPTION, "tools: Read"),
      );
      expectRun(result, 0, converted("name: code-review-2", AGENT_DESCRIPTION, "tools: read"));
    });

    // omp parses the frontmatter as YAML and skips an agent whose name or description is no string. A YAML 1.2
    // core-schema reader reads each value as a boolean, a number, a flow collection, an alias, a block sequence, a block
    // mapping, or a reserved indicator, not as a string.
    it("refuses a name or description that is no YAML string", () => {
      const tools = "tools: Read";
      for (const value of ["true", "TRUE", "False", "123", "0x1f", "1e5", "[rev]", "{a: b}"]) {
        expectRefusalOf(
          convertAgent(claudeAgent(`name: ${value}`, AGENT_DESCRIPTION, tools)),
          "name is no YAML string",
        );
      }
      for (const lines of [
        ["description: [review]"],
        ["description: true"],
        ["description: True # a comment"],
        ["description: 42"],
        ["description: -7"],
        ["description: 1.5"],
        ["description: 2e3"],
        ["description: 0x1F"],
        ["description: 0o17"],
        ["description: .inf"],
        ["description: -.Inf"],
        ["description: .NaN"],
        ["description: {a: b}"],
        ["description: *d"],
        ["description: - Reviews a diff."],
        ["description: ? Reviews a diff."],
        ["description: %Reviews"],
        ["description: @Reviews"],
        ["description: `Reviews`"],
        ["description:", "  - Reviews a diff.", "  - Finds bugs."],
        ["description: # the list", "- Reviews a diff."],
        ["description:", "  [review]"],
      ]) {
        expectRefusalOf(
          convertAgent(claudeAgent(AGENT_NAME, ...lines, tools)),
          "description is no YAML string",
        );
      }
    });

    it("refuses a block mapping value as no YAML string; a colon in a block scalar, in quotes, or before no space is text", () => {
      for (const lines of [
        ["description:", "  purpose: review"],
        ["description:", "  purpose:"],
        ["description: # the mapping", "  review: diff", "  scope: all"],
        ["description:", '  "purpose": review'],
        ["description:", "  'purpose':\treview"],
        ["description: Reviews a diff", "  scope: all"],
        ["description: Reviews a diff", "  for bugs.", "  scope: all # a comment"],
      ]) {
        expectRefusalOf(
          convertAgent(claudeAgent(AGENT_NAME, ...lines, "tools: Read")),
          "description is no YAML string",
        );
      }
      expectRefusalOf(
        convertAgent(claudeAgent("name:", "  rev: x", AGENT_DESCRIPTION, "tools: Read")),
        "name is no YAML string",
      );
      for (const lines of [
        ["description: |", "  purpose: review"],
        ["description:", '  "purpose: review"'],
        ["description: Reviews a diff", "  for bugs."],
        ["description: Reviews a diff", "  at https://example.com/x for bugs."],
      ]) {
        expectRun(
          convertAgent(claudeAgent(AGENT_NAME, ...lines, "tools: Read")),
          0,
          converted(AGENT_NAME, ...lines, "tools: read"),
        );
      }
    });

    it("refuses a block scalar without content lines as an empty field", () => {
      for (const lines of [
        ["description: |"],
        ["description: >-"],
        ["description: |+ # empty"],
        ["description: >2", "", "  "],
        ["description:", "  |"],
      ]) {
        expectRefusalOf(
          convertAgent(claudeAgent(AGENT_NAME, ...lines, "tools: Read")),
          "no description field",
        );
      }
      expectRefusalOf(
        convertAgent(claudeAgent("name: >", AGENT_DESCRIPTION, "tools: Read")),
        "no name field",
      );
    });

    it("refuses a block scalar header that is not valid, and converts each valid header form", () => {
      for (const header of ["|x", ">x", "| x", "|0", "|--", ">+-", "|2-3", "|#c", ">10"]) {
        expectRefusalOf(
          convertAgent(
            claudeAgent(AGENT_NAME, `description: ${header}`, "  Reviews a diff.", "tools: Read"),
          ),
          "description is no YAML string",
        );
      }
      for (const header of ["|", ">", "|-", ">+", "|2", ">2-", "|-2", "> # folded"]) {
        const lines = [`description: ${header}`, "  Reviews a diff."];
        expectRun(
          convertAgent(claudeAgent(AGENT_NAME, ...lines, "tools: Read")),
          0,
          converted(AGENT_NAME, ...lines, "tools: read"),
        );
      }
    });

    it("refuses a plain value that starts with ], }, or , as no YAML string", () => {
      for (const value of ["] Reviews a diff.", "}Reviews", ", Reviews a diff."]) {
        expectRefusalOf(
          convertAgent(claudeAgent(AGENT_NAME, `description: ${value}`, "tools: Read")),
          "description is no YAML string",
        );
      }
      expectRefusalOf(
        convertAgent(claudeAgent("name: ,rev", AGENT_DESCRIPTION, "tools: Read")),
        "name is no YAML string",
      );
    });

    it("refuses a name or description with a YAML anchor or tag", () => {
      for (const lines of [
        ["description: &d Reviews a diff."],
        ["description: !tag Reviews a diff."],
        ["description: !!str 5"],
        ["description:", "  &d Reviews a diff."],
      ]) {
        expectRefusalOf(
          convertAgent(claudeAgent(AGENT_NAME, ...lines, "tools: Read")),
          "description uses a YAML anchor or tag",
        );
      }
      for (const value of ["&n rev", "!!str rev"]) {
        expectRefusalOf(
          convertAgent(claudeAgent(`name: ${value}`, AGENT_DESCRIPTION, "tools: Read")),
          "name uses a YAML anchor or tag",
        );
      }
    });

    // The YAML 1.2 core schema reads only these spellings as a boolean, a special float, a number, or a null.
    it("refuses only the core-schema spellings of a boolean, a special float, and a number; other spellings convert", () => {
      for (const value of [
        "true",
        "True",
        "TRUE",
        "false",
        "False",
        "FALSE",
        ".inf",
        ".Inf",
        ".INF",
        "+.inf",
        "-.INF",
        ".nan",
        ".NaN",
        ".NAN",
        "1E5",
        "0x1f",
      ]) {
        expectRefusalOf(
          convertAgent(claudeAgent(AGENT_NAME, `description: ${value}`, "tools: Read")),
          "description is no YAML string",
        );
      }
      for (const value of [
        "tRue",
        "fALSE",
        "TRue",
        ".iNf",
        "-.InF",
        ".nAn",
        ".Nan",
        "0X1F",
        "0O17",
        "nUll",
      ]) {
        expectRun(
          convertAgent(claudeAgent(AGENT_NAME, `description: ${value}`, "tools: Read")),
          0,
          converted(AGENT_NAME, `description: ${value}`, "tools: read"),
        );
      }
      expectRefusalOf(
        convertAgent(claudeAgent(AGENT_NAME, "description: Null", "tools: Read")),
        "no description field",
      );
    });

    it("converts a quoted or block scalar description and a plain one that only starts like a number; quotes a name that would read as no string", () => {
      for (const lines of [
        ['description: "true"'],
        ["description: '42'"],
        ['description: "[review]" # quoted'],
        ["description: >-", "  Reviews a diff", "  for bugs."],
        ["description: |", "  Reviews a diff."],
        ["description:", '  "true"'],
        ["description: true story"],
        ["description: 42 reviews"],
        ["description: Reviews [a] diff - for bugs."],
      ]) {
        expectRun(
          convertAgent(claudeAgent(AGENT_NAME, ...lines, "tools: Read")),
          0,
          converted(AGENT_NAME, ...lines, "tools: read"),
        );
      }
      for (const [value, name] of [
        ['"123"', '"123"'],
        ["'true' # quoted", '"true"'],
      ] as const) {
        expectRun(
          convertAgent(claudeAgent(`name: ${value}`, AGENT_DESCRIPTION, "tools: Read")),
          0,
          converted(`name: ${name}`, AGENT_DESCRIPTION, "tools: read"),
        );
      }
    });

    it("converts each tools form: comma list, quoted scalar, trailing comment, flow list, block list, with comments", () => {
      const expected = converted(AGENT_NAME, AGENT_DESCRIPTION, "tools: read, grep");
      for (const tools of [
        ["tools: Read, Grep"],
        ['tools: "Read, Grep"'],
        ["tools: 'Read, Grep'"],
        ['tools: "Read", "Grep"'],
        ["tools: Read, Grep # the reviewer reads only"],
        ["tools: [Read, Grep]"],
        ["tools: [\"Read\", 'Grep']"],
        ["tools: [Read, Grep] # the reviewer reads only"],
        ["tools:", "  - Read", "  - Grep"],
        ["tools:", '  - "Read" # reads files', "  - Grep # searches"],
        ["tools: # the list", "  - Read", "  # a comment line", "  - Grep"],
      ]) {
        expectRun(convertAgent(claudeAgent(AGENT_NAME, AGENT_DESCRIPTION, ...tools)), 0, expected);
      }
    });

    it("a # inside quotes is no comment", () => {
      expectRefusal(['tools: "Read # not a comment"'], "tool Read # not a comment has no omp name");
    });

    it("refuses a file without frontmatter and a frontmatter line that is no field", () => {
      for (const text of [
        "You review diffs.\n",
        `---\n${AGENT_NAME}\n${AGENT_DESCRIPTION}\ntools: Read\n`,
      ]) {
        expectRefusalOf(convertAgent(text), "no frontmatter");
      }
      expectRefusal(["tools: Read", "just text"], 'frontmatter line "just text" is no field');
    });

    it("a missing file prints the ERROR line and names the cause on stderr", () => {
      const missing = ".claude/agents/missing.md";
      const text = claudeAgent(AGENT_NAME, AGENT_DESCRIPTION, "tools: Read");
      expectRun(
        convertAgent(text, [missing]),
        2,
        [`ERROR convert-agent ${missing}: cannot read the file`],
        `agent-first-check: cannot read ${missing} (ENOENT)\n`,
      );
    });
  },
);
