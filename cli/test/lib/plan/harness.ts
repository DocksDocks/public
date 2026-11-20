/**
 * The plan suites' harness, ported from DocksDocks/docks
 * `scripts/tests/plan-cli/harness.mjs`.
 *
 * Each case gets its own scratch git repository, fake gh state, and
 * XDG_STATE_HOME, so cases share no issue numbers, labels, or exports and
 * Vitest can run the suites in parallel. `run` spawns `docks-kit plan`
 * through the CLI test entry.
 */
import { type SpawnSyncReturns, spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, isAbsolute, join, resolve } from "node:path";
import { expect, onTestFinished } from "vitest";

import type {
  StubChange,
  StubIssue,
  StubReference,
  StubState,
} from "../../fixtures/gh-stub/state.ts";
import { BUN_RUNTIME, cliEntry } from "../cliEntry";

/**
 * `docks-kit plan` skips its waits when this variable is `1`, and appends each
 * skipped timeout in milliseconds to the file that `PLAN_CLI_WAIT_LOG` names.
 */
const SKIP_WAITS_ENV = "PLAN_CLI_SKIP_WAITS";

export const GH_STUB_DIR = resolve(import.meta.dirname, "..", "..", "fixtures", "gh-stub");
export const GH_STUB = join(GH_STUB_DIR, "gh");

/**
 * The fake gh is a script with a `#!/usr/bin/env bun` line, and
 * `docks-kit plan` starts `gh` without a shell. Windows does not start such a
 * script, so the suites that spawn a plan command run on Linux and macOS only.
 */
export const PLAN_CLI_HOST_SUPPORTED = process.platform !== "win32";

/**
 * Whether a path of this host is bytes that need not be UTF-8, which the runtime decodes with U+FFFD in place of a
 * byte that is not UTF-8. macOS paths and Windows arguments are Unicode, so their runtime strings are exact.
 */
export const PATHS_ARE_BYTES = process.platform !== "darwin" && process.platform !== "win32";
export const UNICODE_PATHS_SKIP =
  "the paths of this host are Unicode, so no byte of a path is lost";

export type PlanResult = SpawnSyncReturns<string>;

/** Run `docks-kit plan <args>` through the CLI test entry. */
export function runPlanCommand(
  args: ReadonlyArray<string>,
  options: { readonly cwd?: string; readonly env?: NodeJS.ProcessEnv } = {},
): PlanResult {
  return spawnSync(BUN_RUNTIME, [cliEntry(), "plan", ...args], {
    encoding: "utf8",
    ...options,
  });
}

/**
 * PATH with a folder that holds a `docks-kit` shim first, for the shell
 * snippets of the skills. The shim runs the CLI test entry; `root` is a
 * scratch folder of the case.
 */
export function docksKitShimEnv(root: string): Readonly<Record<string, string>> {
  const bin = join(root, "bin");
  mkdirSync(bin, { recursive: true });
  const shim = join(bin, "docks-kit");
  const quote = (word: string): string => `'${word.replaceAll("'", `'\\''`)}'`;
  writeFileSync(shim, `#!/bin/sh\nexec ${quote(BUN_RUNTIME)} ${quote(cliEntry())} "$@"\n`);
  chmodSync(shim, 0o755);
  return { PATH: `${bin}${delimiter}${process.env["PATH"] ?? ""}` };
}

// The state a repository reaches after its first `new`: every plan label exists as the fake gh
// `label create` stores it. A case that depends on label metadata replaces this map itself.
const PLAN_LABELS = ["plan", "plan:drafting", "plan:planned", "plan:ongoing", "plan:blocked"];
// A partial pull request merges at MERGED_AT, and GitHub records its close 2 s later, as it did for #89.
const MERGED_AT = "2026-08-21T00:00:00Z";
const CLOSED_AT = "2026-08-21T00:00:02Z";

export function expectSuccess(result: PlanResult, label: string): void {
  expect(result.status, `${label}: ${result.stderr}`).toBe(0);
}

export function refuse(result: PlanResult, message: string): void {
  expect(result.status, message).toBe(1);
  expect(result.stderr).toBe(`${message}\n`);
}

// A plan body as the helper writes it. A new plan is v5; a case that covers the v4 partial-pull-request flow passes 4.
export function body(status = "planned", version = 5): string {
  return [
    `<!-- plan-contract: v${version} -->`,
    "",
    "## Goal",
    "",
    "Fix the parser.",
    "",
    "Mode: plan-and-implement",
    "",
    "## Research",
    "",
    "The parser loses mixed-case records.",
    "",
    "## Steps",
    "",
    "| # | Id | Task | Files | Depends | Effect | Status | Done when |",
    "|---:|---|---|---|---|---|---|---|",
    `| 1 | fix_parser | Fix parser | src/parser.mjs | - | local | ${status} | Records round-trip |`,
    "",
    "## Acceptance",
    "",
    "| ID | Command | Expected |",
    "|---|---|---|",
    "| A1 | node smoke.mjs | Exit 0 |",
    "",
    "## Do not touch",
    "",
    "Release tooling.",
    "",
    "## Open questions",
    "",
    "None.",
    "",
    "## Verification Results",
    "",
    "Not run.",
    "",
  ].join("\n");
}

// The change GitHub makes when `closer` closes a plan as completed, for a scheduled change of the fake gh.
export function closedBy(closer: StubReference | null, createdAt = CLOSED_AT): StubChange {
  return { state: "CLOSED", stateReason: "COMPLETED", closedEvent: { closer, createdAt } };
}

type PullRequestOptions = {
  readonly merged?: boolean;
  readonly closes?: boolean;
  readonly base?: string;
  readonly description?: string | null;
};

// Pull request 100 + `number` as the fake gh stores it in state.prs. Like a pull request from the plan's linked branch,
// it lists the plan in closingIssuesReferences unless `closes` is false. It merged into `base` unless `merged` is false.
function pullRequestEntry(
  number: number,
  { merged = true, closes = true, base = "main", description }: PullRequestOptions = {},
): StubState["prs"][number] & { url: string } {
  const pr = 100 + number;
  return {
    number: pr,
    url: `https://github.com/DocksDocks/fixture/pull/${pr}`,
    state: merged ? "MERGED" : "OPEN",
    mergedAt: merged ? MERGED_AT : null,
    baseRefName: base,
    // JSON drops an undefined description, as the docks harness stored it.
    ...(description !== undefined && { body: description }),
    repository: "DocksDocks/fixture",
    closingIssuesReferences: closes ? [number] : [],
  };
}

function git(cwd: string, args: ReadonlyArray<string>): void {
  const result = spawnSync("git", args, { cwd, encoding: "utf8" });
  expect(result.status, result.stderr).toBe(0);
}

export type LandedPlanOptions = {
  readonly status?: string;
  readonly base?: string;
  readonly prBody?: string | null;
  readonly merged?: boolean;
};

export type PartialMergeOptions = {
  readonly assignees?: Array<string>;
  readonly merged?: boolean;
  readonly closes?: boolean;
  readonly version?: number;
};

export type LandedPlan = {
  readonly number: number;
  readonly pr: number;
  readonly closer: StubReference & { __typename: "PullRequest"; number: number; url: string };
};

export type PartialMerge = {
  readonly number: number;
  readonly pr: number;
  readonly closer: StubReference & { __typename: "PullRequest"; number: number };
};

/** The scratch repository of one case and the commands that read and change it. */
export type PlanCliContext = {
  /** The scratch repository, the working directory of every plan command. */
  readonly scratch: string;
  readonly run: (...args: ReadonlyArray<string>) => PlanResult;
  readonly runSkippingWaits: (...args: ReadonlyArray<string>) => PlanResult;
  readonly waits: () => Array<number>;
  readonly writes: () => Array<Array<string>>;
  readonly schedule: (number: number, ...changes: Array<StubChange>) => void;
  readonly loadState: () => StubState;
  readonly updateState: (update: (state: StubState) => void) => void;
  readonly issue: (number: number) => StubIssue;
  readonly updateIssue: (number: number, update: (entry: StubIssue) => void) => void;
  readonly addIssueComment: (number: number, text: string, author?: string) => void;
  readonly createPlan: (name: string, text?: string) => number;
  readonly createChild: (
    name: string,
    parent: number,
  ) => { readonly number: number; readonly result: PlanResult };
  readonly exported: (number: number) => string;
  readonly edit: (number: number, transform?: (text: string) => string) => PlanResult;
  readonly landedPlan: (name: string, options?: LandedPlanOptions) => LandedPlan;
  readonly closedPlan: (name: string, options?: LandedPlanOptions) => LandedPlan;
  readonly partialMerge: (name: string, options?: PartialMergeOptions) => PartialMerge;
};

/**
 * A scratch repository, fake gh state, and state home for one case. Call it
 * inside the case: the folders go away when the case finishes.
 */
export function planCliContext(): PlanCliContext {
  const scratch = realpathSync(mkdtempSync(join(tmpdir(), "plan-cli-")));
  const stateHome = realpathSync(mkdtempSync(join(tmpdir(), "plan-cli-state-")));
  onTestFinished(() => {
    rmSync(scratch, { recursive: true, force: true });
    rmSync(stateHome, { recursive: true, force: true });
  });
  const statePath = join(scratch, "gh-state.json");
  const waitLog = join(scratch, "waits.log");
  git(scratch, ["init", "--quiet"]);
  git(scratch, [
    "-c",
    "user.name=Plan CLI test",
    "-c",
    "user.email=plan-cli@example.invalid",
    "-c",
    "commit.gpgsign=false",
    "commit",
    "--quiet",
    "--allow-empty",
    "-m",
    "fixture",
  ]);
  const initial: StubState = {
    repo: {
      nameWithOwner: "DocksDocks/fixture",
      visibility: "PRIVATE",
      defaultBranchRef: { name: "main" },
    },
    repositoryDefaults: { "DocksDocks/fixture": "main" },
    viewerLogin: "plan-agent",
    labels: Object.fromEntries(PLAN_LABELS.map((name) => [name, { color: "ededed" }])),
    issues: [],
    prs: [],
    nextIssue: 1,
    nextComment: 1,
    clock: 0,
    calls: [],
  };
  writeFileSync(statePath, `${JSON.stringify(initial, null, 2)}\n`);
  const childEnv = {
    ...process.env,
    PATH: `${GH_STUB_DIR}${delimiter}${process.env["PATH"] ?? ""}`,
    GH_STUB_STATE: statePath,
    XDG_STATE_HOME: stateHome,
    PLAN_CLI_WAIT_LOG: waitLog,
  };

  function spawnPlan(args: ReadonlyArray<string>, skipWaits: boolean): PlanResult {
    return runPlanCommand(args, {
      cwd: scratch,
      env: skipWaits ? { ...childEnv, [SKIP_WAITS_ENV]: "1" } : childEnv,
    });
  }

  function run(...args: ReadonlyArray<string>): PlanResult {
    return spawnPlan(args, false);
  }

  // The waits of `reopen` and `archive` return at once, and `waits()` lists their timeouts.
  function runSkippingWaits(...args: ReadonlyArray<string>): PlanResult {
    return spawnPlan(args, true);
  }

  // The timeouts that the skipped waits received, in call order.
  function waits(): Array<number> {
    if (!existsSync(waitLog)) return [];
    return readFileSync(waitLog, "utf8").split("\n").filter(Boolean).map(Number);
  }

  function loadState(): StubState {
    return JSON.parse(readFileSync(statePath, "utf8")) as StubState;
  }

  function updateState(update: (state: StubState) => void): void {
    const state = loadState();
    update(state);
    writeFileSync(statePath, `${JSON.stringify(state, null, 2)}\n`);
  }

  function findIssue(state: StubState, number: number): StubIssue {
    const entry = state.issues.find((candidate) => candidate.number === number);
    if (entry === undefined) throw new Error(`the fake gh state has no issue #${number}`);
    return entry;
  }

  function issue(number: number): StubIssue {
    return findIssue(loadState(), number);
  }

  function updateIssue(number: number, update: (entry: StubIssue) => void): void {
    updateState((state) => update(findIssue(state, number)));
  }

  // The gh calls that write: GraphQL mutations and every non-api command other than `view` and `list`.
  function writes(): Array<Array<string>> {
    return loadState().calls.filter(([group, command, ...rest]) => {
      if (group !== "api") return !["view", "list"].includes(command ?? "");
      return (
        command === "graphql" && rest.some((argument) => /^query=\s*mutation\b/.test(argument))
      );
    });
  }

  // Each change lands once the fake gh has served `afterReads` GraphQL reads of the issue.
  function schedule(number: number, ...changes: Array<StubChange>): void {
    updateIssue(number, (entry) => {
      entry.pendingChanges = [...(entry.pendingChanges ?? []), ...changes];
    });
  }

  function addIssueComment(number: number, text: string, author = "plan-agent"): void {
    updateState((state) => {
      const entry = findIssue(state, number);
      state.nextComment ??= 1;
      const id = state.nextComment++;
      entry.comments ??= [];
      entry.comments.push({
        id,
        body: text,
        author,
        createdAt: new Date(Date.parse("2026-08-20T20:00:00Z") + id * 1000).toISOString(),
      });
    });
  }

  function createdNumber(stdout: string, label: string): number {
    const match = /^plan created: #(\d+) (https:\/\/\S+)$/m.exec(stdout);
    expect(match, `${label} prints the issue identity`).not.toBeNull();
    return Number(match?.[1]);
  }

  function createPlan(name: string, text = body()): number {
    const result = run("new", "--title", name, "--goal", "Preserve plan records");
    expectSuccess(result, `new ${name}`);
    const number = createdNumber(result.stdout, "new");
    updateIssue(number, (entry) => {
      entry.body = text;
    });
    return number;
  }

  function exported(number: number): string {
    const result = run("export", String(number));
    expectSuccess(result, "export");
    const file = result.stdout.trim();
    expect(isAbsolute(file), "export returns an absolute file path").toBe(true);
    return file;
  }

  function edit(number: number, transform: (text: string) => string = (text) => text): PlanResult {
    const file = exported(number);
    writeFileSync(file, transform(readFileSync(file, "utf8")));
    return run("edit", String(number), "--file", file);
  }

  // A plan whose work landed: every step has `status`, the plan carries `plan:ongoing` and a trusted
  // `code-review: pass`, and its pull request 100 + number merged into `base` (or is still open when `merged` is
  // false) with the description `prBody`, where ISSUE stands for the plan number. The plan still reads OPEN, as
  // when GitHub has not closed it for the merge. The call log then holds only what the case itself runs.
  function landedPlan(
    name: string,
    {
      status = "done",
      base = "main",
      prBody = "Closes #ISSUE",
      merged = true,
    }: LandedPlanOptions = {},
  ): LandedPlan {
    const number = createPlan(name, body(status));
    const description = prBody?.replaceAll("ISSUE", String(number)) ?? null;
    const pullRequest = pullRequestEntry(number, { merged, base, description });
    addIssueComment(number, "### Code review (round 2)\n\ncode-review: pass");
    updateState((state) => {
      findIssue(state, number).labels = ["plan", "plan:ongoing"];
      state.prs.push(pullRequest);
      state.calls = [];
    });
    const { number: pr, url } = pullRequest;
    return { number, pr, closer: { __typename: "PullRequest", number: pr, url } };
  }

  // A landed plan that its pull request closed as completed.
  function closedPlan(name: string, options?: LandedPlanOptions): LandedPlan {
    const plan = landedPlan(name, options);
    updateIssue(plan.number, (entry) => {
      entry.state = "CLOSED";
      entry.stateReason = "COMPLETED";
      entry.timelineItems = [{ __typename: "ClosedEvent", closer: plan.closer }];
    });
    return plan;
  }

  // An ongoing plan after the merge of a partial pull request that lists it in closingIssuesReferences.
  // The plan still reads OPEN: a case schedules the close that GitHub records a while after the merge. Only a v4 plan
  // has this flow, so the plan is v4 unless `version` says otherwise.
  function partialMerge(
    name: string,
    { assignees = [], merged = true, closes = true, version = 4 }: PartialMergeOptions = {},
  ): PartialMerge {
    const number = createPlan(name, body("in-flight", version));
    const pr = 100 + number;
    updateState((state) => {
      const entry = findIssue(state, number);
      entry.labels = ["plan", "plan:ongoing"];
      entry.assignees = assignees;
      state.prs.push(pullRequestEntry(number, { merged, closes }));
      // The call log then holds only what the case itself runs.
      state.calls = [];
    });
    return { number, pr, closer: { __typename: "PullRequest", number: pr } };
  }

  // A child plan that `new --parent` creates under `parent`, with the result of that command.
  function createChild(name: string, parent: number): { number: number; result: PlanResult } {
    const result = run(
      "new",
      "--title",
      name,
      "--goal",
      "Land one pull request",
      "--parent",
      String(parent),
    );
    expectSuccess(result, `new --parent ${parent}`);
    return { number: createdNumber(result.stdout, "new --parent"), result };
  }

  return {
    scratch,
    run,
    runSkippingWaits,
    waits,
    writes,
    schedule,
    loadState,
    updateState,
    issue,
    updateIssue,
    addIssueComment,
    createPlan,
    createChild,
    exported,
    edit,
    landedPlan,
    closedPlan,
    partialMerge,
  };
}
