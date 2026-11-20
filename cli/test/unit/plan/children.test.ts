import { describe, expect, it } from "vitest";

import type { StubChange, StubIssue } from "../../fixtures/gh-stub/state.ts";
import {
  PLAN_CLI_HOST_SUPPORTED,
  type PlanCliContext,
  type PlanResult,
  body,
  closedBy,
  expectSuccess,
  planCliContext,
  refuse,
} from "../../lib/plan/harness";
import { SPAWN_TIMEOUT_MS } from "../../lib/spawnTimeout";

// Child plans (E1) and the contract marker (E2): `new --parent`, the child lines of `show`, and the parent archive.

// The Steps rows of a parent: one row per child plan, with Files `-` and Done when `child #<c> finished`.
function parentRows(children: ReadonlyArray<number>, status = "done"): Array<string> {
  return children.map(
    (child, index) =>
      `| ${index + 1} | land_${child} | Land child plan #${child} | - | - | local | ${status} | child #${child} finished |`,
  );
}

// Replace the Steps rows of plan `number`.
function setSteps(context: PlanCliContext, number: number, rows: ReadonlyArray<string>): void {
  context.updateIssue(number, (entry) => {
    entry.body = body().replace(/^\| 1 \| fix_parser .*$/m, rows.join("\n"));
  });
}

// An open, ongoing plan owned by the acting login; a case that archives it as a parent sets its child rows.
function ongoingParent(context: PlanCliContext, name = "parent plan"): number {
  const number = context.createPlan(name, body("done"));
  context.updateIssue(number, (entry) => {
    entry.labels = ["plan", "plan:ongoing"];
  });
  return number;
}

// A child plan reopens: open, with its phase label back.
const REOPENED_CHILD: Partial<StubIssue> = {
  state: "OPEN",
  stateReason: "REOPENED",
  labels: ["plan", "plan:ongoing"],
};

// The GraphQL reads that the fake gh has served for issue `number`.
function reads(context: PlanCliContext, number: number): number {
  return context.issue(number).graphqlReads ?? 0;
}

function closes({ loadState }: PlanCliContext): Array<Array<string>> {
  return loadState().calls.filter(([group, command]) => group === "issue" && command === "close");
}

function closeChild(context: PlanCliContext, number: number, stateReason: string): void {
  context.updateIssue(number, (entry) => {
    entry.state = "CLOSED";
    entry.stateReason = stateReason;
    entry.labels = ["plan"];
  });
}

function creates({ loadState }: PlanCliContext): Array<Array<string>> {
  return loadState().calls.filter(([group, command]) => group === "issue" && command === "create");
}

// Archive reopens a plan only after the settle wait of `reopen` (#90).
const SETTLE_WAIT = 10_000;

function reopenedComment(number: number, child: number): string {
  return `Reopened: child #${child} changed while plan #${number} closed; work continues.`;
}

// Each archive here skips its waits, so its pauses and its settle wait return at once and get recorded.
function archive(context: PlanCliContext, ...args: ReadonlyArray<string>): PlanResult {
  return context.runSkippingWaits("archive", ...args);
}

// The GraphQL mutations of the call log.
function mutations({ writes }: PlanCliContext): Array<Array<string>> {
  return writes().filter(([group]) => group === "api");
}

// The parent fields that a reopen changes; a comment reduces to its body.
function parentState({ issue }: PlanCliContext, number: number) {
  const { state, stateReason, labels, comments } = issue(number);
  return {
    state,
    stateReason,
    labels,
    comments: (comments ?? []).map((comment) => comment.body),
  };
}

// A parent with one finished child, so that its archive passes every check before the close.
function closableParent(context: PlanCliContext): { parent: number; child: number } {
  const parent = ongoingParent(context);
  const child = context.createChild("finished child", parent).number;
  closeChild(context, child, "COMPLETED");
  setSteps(context, parent, parentRows([child]));
  return { parent, child };
}

// The archive record that the close of a parent posts, naming its children in child order.
function parentRecord(children: ReadonlyArray<number>): string {
  return `Archived as parent: children ${children.map((child) => `#${child}`).join(", ")}`;
}

// The parent after its archive record for `recorded` and a reopen for `child`.
function reopenedParent(parent: number, child: number, recorded = [child]) {
  return {
    state: "OPEN",
    stateReason: "REOPENED",
    labels: ["plan", "plan:ongoing"],
    comments: [parentRecord(recorded), reopenedComment(parent, child)],
  };
}

// A change that lands right after archive's close, with the child and the status that archive then reports.
const DURING_CLOSE: ReadonlyArray<
  readonly [string, (child: number, other: number) => readonly [StubChange, number, string]]
> = [
  ["a child reopens", (child) => [{ otherIssues: { [child]: REOPENED_CHILD } }, child, "ongoing"]],
  [
    "the only finished child is retired",
    (child) => [{ otherIssues: { [child]: { stateReason: "NOT_PLANNED" } } }, child, "retired"],
  ],
  ["the only child is unlinked", (child) => [{ subIssues: [] }, child, "unlinked"]],
  ["a closed child is added", (child, other) => [{ subIssues: [child, other] }, other, "finished"]],
];

// The advice lines that `show` prints for a closed plan and its children.
function closedAdvice(context: PlanCliContext, number: number): Array<string> {
  const shown = context.run("show", String(number));
  expectSuccess(shown, `show #${number}`);
  return shown.stdout
    .split("\n")
    .filter((line) => /^advice: plan (?:is closed as completed|names child)/.test(line));
}

function closePlan(context: PlanCliContext, number: number): void {
  context.updateIssue(number, (entry) => {
    entry.state = "CLOSED";
    entry.stateReason = "COMPLETED";
  });
}

// The phase labels of a plan as the fake gh stores them.
function phaseLabels(context: PlanCliContext, number: number): Array<string> {
  return context
    .issue(number)
    .labels.filter((label) => /^plan:(?:drafting|planned|ongoing|blocked)$/i.test(label));
}

function repairHint(number: number): string {
  return `plan issue state differs after reopen; run status ${number} ongoing to repair the phase labels`;
}

function closedAgainRefusal(number: number): string {
  return `plan #${number} closed again after the reopen; run archive again`;
}

describe.skipIf(!PLAN_CLI_HOST_SUPPORTED)("plan child plans", () => {
  it(
    "new --parent creates a v5 child plan as a sub-issue of the parent through gh issue create --parent",
    () => {
      const context = planCliContext();
      const parent = context.createPlan("parent plan");
      const child = context.createChild("child plan", parent);
      expect(context.issue(parent).subIssues).toStrictEqual([child.number]);
      expect(context.issue(child.number).body).toMatch(/^<!-- plan-contract: v5 -->\n/);
      const [call] = creates(context).slice(-1);
      expect(call[call.indexOf("--parent") + 1], "gh links the child in the create call").toBe(
        String(parent),
      );
      expect(
        context
          .loadState()
          .calls.filter(([group, command]) => group === "api" && command !== "graphql"),
        "gh with --parent needs no REST call",
      ).toStrictEqual([]);
    },
    SPAWN_TIMEOUT_MS,
  );

  it(
    "new writes the v5 marker",
    () => {
      const context = planCliContext();
      const result = context.run("new", "--title", "plain plan", "--goal", "Fix the parser");
      expectSuccess(result, "new");
      const number = Number(/^plan created: #(\d+) /m.exec(result.stdout)?.[1]);
      expect(context.issue(number).body).toMatch(/^<!-- plan-contract: v5 -->\n/);
      expect(
        context.issue(number).subIssues,
        "a plan without --parent gets no parent",
      ).toBeUndefined();
    },
    SPAWN_TIMEOUT_MS,
  );

  it(
    "new --parent links the child through the REST sub-issues API when gh lacks the --parent flag",
    () => {
      const context = planCliContext();
      const parent = context.createPlan("parent plan");
      context.updateState((state) => {
        state.ghLacksParentFlag = true;
      });
      const child = context.createChild("child plan", parent);
      expect(context.issue(parent).subIssues).toStrictEqual([child.number]);
      expect(
        creates(context).length,
        "the parent create, the refused --parent create, and one plain create",
      ).toBe(3);
      expect(creates(context).at(-1), "the second create names no parent").not.toContain(
        "--parent",
      );
      expect(
        context
          .loadState()
          .calls.filter(([group, command]) => group === "api" && command !== "graphql")
          .map((call) => call.slice(1).join(" ")),
      ).toStrictEqual([
        `repos/DocksDocks/fixture/issues/${child.number}`,
        `repos/DocksDocks/fixture/issues/${parent}/sub_issues --method POST -F sub_issue_id=${100_000 + child.number}`,
      ]);
    },
    SPAWN_TIMEOUT_MS,
  );

  it(
    "new --parent names the created child when the REST sub-issue link fails",
    () => {
      const context = planCliContext();
      const parent = context.createPlan("parent plan");
      context.updateState((state) => {
        state.ghLacksParentFlag = true;
        state.subIssueErrorOnce = "HTTP 403: Resource not accessible";
      });
      const child = context.loadState().nextIssue;
      refuse(
        context.run(
          "new",
          "--title",
          "child plan",
          "--goal",
          "Land one pull request",
          "--parent",
          String(parent),
        ),
        `plan #${child} was created, but its link to parent #${parent} failed: gh api repos/DocksDocks/fixture/issues/${parent}/sub_issues failed: HTTP 403: Resource not accessible`,
      );
      expect(context.issue(child), "the child plan exists").toBeTruthy();
      expect(context.issue(parent).subIssues, "the parent has no sub-issue").toBeUndefined();
    },
    SPAWN_TIMEOUT_MS,
  );

  it(
    "new --parent refuses a parent that is not an open plan of the acting login and creates nothing",
    () => {
      const context = planCliContext();
      const closed = context.createPlan("closed parent");
      closeChild(context, closed, "COMPLETED");
      const foreign = context.createPlan("foreign parent");
      context.updateIssue(foreign, (entry) => {
        entry.assignees = ["foreign-agent"];
      });
      const unassigned = context.createPlan("unassigned parent");
      context.updateIssue(unassigned, (entry) => {
        entry.assignees = [];
      });
      const shared = context.createPlan("shared parent");
      context.updateIssue(shared, (entry) => {
        entry.assignees = ["plan-agent", "foreign-agent"];
      });
      const notPlan = context.createPlan("issue without a marker", "A bug report.\n");
      const unlabelled = context.createPlan("unlabelled parent");
      context.updateIssue(unlabelled, (entry) => {
        entry.labels = ["plan"];
      });
      const issuesBefore = context.loadState().issues.length;
      for (const parent of [closed, foreign, unassigned, shared, notPlan, unlabelled]) {
        refuse(
          context.run(
            "new",
            "--title",
            "child plan",
            "--goal",
            "Land one pull request",
            "--parent",
            String(parent),
          ),
          `parent #${parent} is not an open plan`,
        );
      }
      expect(context.loadState().issues.length, "a refused parent creates no issue").toBe(
        issuesBefore,
      );
      refuse(
        context.run(
          "new",
          "--title",
          "child plan",
          "--goal",
          "Land one pull request",
          "--parent",
          "x",
        ),
        "invalid parent issue: x",
      );
    },
    SPAWN_TIMEOUT_MS,
  );

  it(
    "show lists each child with its status after the grant line, and a plan without children lists none",
    () => {
      const context = planCliContext();
      const parent = ongoingParent(context);
      const first = context.createChild("first child", parent).number;
      const second = context.createChild("second child", parent).number;
      const third = context.createChild("third child", parent).number;
      closeChild(context, second, "COMPLETED");
      closeChild(context, third, "NOT_PLANNED");
      const shown = context.run("show", String(parent));
      expectSuccess(shown, "show a parent");
      expect(shown.stdout.split("\n").slice(1, 6)).toStrictEqual([
        "reviews: plan=none code=none",
        "grant: none",
        `child #${first} · drafting · first child`,
        `child #${second} · finished · second child`,
        `child #${third} · retired · third child`,
      ]);
      const withBody = context.run("show", String(parent), "--body");
      expectSuccess(withBody, "show a parent with --body");
      expect(withBody.stderr).toMatch(
        new RegExp(`^child #${first} · drafting · first child$`, "m"),
      );
      const childShow = context.run("show", String(first));
      expectSuccess(childShow, "show a child");
      expect(childShow.stdout).not.toMatch(/^child #/m);
    },
    SPAWN_TIMEOUT_MS,
  );

  it(
    "archive of a parent refuses while a child is open, then finishes after every child closes",
    () => {
      const context = planCliContext();
      const parent = ongoingParent(context);
      const first = context.createChild("first child", parent).number;
      const second = context.createChild("second child", parent).number;
      closeChild(context, first, "COMPLETED");
      setSteps(context, parent, parentRows([first, second]));
      context.updateState((state) => {
        state.calls = [];
      });
      refuse(
        context.run("archive", String(parent)),
        `archive refused: child #${second} is drafting`,
      );
      expect(context.writes(), "a refused archive writes nothing").toStrictEqual([]);
      closeChild(context, second, "COMPLETED");
      const archived = context.run("archive", String(parent));
      expectSuccess(archived, "archive a parent");
      expect(archived.stdout).toBe(`plan #${parent} finished (all 2 children finished)\n`);
      const { state, stateReason, labels } = context.issue(parent);
      expect({ state, stateReason, labels }).toStrictEqual({
        state: "CLOSED",
        stateReason: "COMPLETED",
        labels: ["plan"],
      });
      // A rerun on the finished parent closes nothing again.
      expectSuccess(context.run("archive", String(parent)), "archive a finished parent again");
      expect(
        context
          .loadState()
          .calls.filter(([group, command]) => group === "issue" && command === "close").length,
      ).toBe(1);
    },
    SPAWN_TIMEOUT_MS,
  );

  it(
    "archive of a parent counts a retired or duplicate child as closed but needs one finished child",
    () => {
      const context = planCliContext();
      const parent = ongoingParent(context);
      const retired = context.createChild("retired child", parent).number;
      const duplicate = context.createChild("duplicate child", parent).number;
      closeChild(context, retired, "NOT_PLANNED");
      closeChild(context, duplicate, "DUPLICATE");
      setSteps(context, parent, parentRows([retired, duplicate]));
      refuse(
        context.run("archive", String(parent)),
        `archive refused: no child of plan #${parent} finished; retire the parent`,
      );
      expect(context.issue(parent).state).toBe("OPEN");
      const finished = context.createChild("finished child", parent).number;
      closeChild(context, finished, "COMPLETED");
      setSteps(context, parent, parentRows([retired, duplicate, finished]));
      const archived = context.run("archive", String(parent));
      expectSuccess(archived, "archive a parent with retired, duplicate, and finished children");
      expect(archived.stdout).toBe(`plan #${parent} finished (all 3 children finished)\n`);
    },
    SPAWN_TIMEOUT_MS,
  );

  it(
    "archive of a parent refuses a child that GitHub left closed with reason REOPENED",
    () => {
      const context = planCliContext();
      const parent = ongoingParent(context);
      const child = context.createChild("stuck child", parent).number;
      closeChild(context, child, "REOPENED");
      setSteps(context, parent, parentRows([child]));
      refuse(
        context.run("archive", String(parent)),
        `archive refused: child #${child} is unreadable`,
      );
    },
    SPAWN_TIMEOUT_MS,
  );

  it(
    "archive of a parent needs terminal parent steps and an ongoing parent, but no code review",
    () => {
      const context = planCliContext();
      const parent = context.createPlan("parent with open step");
      const child = context.createChild("child", parent).number;
      closeChild(context, child, "COMPLETED");
      setSteps(context, parent, parentRows([child], "in-flight"));
      refuse(
        context.run("archive", String(parent)),
        "archive requires ongoing or finished status, found drafting",
      );
      context.updateIssue(parent, (entry) => {
        entry.labels = ["plan", "plan:ongoing"];
      });
      refuse(
        context.run("archive", String(parent)),
        `archive refused: non-terminal step land_${child}`,
      );
      expect(context.issue(parent).state).toBe("OPEN");
    },
    SPAWN_TIMEOUT_MS,
  );

  it(
    "archive without --pr keeps the --pr rule for a plan without children",
    () => {
      const context = planCliContext();
      const plan = ongoingParent(context, "plan without children");
      context.updateState((state) => {
        state.calls = [];
      });
      refuse(context.run("archive", String(plan)), "archive requires an issue and --pr");
      expect(context.writes()).toStrictEqual([]);
    },
    SPAWN_TIMEOUT_MS,
  );

  it(
    "archive --pr reopens a landed plan safely while one of its children is open, then archives it",
    () => {
      const context = planCliContext();
      const plan = context.landedPlan("landed plan with a child");
      const child = context.createChild("child", plan.number).number;
      // The pull request closed the plan after the child plan opened.
      context.updateIssue(plan.number, (entry) => {
        entry.state = "CLOSED";
        entry.stateReason = "COMPLETED";
        entry.timelineItems = [{ __typename: "ClosedEvent", closer: plan.closer }];
      });
      const refused = archive(context, String(plan.number), "--pr", String(plan.pr));
      refuse(refused, `archive refused: child #${child} is drafting`);
      expect(refused.stdout).toBe(`plan #${plan.number} reopened: ongoing\n`);
      closeChild(context, child, "COMPLETED");
      expectSuccess(
        archive(context, String(plan.number), "--pr", String(plan.pr)),
        "archive after the child",
      );
    },
    SPAWN_TIMEOUT_MS,
  );

  it(
    "archive without --pr refuses a plan with a child and its own landing work",
    () => {
      const context = planCliContext();
      // A started plan that moved new scope into a child plan still landed its own row through a pull request.
      const plan = context.createPlan("plan with own work", body("done"));
      context.updateIssue(plan, (entry) => {
        entry.labels = ["plan", "plan:ongoing"];
      });
      const child = context.createChild("child", plan).number;
      closeChild(context, child, "COMPLETED");
      context.updateState((state) => {
        state.calls = [];
      });
      refuse(
        context.run("archive", String(plan)),
        `archive refused: plan #${plan} has its own landing work; archive it with --pr`,
      );
      expect(context.writes()).toStrictEqual([]);
      const ownWork = `archive refused: plan #${plan} has its own landing work; archive it with --pr`;
      const other = context.createChild("second child", plan).number;
      closeChild(context, other, "COMPLETED");
      const notChild = context.createPlan("not a child");
      const probe =
        "| 9 | probe_limit | Measure the limit | - | - | probe | done | Results recorded |";
      const ownWorkRows: ReadonlyArray<readonly [string, ReadonlyArray<string>]> = [
        // A fileless row that is no child row is work of the plan itself.
        ["a probe row beside the child rows", [...parentRows([child, other]), probe]],
        ["a row that names an issue that is no child", parentRows([child, notChild])],
        ["a child that no row names", parentRows([child])],
        ["a child that two rows name", parentRows([child, child])],
        [
          "a child row with files",
          parentRows([child, other]).map((row, index) =>
            index === 1 ? row.replace("| - | - |", "| src/a.mjs | - |") : row,
          ),
        ],
        [
          "a Done when that only names the child",
          parentRows([child, other]).map((row) => row.replace(" finished |", " landed |")),
        ],
      ];
      for (const [name, rows] of ownWorkRows) {
        setSteps(context, plan, rows);
        refuse(context.run("archive", String(plan)), ownWork);
        expect(context.issue(plan).state, name).toBe("OPEN");
      }
      setSteps(context, plan, parentRows([child, other]));
      expectSuccess(context.run("archive", String(plan)), "one row for each child is a parent");
    },
    SPAWN_TIMEOUT_MS,
  );

  it(
    "archive of a parent re-reads its children before the close and refuses a new or reopened child",
    () => {
      const context = planCliContext();
      const parent = ongoingParent(context);
      const child = context.createChild("finished child", parent).number;
      closeChild(context, child, "COMPLETED");
      setSteps(context, parent, parentRows([child]));
      const other = context.createPlan("later child");
      // A new child plan appears after the archive snapshot and before the close.
      context.schedule(parent, {
        afterReads: reads(context, parent) + 1,
        subIssues: [child, other],
      });
      refuse(
        context.run("archive", String(parent)),
        "plan issue changed remotely; re-read and retry",
      );
      // The finished child reopens after the archive snapshot and before the close.
      context.updateIssue(parent, (entry) => {
        entry.subIssues = [child];
      });
      context.schedule(parent, {
        afterReads: reads(context, parent) + 1,
        otherIssues: {
          [child]: { state: "OPEN", stateReason: "REOPENED", labels: ["plan", "plan:ongoing"] },
        },
      });
      refuse(
        context.run("archive", String(parent)),
        "plan issue changed remotely; re-read and retry",
      );
      expect(closes(context), "a changed child stops the close").toStrictEqual([]);
      expect(context.issue(parent).state).toBe("OPEN");
    },
    SPAWN_TIMEOUT_MS,
  );

  it(
    "archive --pr re-reads the children before it closes a plan that GitHub left open",
    () => {
      const context = planCliContext();
      const plan = context.landedPlan("landed plan with a finished child");
      const child = context.createChild("child", plan.number).number;
      closeChild(context, child, "COMPLETED");
      // The archive reads the open plan 34 times; the child reopens before the pre-close reads.
      context.schedule(plan.number, {
        afterReads: reads(context, plan.number) + 34,
        otherIssues: {
          [child]: { state: "OPEN", stateReason: "REOPENED", labels: ["plan", "plan:ongoing"] },
        },
      });
      refuse(
        context.runSkippingWaits("archive", String(plan.number), "--pr", String(plan.pr)),
        "plan issue changed remotely; re-read and retry",
      );
      expect(closes(context)).toStrictEqual([]);
      expect(context.issue(plan.number).state).toBe("OPEN");
    },
    SPAWN_TIMEOUT_MS,
  );

  for (const [name, during] of DURING_CLOSE) {
    it(
      `archive of a parent reopens it after the settle wait when ${name} during the close`,
      () => {
        const context = planCliContext();
        const { parent, child } = closableParent(context);
        const other = context.createPlan("later child");
        closeChild(context, other, "COMPLETED");
        const [change, reported, status] = during(child, other);
        context.updateState((state) => {
          state.afterCloseOnce = change;
        });
        const result = archive(context, String(parent));
        refuse(result, `archive refused: child #${reported} is ${status}`);
        expect(result.stdout).toBe(`plan #${parent} reopened: ongoing\n`);
        expect(context.waits(), "the reopen waits for the close to settle").toStrictEqual([
          SETTLE_WAIT,
        ]);
        expect(parentState(context, parent)).toStrictEqual(
          reopenedParent(parent, reported, [child]),
        );
        expect(closes(context).length).toBe(1);
      },
      SPAWN_TIMEOUT_MS,
    );
  }

  it(
    "archive --pr reopens the plan after the settle wait when a child reopens during its close",
    () => {
      const context = planCliContext();
      const plan = context.landedPlan("landed plan with a finished child");
      const child = context.createChild("child", plan.number).number;
      closeChild(context, child, "COMPLETED");
      context.updateState((state) => {
        state.afterCloseOnce = { otherIssues: { [child]: REOPENED_CHILD } };
      });
      const result = archive(context, String(plan.number), "--pr", String(plan.pr));
      refuse(result, `archive refused: child #${child} is ongoing`);
      expect(result.stdout).toBe(`plan #${plan.number} reopened: ongoing\n`);
      expect(context.waits().at(-1)).toBe(SETTLE_WAIT);
      const stored = parentState(context, plan.number);
      expect({
        state: stored.state,
        labels: stored.labels,
        comment: stored.comments.at(-1),
      }).toStrictEqual({
        state: "OPEN",
        labels: ["plan", "plan:ongoing"],
        comment: reopenedComment(plan.number, child),
      });
    },
    SPAWN_TIMEOUT_MS,
  );

  it(
    "archive --pr closes a plan with an own-work row and an unlinked child row without a reopen",
    () => {
      const context = planCliContext();
      // A row names an issue that is not linked, and another row carries the plan's own work.
      const named = context.landedPlan("landed plan whose row names an unlinked issue");
      const finished = context.createChild("finished child", named.number).number;
      closeChild(context, finished, "COMPLETED");
      const unlinked = context.createPlan("unlinked issue");
      setSteps(context, named.number, [
        "| 1 | fix_parser | Fix parser | src/parser.mjs | - | local | done | Records round-trip |",
        `| 2 | note | Note the issue | - | - | local | done | child #${unlinked} finished |`,
      ]);
      const first = archive(context, String(named.number), "--pr", String(named.pr));
      expectSuccess(first, "archive a plan whose row names an unlinked issue");
      expect(parentState(context, named.number).state).toBe("CLOSED");
    },
    SPAWN_TIMEOUT_MS,
  );

  it(
    "a plan archived with its landing pull request gets only the open-child recovery",
    () => {
      const context = planCliContext();
      const ownRow =
        "| 1 | fix_parser | Fix parser | src/parser.mjs | - | local | done | Records round-trip |";
      const unlinked = context.createPlan("unlinked issue");
      const ownWork = (number: number): string =>
        `archive refused: plan #${number} has its own landing work; archive it with --pr`;
      const noFinishedChild = (number: number): string =>
        `archive refused: no child of plan #${number} finished; retire the parent`;
      const recoveries: ReadonlyArray<
        readonly [
          name: string,
          rows: (child: number) => ReadonlyArray<string>,
          childReason: string,
          refusal: (number: number) => string,
          closedByGitHub: boolean,
        ]
      > = [
        ["only a retired child", () => [ownRow], "NOT_PLANNED", ownWork, false],
        [
          "an unlinked child row",
          () => [
            ownRow,
            `| 2 | note | Note the issue | - | - | local | done | child #${unlinked} finished |`,
          ],
          "COMPLETED",
          ownWork,
          false,
        ],
        // Parent rows, but the landing pull request is the proof, so the plan is no parent to recover.
        [
          "parent rows and only a retired child",
          (child) => parentRows([child]),
          "NOT_PLANNED",
          noFinishedChild,
          false,
        ],
        [
          "parent rows and only a retired child, closed by GitHub",
          (child) => parentRows([child]),
          "NOT_PLANNED",
          noFinishedChild,
          true,
        ],
      ];
      for (const [name, rows, childReason, refusal, closedByGitHub] of recoveries) {
        const plan = context.landedPlan(`landed plan with ${name}`);
        const child = context.createChild("child", plan.number).number;
        closeChild(context, child, childReason);
        setSteps(context, plan.number, rows(child));
        if (closedByGitHub)
          context.updateIssue(plan.number, (entry) => {
            entry.state = "CLOSED";
            entry.stateReason = "COMPLETED";
            entry.timelineItems = [{ __typename: "ClosedEvent", closer: plan.closer }];
          });
        expectSuccess(
          archive(context, String(plan.number), "--pr", String(plan.pr)),
          `archive --pr with ${name}`,
        );
        const finished = parentState(context, plan.number);
        expect(
          finished.comments.at(-1)?.endsWith(`Archived with landing pull request #${plan.pr}`),
          `${name}: the archive records its landing pull request`,
        ).toBe(true);
        expect(
          closedAdvice(context, plan.number),
          `${name}: show gives no recovery advice`,
        ).toStrictEqual([]);
        context.updateState((state) => {
          state.calls = [];
        });
        // Both retries finish or refuse without a write, and the rerun posts no second record.
        refuse(archive(context, String(plan.number)), refusal(plan.number));
        expectSuccess(
          archive(context, String(plan.number), "--pr", String(plan.pr)),
          `archive --pr again with ${name}`,
        );
        expect(mutations(context), `${name}: no reopen and no second record`).toStrictEqual([]);
        expect(parentState(context, plan.number)).toStrictEqual(finished);
      }
    },
    SPAWN_TIMEOUT_MS,
  );

  it(
    "a closed plan without an archive record gets only the open-child recovery",
    () => {
      const context = planCliContext();
      // Someone closed the parent by hand: no archive record says that it was archived as a parent.
      const parent = ongoingParent(context);
      const retired = context.createChild("retired child", parent).number;
      closeChild(context, retired, "NOT_PLANNED");
      setSteps(context, parent, parentRows([retired]));
      closePlan(context, parent);
      // A parent record that another login wrote fails the trust rule, so it is no archive record.
      context.addIssueComment(parent, parentRecord([retired]), "foreign-agent");
      expect(closedAdvice(context, parent)).toStrictEqual([]);
      context.updateState((state) => {
        state.calls = [];
      });
      refuse(
        archive(context, String(parent)),
        `archive refused: no child of plan #${parent} finished; retire the parent`,
      );
      expect(mutations(context)).toStrictEqual([]);
    },
    SPAWN_TIMEOUT_MS,
  );

  it(
    "a parent archive posts its record once, and a linked merged pull request does not end parent recovery",
    () => {
      const context = planCliContext();
      const { parent, child } = closableParent(context);
      // A merged pull request that someone linked to the parent by hand: it did not archive the plan.
      context.updateState((state) => {
        state.prs.push({
          number: 900,
          url: "https://github.com/DocksDocks/fixture/pull/900",
          state: "MERGED",
          mergedAt: "2026-08-21T00:00:00Z",
          baseRefName: "main",
          body: `Closes #${parent}`,
          repository: "DocksDocks/fixture",
          closingIssuesReferences: [parent],
        });
      });
      expectSuccess(archive(context, String(parent)), "archive the parent");
      expect(parentState(context, parent).comments, "the close posts the record").toStrictEqual([
        parentRecord([child]),
      ]);
      expectSuccess(archive(context, String(parent)), "rerun the archive of the finished parent");
      expect(parentState(context, parent).comments, "a rerun posts no second record").toStrictEqual(
        [parentRecord([child])],
      );
      // The only finished child is unlinked after the archive: the parent rules still apply.
      context.updateIssue(parent, (entry) => {
        entry.subIssues = [];
      });
      expect(closedAdvice(context, parent)).toStrictEqual([
        `advice: plan names child #${child}, which is not linked; relink it or edit the row; run archive ${parent} again to reopen it safely`,
        `advice: plan is closed as completed but no child finished; run archive ${parent} again to reopen it safely`,
      ]);
      refuse(archive(context, String(parent)), `archive refused: child #${child} is unlinked`);
      expect(parentState(context, parent)).toStrictEqual(reopenedParent(parent, child));
    },
    SPAWN_TIMEOUT_MS,
  );

  it(
    "the archive of a parent that someone else closed posts its record once",
    () => {
      const context = planCliContext();
      const { parent, child } = closableParent(context);
      closePlan(context, parent);
      expectSuccess(archive(context, String(parent)), "archive a closed parent");
      expect(parentState(context, parent).comments).toStrictEqual([parentRecord([child])]);
      expectSuccess(archive(context, String(parent)), "rerun");
      expect(parentState(context, parent).comments).toStrictEqual([parentRecord([child])]);
    },
    SPAWN_TIMEOUT_MS,
  );

  it(
    "a reopen after a finished archive restores the ongoing phase label",
    () => {
      const context = planCliContext();
      const { parent, child } = closableParent(context);
      expectSuccess(archive(context, String(parent)), "archive the parent");
      expect(parentState(context, parent).labels).toStrictEqual(["plan"]);
      // The child reopens after the archive finished, and the owner follows the advice of `show`.
      context.updateIssue(child, (entry) => Object.assign(entry, REOPENED_CHILD));
      refuse(archive(context, String(parent)), `archive refused: child #${child} is ongoing`);
      expect(parentState(context, parent)).toStrictEqual(reopenedParent(parent, child));
      expect(context.run("show", String(parent)).stdout).toMatch(
        new RegExp(`^#${parent} · ongoing · `, "m"),
      );
      // The reopen comment ends the parent record: after a close by hand, only the open-child rule applies.
      closeChild(context, child, "NOT_PLANNED");
      closePlan(context, parent);
      expect(closedAdvice(context, parent)).toStrictEqual([]);
    },
    SPAWN_TIMEOUT_MS,
  );

  it(
    "a reopen keeps the one phase label of its label read and every other label",
    () => {
      const context = planCliContext();
      const { parent, child } = closableParent(context);
      context.updateState((state) => {
        state.labels["area:docs"] = { color: "ededed" };
      });
      expectSuccess(archive(context, String(parent)), "archive the parent");
      context.updateIssue(child, (entry) => Object.assign(entry, REOPENED_CHILD));
      // The retry reads the plan twice (the first read and the settle read); the labels change before the read of the labels.
      context.schedule(parent, {
        afterReads: reads(context, parent) + 2,
        labels: ["plan", "area:docs", "plan:blocked"],
      });
      const result = archive(context, String(parent));
      refuse(result, `archive refused: child #${child} is ongoing`);
      expect(result.stdout).toBe(`plan #${parent} reopened: blocked\n`);
      expect(context.issue(parent).labels).toStrictEqual(["plan", "area:docs", "plan:blocked"]);
    },
    SPAWN_TIMEOUT_MS,
  );

  it(
    "a phase label that lands with the reopen write is kept, refused with the repair, and status repairs it",
    () => {
      const context = planCliContext();
      const { parent, child } = closableParent(context);
      expectSuccess(archive(context, String(parent)), "archive the parent");
      context.updateIssue(child, (entry) => Object.assign(entry, REOPENED_CHILD));
      // The label lands after the read of the labels, right before the reopen write, which adds `plan:ongoing`.
      context.schedule(parent, {
        afterReads: reads(context, parent) + 3,
        labels: ["plan", "plan:blocked"],
      });
      const result = archive(context, String(parent));
      refuse(result, repairHint(parent));
      expect(result.stdout, "no reopened status is reported").toBe("");
      expect(phaseLabels(context, parent), "no label is lost").toStrictEqual([
        "plan:blocked",
        "plan:ongoing",
      ]);
      // The plan reads unreadable with two phase labels; `status` repairs it to one.
      expect(context.run("show", String(parent)).stdout).toMatch(
        new RegExp(`^#${parent} · unreadable · `, "m"),
      );
      expectSuccess(context.run("status", String(parent), "ongoing"), "repair the phase labels");
      expect(phaseLabels(context, parent)).toStrictEqual(["plan:ongoing"]);
    },
    SPAWN_TIMEOUT_MS,
  );

  it(
    "a non-phase label that lands with the reopen write is kept",
    () => {
      const context = planCliContext();
      const { parent, child } = closableParent(context);
      context.updateState((state) => {
        state.labels["area:docs"] = { color: "ededed" };
      });
      expectSuccess(archive(context, String(parent)), "archive the parent");
      context.updateIssue(child, (entry) => Object.assign(entry, REOPENED_CHILD));
      context.schedule(parent, {
        afterReads: reads(context, parent) + 3,
        labels: ["plan", "area:docs"],
      });
      const result = archive(context, String(parent));
      refuse(result, `archive refused: child #${child} is ongoing`);
      expect(result.stdout).toBe(`plan #${parent} reopened: ongoing\n`);
      expect(context.issue(parent).labels).toStrictEqual(["plan", "area:docs", "plan:ongoing"]);
    },
    SPAWN_TIMEOUT_MS,
  );

  it(
    "a reopen whose label read shows two phase labels adds none and refuses with the repair",
    () => {
      const context = planCliContext();
      const { parent, child } = closableParent(context);
      expectSuccess(archive(context, String(parent)), "archive the parent");
      context.updateIssue(child, (entry) => Object.assign(entry, REOPENED_CHILD));
      context.schedule(parent, {
        afterReads: reads(context, parent) + 2,
        labels: ["plan", "plan:blocked", "plan:ongoing"],
      });
      const result = archive(context, String(parent));
      refuse(result, repairHint(parent));
      expect(phaseLabels(context, parent)).toStrictEqual(["plan:blocked", "plan:ongoing"]);
      expect(context.issue(parent).state, "the plan is open, so status can repair it").toBe("OPEN");
      expectSuccess(
        context.run("status", String(parent), "blocked", "--reason", "Waiting"),
        "repair to blocked",
      );
      expect(phaseLabels(context, parent)).toStrictEqual(["plan:blocked"]);
    },
    SPAWN_TIMEOUT_MS,
  );

  it(
    "a reopen refuses with the repair and reports no status when a phase label lands right after its write",
    () => {
      const context = planCliContext();
      const { parent, child } = closableParent(context);
      expectSuccess(archive(context, String(parent)), "archive the parent");
      context.updateIssue(child, (entry) => Object.assign(entry, REOPENED_CHILD));
      context.updateState((state) => {
        state.afterMutationOnce = {
          issue: parent,
          labels: ["plan", "plan:ongoing", "plan:blocked"],
        };
      });
      const result = archive(context, String(parent));
      refuse(result, repairHint(parent));
      expect(result.stdout, "no reopened status is reported").toBe("");
    },
    SPAWN_TIMEOUT_MS,
  );

  // Another actor closes the parent right after the reopen write of archive. The rerun reads that close and decides again.
  it(
    "archive names its rerun, which reopens the parent for its open child, after a close as completed",
    () => {
      const context = planCliContext();
      const { parent, child } = closableParent(context);
      expectSuccess(archive(context, String(parent)), "archive the parent");
      context.updateIssue(child, (entry) => Object.assign(entry, REOPENED_CHILD));
      context.updateState((state) => {
        state.afterMutationOnce = { issue: parent, ...closedBy(null, "2026-08-21T12:00:00Z") };
      });
      const first = archive(context, String(parent));
      refuse(first, closedAgainRefusal(parent));
      expect(first.stdout, "no reopened status is reported").toBe("");
      expect(context.issue(parent).state).toBe("CLOSED");
      const rerun = archive(context, String(parent));
      refuse(rerun, `archive refused: child #${child} is ongoing`);
      expect(rerun.stdout).toBe(`plan #${parent} reopened: ongoing\n`);
      expect(parentState(context, parent)).toStrictEqual({
        state: "OPEN",
        stateReason: "REOPENED",
        labels: ["plan", "plan:ongoing"],
        comments: [
          parentRecord([child]),
          reopenedComment(parent, child),
          reopenedComment(parent, child),
        ],
      });
    },
    SPAWN_TIMEOUT_MS,
  );

  it(
    "archive names its rerun, which refuses the retired parent, after a close as not planned",
    () => {
      const context = planCliContext();
      const { parent, child } = closableParent(context);
      expectSuccess(archive(context, String(parent)), "archive the parent");
      context.updateIssue(child, (entry) => Object.assign(entry, REOPENED_CHILD));
      context.updateState((state) => {
        state.afterMutationOnce = {
          issue: parent,
          ...closedBy(null, "2026-08-21T12:00:00Z"),
          stateReason: "NOT_PLANNED",
        };
      });
      refuse(archive(context, String(parent)), closedAgainRefusal(parent));
      const writes = context.writes().length;
      refuse(
        archive(context, String(parent)),
        "archive requires ongoing or finished status, found retired",
      );
      expect(context.writes().length, "the rerun writes nothing").toBe(writes);
      const { state, stateReason } = context.issue(parent);
      expect([state, stateReason]).toStrictEqual(["CLOSED", "NOT_PLANNED"]);
    },
    SPAWN_TIMEOUT_MS,
  );

  it(
    "the claim of an unassigned parent refuses an owner that appears before its write",
    () => {
      const context = planCliContext();
      const { parent } = closableParent(context);
      context.updateIssue(parent, (entry) => {
        entry.assignees = [];
      });
      // Another login claims the parent after the archive read, before the claim write.
      context.schedule(parent, {
        afterReads: reads(context, parent) + 1,
        assignees: ["foreign-agent"],
      });
      context.updateState((state) => {
        state.calls = [];
      });
      refuse(archive(context, String(parent)), `plan #${parent} is owned by foreign-agent`);
      expect(context.issue(parent).assignees, "the helper adds no assignee").toStrictEqual([
        "foreign-agent",
      ]);
      expect(mutations(context)).toStrictEqual([]);
    },
    SPAWN_TIMEOUT_MS,
  );

  it(
    "the archive after a recovery reopen posts its own record",
    () => {
      const context = planCliContext();
      const { parent, child } = closableParent(context);
      expectSuccess(archive(context, String(parent)), "archive the parent");
      context.updateIssue(child, (entry) => Object.assign(entry, REOPENED_CHILD));
      refuse(archive(context, String(parent)), `archive refused: child #${child} is ongoing`);
      closeChild(context, child, "COMPLETED");
      expectSuccess(archive(context, String(parent)), "archive the parent again");
      expect(parentState(context, parent).comments).toStrictEqual([
        parentRecord([child]),
        reopenedComment(parent, child),
        parentRecord([child]),
      ]);
    },
    SPAWN_TIMEOUT_MS,
  );

  it(
    "an unassigned parent is claimed before its close, so a child change during the close gets parent recovery",
    () => {
      const context = planCliContext();
      const { parent, child } = closableParent(context);
      context.updateIssue(parent, (entry) => {
        entry.assignees = [];
      });
      const other = context.createPlan("later child");
      closeChild(context, other, "COMPLETED");
      // A closed child is added during the close: only the parent rules count it.
      context.updateState((state) => {
        state.afterCloseOnce = { subIssues: [child, other] };
      });
      const result = archive(context, String(parent));
      refuse(result, `archive refused: child #${other} is finished`);
      expect(parentState(context, parent)).toStrictEqual(reopenedParent(parent, other, [child]));
      expect(context.issue(parent).assignees).toStrictEqual(["plan-agent"]);
    },
    SPAWN_TIMEOUT_MS,
  );

  it(
    "archive --pr reopens a closed plan safely on the retry after a failed read that followed its close",
    () => {
      const context = planCliContext();
      const plan = context.landedPlan("landed plan with a finished child");
      const child = context.createChild("child", plan.number).number;
      closeChild(context, child, "COMPLETED");
      context.updateState((state) => {
        state.afterCloseOnce = {
          graphqlError: { errors: [{ message: "child read unavailable" }] },
          otherIssues: { [child]: REOPENED_CHILD },
        };
      });
      refuse(
        archive(context, String(plan.number), "--pr", String(plan.pr)),
        "gh api graphql returned errors: child read unavailable",
      );
      expect(parentState(context, plan.number).state).toBe("CLOSED");
      const retry = archive(context, String(plan.number), "--pr", String(plan.pr));
      refuse(retry, `archive refused: child #${child} is ongoing`);
      expect(retry.stdout).toBe(`plan #${plan.number} reopened: ongoing\n`);
      const stored = parentState(context, plan.number);
      expect({
        state: stored.state,
        labels: stored.labels,
        comment: stored.comments.at(-1),
      }).toStrictEqual({
        state: "OPEN",
        labels: ["plan", "plan:ongoing"],
        comment: reopenedComment(plan.number, child),
      });
    },
    SPAWN_TIMEOUT_MS,
  );

  it(
    "archive refuses with the stuck state when GitHub leaves the plan closed with reason REOPENED",
    () => {
      const context = planCliContext();
      const { parent, child } = closableParent(context);
      context.updateState((state) => {
        state.afterCloseOnce = { otherIssues: { [child]: REOPENED_CHILD } };
        state.reopenLeavesClosed = true;
      });
      refuse(
        archive(context, String(parent)),
        `GitHub left plan #${parent} closed with reason REOPENED and refuses every state change; ask GitHub Support to repair it`,
      );
      expect(context.waits()).toStrictEqual([SETTLE_WAIT]);
      // The settle read shows the plan stuck already: archive refuses with the stuck state and does not write.
      const second = closableParent(context);
      context.updateState((state) => {
        state.afterCloseOnce = { otherIssues: { [second.child]: REOPENED_CHILD } };
        state.calls = [];
      });
      context.schedule(second.parent, {
        afterReads: reads(context, second.parent) + 3,
        stateReason: "REOPENED",
      });
      refuse(
        archive(context, String(second.parent)),
        `GitHub left plan #${second.parent} closed with reason REOPENED and refuses every state change; ask GitHub Support to repair it`,
      );
      expect(mutations(context)).toStrictEqual([]);
    },
    SPAWN_TIMEOUT_MS,
  );

  it(
    "archive writes nothing when the close or the child changes again during the settle wait",
    () => {
      const context = planCliContext();
      const { parent, child } = closableParent(context);
      // Archive reads the parent before the close, again before the close, after the close, and after the settle wait.
      const settleRead = reads(context, parent) + 3;
      context.updateState((state) => {
        state.afterCloseOnce = { otherIssues: { [child]: REOPENED_CHILD } };
      });
      // The child finishes again during the wait, so the plan shows no open work.
      context.schedule(parent, {
        afterReads: settleRead,
        otherIssues: { [child]: { state: "CLOSED", stateReason: "COMPLETED", labels: ["plan"] } },
      });
      context.updateState((state) => {
        state.calls = [];
      });
      refuse(
        archive(context, String(parent)),
        `plan #${parent} changed during the settle wait; run archive again`,
      );
      expect(mutations(context)).toStrictEqual([]);
      // The rerun finishes the closed parent, whose children show no open work.
      const rerun = archive(context, String(parent));
      expectSuccess(rerun, "archive after the settle refusal");
      expect(rerun.stdout).toBe(`plan #${parent} finished (all 1 children finished)\n`);

      // Someone reopens the plan during the wait: archive writes nothing and refuses with the open child.
      const second = closableParent(context);
      context.updateState((state) => {
        state.afterCloseOnce = { otherIssues: { [second.child]: REOPENED_CHILD } };
      });
      context.schedule(second.parent, {
        afterReads: reads(context, second.parent) + 3,
        state: "OPEN",
        stateReason: "REOPENED",
      });
      const reopenedBySomeone = archive(context, String(second.parent));
      refuse(reopenedBySomeone, `archive refused: child #${second.child} is ongoing`);
      expect(reopenedBySomeone.stdout).toBe("");
      expect(parentState(context, second.parent).comments).toStrictEqual([
        parentRecord([second.child]),
      ]);
    },
    SPAWN_TIMEOUT_MS,
  );

  it(
    "archive refuses when the plan reads open after its close and no child changed",
    () => {
      const context = planCliContext();
      const { parent } = closableParent(context);
      context.updateState((state) => {
        state.afterCloseOnce = { state: "OPEN", stateReason: "REOPENED" };
      });
      refuse(archive(context, String(parent)), "plan issue changed remotely; re-read and retry");
      expect(parentState(context, parent).labels, "the phase label stays").toStrictEqual([
        "plan",
        "plan:ongoing",
      ]);
      // A plan that reads open after the close, beside a changed child, needs no settle wait and gets no write.
      const second = closableParent(context);
      context.updateState((state) => {
        state.afterCloseOnce = {
          state: "OPEN",
          stateReason: "REOPENED",
          otherIssues: { [second.child]: REOPENED_CHILD },
        };
      });
      const waitsBefore = context.waits().length;
      const result = archive(context, String(second.parent));
      refuse(result, `archive refused: child #${second.child} is ongoing`);
      expect(context.waits().slice(waitsBefore), "no settle wait for an open plan").toStrictEqual(
        [],
      );
      expect(parentState(context, second.parent).comments).toStrictEqual([
        parentRecord([second.child]),
      ]);
    },
    SPAWN_TIMEOUT_MS,
  );

  it(
    "archive reopens a closed plan safely on the retry after a failed read that followed its close",
    () => {
      const context = planCliContext();
      const { parent, child } = closableParent(context);
      context.updateState((state) => {
        state.afterCloseOnce = {
          graphqlError: { errors: [{ message: "child read unavailable" }] },
          otherIssues: { [child]: REOPENED_CHILD },
        };
        state.calls = [];
      });
      refuse(
        archive(context, String(parent)),
        "gh api graphql returned errors: child read unavailable",
      );
      expect(parentState(context, parent)).toStrictEqual({
        state: "CLOSED",
        stateReason: "COMPLETED",
        labels: ["plan", "plan:ongoing"],
        comments: [parentRecord([child])],
      });
      expect(mutations(context)).toStrictEqual([]);
      expect(closedAdvice(context, parent)).toStrictEqual([
        `advice: plan is closed as completed while child #${child} is ongoing; run archive ${parent} again to reopen it safely`,
        `advice: plan is closed as completed but no child finished; run archive ${parent} again to reopen it safely`,
      ]);
      const retry = archive(context, String(parent));
      refuse(retry, `archive refused: child #${child} is ongoing`);
      expect(retry.stdout).toBe(`plan #${parent} reopened: ongoing\n`);
      expect(parentState(context, parent)).toStrictEqual(reopenedParent(parent, child));
    },
    SPAWN_TIMEOUT_MS,
  );

  it(
    "archive reopens a closed plan safely on the retry when its only finished child was unlinked",
    () => {
      const context = planCliContext();
      const { parent, child } = closableParent(context);
      context.updateState((state) => {
        state.afterCloseOnce = {
          graphqlError: { errors: [{ message: "child read unavailable" }] },
          subIssues: [],
        };
      });
      refuse(
        archive(context, String(parent)),
        "gh api graphql returned errors: child read unavailable",
      );
      expect(closedAdvice(context, parent)).toStrictEqual([
        `advice: plan names child #${child}, which is not linked; relink it or edit the row; run archive ${parent} again to reopen it safely`,
        `advice: plan is closed as completed but no child finished; run archive ${parent} again to reopen it safely`,
      ]);
      const retry = archive(context, String(parent));
      refuse(retry, `archive refused: child #${child} is unlinked`);
      expect(parentState(context, parent)).toStrictEqual(reopenedParent(parent, child));
    },
    SPAWN_TIMEOUT_MS,
  );

  it(
    "archive reopens a closed plan safely on the retry when one of two finished children was unlinked",
    () => {
      const context = planCliContext();
      const parent = ongoingParent(context);
      const kept = context.createChild("kept child", parent).number;
      const lost = context.createChild("lost child", parent).number;
      closeChild(context, kept, "COMPLETED");
      closeChild(context, lost, "COMPLETED");
      setSteps(context, parent, parentRows([kept, lost]));
      context.updateState((state) => {
        state.afterCloseOnce = {
          graphqlError: { errors: [{ message: "child read unavailable" }] },
          subIssues: [kept],
        };
      });
      refuse(
        archive(context, String(parent)),
        "gh api graphql returned errors: child read unavailable",
      );
      // A finished child is still linked, so only the row of the unlinked child is open work.
      const retry = archive(context, String(parent));
      refuse(retry, `archive refused: child #${lost} is unlinked`);
      expect(parentState(context, parent)).toStrictEqual(
        reopenedParent(parent, lost, [kept, lost]),
      );
    },
    SPAWN_TIMEOUT_MS,
  );

  it(
    "show advises on each child that is not terminal while the plan is closed as completed",
    () => {
      const context = planCliContext();
      const parent = ongoingParent(context);
      const open = context.createChild("open child", parent).number;
      const finished = context.createChild("finished child", parent).number;
      const stuck = context.createChild("stuck child", parent).number;
      closeChild(context, finished, "COMPLETED");
      closeChild(context, stuck, "REOPENED");
      setSteps(context, parent, parentRows([open, finished, stuck]));
      expect(
        closedAdvice(context, parent),
        "an open plan gets no closed-plan advice",
      ).toStrictEqual([]);
      closePlan(context, parent);
      const recovery = `run archive ${parent} again to reopen it safely`;
      expect(closedAdvice(context, parent)).toStrictEqual([
        `advice: plan is closed as completed while child #${open} is drafting; ${recovery}`,
        `advice: plan is closed as completed while child #${stuck} is unreadable; ${recovery}`,
      ]);
      // A plan with work of its own gets the same advice for an open child.
      const ownWork = ongoingParent(context, "plan with own work");
      const ownChild = context.createChild("open child", ownWork).number;
      closePlan(context, ownWork);
      expect(closedAdvice(context, ownWork)).toStrictEqual([
        `advice: plan is closed as completed while child #${ownChild} is drafting; run archive ${ownWork} again to reopen it safely`,
      ]);
    },
    SPAWN_TIMEOUT_MS,
  );

  it(
    "show advises on child rows that name an unlinked child or no finished child",
    () => {
      const context = planCliContext();
      const parent = ongoingParent(context);
      const retired = context.createChild("retired child", parent).number;
      closeChild(context, retired, "NOT_PLANNED");
      const finished = context.createChild("finished child", parent).number;
      closeChild(context, finished, "COMPLETED");
      // The rows name only the retired child, so no named child finished.
      setSteps(context, parent, parentRows([retired]));
      closePlan(context, parent);
      // The parent rules apply to a plan whose latest trusted archive record says that it was archived as a parent.
      context.addIssueComment(parent, parentRecord([retired, finished]));
      const recovery = `run archive ${parent} again to reopen it safely`;
      expect(closedAdvice(context, parent)).toStrictEqual([
        `advice: plan is closed as completed but no child finished; ${recovery}`,
      ]);
      // A row that names a finished child that is not linked, beside a linked finished child.
      const unlinked = context.createPlan("unlinked child");
      closeChild(context, unlinked, "COMPLETED");
      setSteps(context, parent, parentRows([retired, finished, unlinked]));
      closePlan(context, parent);
      expect(closedAdvice(context, parent)).toStrictEqual([
        `advice: plan names child #${unlinked}, which is not linked; relink it or edit the row; ${recovery}`,
      ]);
      // A plan with its own landing work and a retired child has nothing open.
      const ownWork = ongoingParent(context, "plan with own work");
      closeChild(context, context.createChild("retired child", ownWork).number, "NOT_PLANNED");
      closePlan(context, ownWork);
      expect(closedAdvice(context, ownWork)).toStrictEqual([]);
      // A closed plan without children and without steps has nothing open.
      const empty = context.createPlan("closed plan without steps");
      setSteps(context, empty, []);
      closePlan(context, empty);
      expect(closedAdvice(context, empty)).toStrictEqual([]);
    },
    SPAWN_TIMEOUT_MS,
  );

  it(
    "show and list read a phase label beyond the first label page of a child or a listed plan",
    () => {
      const context = planCliContext();
      const parent = ongoingParent(context);
      const child = context.createChild("paged child", parent).number;
      context.updateIssue(child, (entry) => {
        entry.labels = [
          "plan",
          ...Array.from({ length: 100 }, (_, index) => `topic:${index}`),
          "plan:ongoing",
        ];
      });
      const shown = context.run("show", String(parent));
      expectSuccess(shown, "show a parent with a paged child");
      expect(shown.stdout).toMatch(new RegExp(`^child #${child} · ongoing · paged child$`, "m"));
      const listed = context.run("list");
      expectSuccess(listed, "list a plan with paged labels");
      expect(listed.stdout).toMatch(new RegExp(`^ongoing\\t#${child}\\tpaged child$`, "m"));
    },
    SPAWN_TIMEOUT_MS,
  );

  it(
    "a write moves a v4 plan to v5 only before work starts, and a started v4 plan stays v4",
    () => {
      const context = planCliContext();
      const unstarted = context.createPlan("unstarted v4", body("planned", 4));
      expectSuccess(context.run("status", String(unstarted), "ongoing"), "start a v4 plan");
      expect(context.issue(unstarted).body).toMatch(/^<!-- plan-contract: v5 -->\n/);
      const started = context.createPlan("started v4", body("planned", 4));
      context.updateIssue(started, (entry) => {
        entry.labels = ["plan", "plan:ongoing"];
      });
      expectSuccess(
        context.edit(started, (text) => text.replace("Not run.", "Smoke passed.")),
        "edit a started v4 plan",
      );
      expect(context.issue(started).body).toMatch(/^<!-- plan-contract: v4 -->\n/);
      // The marker comes from the stored plan, not from the edited file.
      expectSuccess(
        context.edit(started, (text) => text.replace("plan-contract: v4", "plan-contract: v5")),
        "edit that names v5 on a started v4 plan",
      );
      expect(context.issue(started).body).toMatch(/^<!-- plan-contract: v4 -->\n/);
      expectSuccess(
        context.run("step", String(started), "fix_parser", "in-flight"),
        "step on a started v4 plan",
      );
      expect(context.issue(started).body).toMatch(/^<!-- plan-contract: v4 -->\n/);
      expectSuccess(
        context.run("status", String(started), "blocked", "--reason", "Waiting"),
        "block a started v4 plan",
      );
      expect(context.issue(started).body).toMatch(/^<!-- plan-contract: v4 -->\n/);
    },
    SPAWN_TIMEOUT_MS,
  );
});
