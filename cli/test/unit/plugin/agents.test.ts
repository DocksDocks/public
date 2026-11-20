import { cpSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  checkAgentFiles,
  checkAgentGuard,
  scoreAgent,
  scoreAgents,
} from "../../../scripts/pluginContent/agents.ts";
import config from "../../../scripts/pluginContent/config.json" with { type: "json" };

/**
 * The docks agent checks (`gateAgentFiles` of `scripts/ci.mjs`,
 * `scripts/agents/guard.mjs`, and `scripts/agents/score.mjs` with its floor),
 * ported to the kit plugin agents.
 */
const REPO_ROOT = resolve(import.meta.dirname, "..", "..", "..", "..");
const AGENTS = `${config.pluginDir}/agents`;
const REVIEWER = `${AGENTS}/code-reviewer.md`;

const fixtures: Array<string> = [];

afterEach(() => {
  for (const root of fixtures.splice(0)) rmSync(root, { recursive: true, force: true });
});

/** A temporary repository root with a copy of the kit plugin agents. */
function copyFixture(): string {
  const root = mkdtempSync(join(tmpdir(), "kit-plugin-agents-"));
  fixtures.push(root);
  cpSync(join(REPO_ROOT, AGENTS), join(root, AGENTS), { recursive: true });
  return root;
}

function edit(root: string, relative: string, change: (text: string) => string): void {
  const file = join(root, relative);
  const before = readFileSync(file, "utf8");
  const after = change(before);
  expect(after, `the planted change did not change ${relative}`).not.toBe(before);
  writeFileSync(file, after);
}

function expectFailure(failures: ReadonlyArray<string>, file: string, detail: string): void {
  expect(
    failures.some((failure) => failure.includes(file) && failure.includes(detail)),
    `no failure names ${file} with "${detail}"; failures: ${JSON.stringify(failures)}`,
  ).toBe(true);
}

describe("kit plugin agents: live tree", () => {
  it("passes the agent file gate and the agent guard", () => {
    expect(checkAgentFiles(REPO_ROOT)).toEqual([]);
    expect(checkAgentGuard(REPO_ROOT)).toEqual([]);
  });

  it("scores each agent at or above the floor", () => {
    const result = scoreAgents(REPO_ROOT);
    expect(result.failures).toEqual([]);
    const onDisk = readdirSync(join(REPO_ROOT, AGENTS))
      .filter((name) => name.endsWith(".md"))
      .sort()
      .map((name) => name.replace(/\.md$/u, ""));
    expect(onDisk.length).toBeGreaterThan(0);
    expect(result.rows.map((row) => row.name)).toEqual(onDisk);
    for (const row of result.rows) {
      expect(row.score, row.name).toBeGreaterThanOrEqual(config.floors.agents);
    }
  });
});

describe("kit plugin agents: planted violations", () => {
  it("fails a model key", () => {
    const root = copyFixture();
    edit(root, REVIEWER, (text) => text.replace("tools: ", "model: some-model\ntools: "));
    expectFailure(checkAgentFiles(root), REVIEWER, "has a model key");
    expectFailure(checkAgentGuard(root), REVIEWER, "remove 'model: some-model'");
  });

  it("fails a missing description", () => {
    const root = copyFixture();
    edit(root, REVIEWER, (text) => text.replace(/^description: .*\n/m, ""));
    expectFailure(checkAgentFiles(root), REVIEWER, "has no description");
    expectFailure(checkAgentGuard(root), REVIEWER, "description missing or too short");
  });

  it("fails a ${VAR} variable", () => {
    const root = copyFixture();
    edit(root, REVIEWER, (text) => `${text}\nRead \${PLUGIN_ROOT}/notes.md.\n`);
    expectFailure(checkAgentFiles(root), REVIEWER, "names ${PLUGIN_ROOT}, which omp does not set");
    expectFailure(checkAgentGuard(root), REVIEWER, "remove ${PLUGIN_ROOT}");
  });

  it("fails a body without a <constraint> block", () => {
    const root = copyFixture();
    edit(root, REVIEWER, (text) => text.replaceAll("<constraint>", "<rule>"));
    expectFailure(checkAgentGuard(root), REVIEWER, "no <constraint> block in body");
  });

  it("fails a SKILL.md named by a file path", () => {
    const root = copyFixture();
    edit(root, REVIEWER, (text) => `${text}\nRead skills/code-reviewer/SKILL.md first.\n`);
    expectFailure(checkAgentGuard(root), REVIEWER, "must load via skill://<skill>/SKILL.md");
  });

  it("fails a name that differs from the file name", () => {
    const root = copyFixture();
    edit(root, REVIEWER, (text) => text.replace("name: code-reviewer", "name: reviewer"));
    expectFailure(checkAgentGuard(root), REVIEWER, "does not match filename");
  });

  it("fails a description without the Use when prefix or a Not clause", () => {
    const root = copyFixture();
    edit(root, REVIEWER, (text) =>
      text.replace(/^description: .*$/m, "description: Reviews a candidate diff for the plan."),
    );
    const failures = checkAgentGuard(root);
    expectFailure(failures, REVIEWER, "must start with 'Use when'");
    expectFailure(failures, REVIEWER, "exclusion clause");
  });

  it("fails missing tools, Workflow, and Success Criteria", () => {
    const root = copyFixture();
    edit(root, REVIEWER, (text) =>
      text
        .replace(/^tools: .*\n/m, "")
        .replace(/^## Workflow/m, "## Steps")
        .replace(/^## Success Criteria/m, "## Done"),
    );
    const failures = checkAgentGuard(root);
    expectFailure(failures, REVIEWER, "tools field missing or empty");
    expectFailure(failures, REVIEWER, "missing '## Workflow' section");
    expectFailure(failures, REVIEWER, "missing '## Success Criteria' section");
  });

  it("fails a reserved name and the Agent tool", () => {
    const root = copyFixture();
    const file = `${AGENTS}/main.md`;
    writeFileSync(
      join(root, file),
      readFileSync(join(root, REVIEWER), "utf8")
        .replace("name: code-reviewer", "name: main")
        .replace(/^tools: .*$/m, "tools: read, Agent"),
    );
    const failures = checkAgentGuard(root);
    expectFailure(failures, file, "is reserved");
    expectFailure(failures, file, "'Agent' is not an omp tool name");
  });

  it("fails an agent below the per-file floor", () => {
    const root = copyFixture();
    writeFileSync(
      join(root, AGENTS, "weak.md"),
      "---\nname: weak\ndescription: Use when weak.\ntools: read\n---\n\nWeak.\n",
    );
    expectFailure(
      scoreAgents(root).failures,
      "weak",
      `below per-file floor ${config.floors.agents}`,
    );
  });

  it("scores the rubric points", () => {
    const content = readFileSync(join(REPO_ROOT, REVIEWER), "utf8");
    const full = scoreAgent(content);
    expect(full).toBeGreaterThanOrEqual(config.floors.agents);
    expect(scoreAgent(content.replace("tools: ", "model: x\ntools: "))).toBe(full - 1);
    expect(scoreAgent(content.replace(/^## Workflow/m, "## Steps"))).toBe(full - 1);
  });
});
