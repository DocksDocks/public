import { describe, expect, it } from "vitest";

import {
  PLAN_CLI_HOST_SUPPORTED,
  type LandedPlan,
  type LandedPlanOptions,
  type PlanCliContext,
  type PlanResult,
  expectSuccess,
  planCliContext,
  refuse,
} from "../../lib/plan/harness";
import { SPAWN_TIMEOUT_MS } from "../../lib/spawnTimeout";

// Every archive skips its waits, so a pause for an open plan returns at once and gets recorded.
function archive({ runSkippingWaits }: PlanCliContext, plan: LandedPlan): PlanResult {
  return runSkippingWaits("archive", String(plan.number), "--pr", String(plan.pr));
}

type Landing = readonly [
  kind: string,
  land: (name: string, options?: LandedPlanOptions) => LandedPlan,
  state: string,
];

// A landed plan that GitHub left open, which an archive closes after its waits, and one that GitHub closed.
function landings({ landedPlan, closedPlan }: PlanCliContext): ReadonlyArray<Landing> {
  return [
    ["open", landedPlan, "OPEN"],
    ["closed", closedPlan, "CLOSED"],
  ];
}

// A refused archive leaves the plan as it found it, with `plan:ongoing`, and neither writes nor waits.
function assertUntouched(
  { issue, writes, waits }: PlanCliContext,
  plan: LandedPlan,
  state: string,
  label?: string,
): void {
  const { state: stored, labels } = issue(plan.number);
  expect({ state: stored, labels }, label).toStrictEqual({
    state,
    labels: ["plan", "plan:ongoing"],
  });
  expect(writes(), label).toStrictEqual([]);
  expect(waits(), label).toStrictEqual([]);
}

type RefusalCase = {
  readonly name: string;
  readonly options?: LandedPlanOptions;
  readonly prepare?: (plan: LandedPlan) => void;
  readonly refusal: (plan: LandedPlan) => string;
};

describe.skipIf(!PLAN_CLI_HOST_SUPPORTED)("plan archive, retire, and list", () => {
  it(
    "archive refuses an open or closed plan without landing proof, finished work, a review pass, or ownership",
    () => {
      const context = planCliContext();
      const cases: ReadonlyArray<RefusalCase> = [
        {
          name: "no closing keyword",
          options: { prBody: "Refs #ISSUE" },
          refusal: (plan) =>
            `pull request #${plan.pr} has no closing keyword for plan #${plan.number} in its description; ask the owner before you add \`Closes #${plan.number}\` to the merged pull request, then run archive again`,
        },
        {
          name: "a merge into another branch",
          options: { base: "release" },
          refusal: (plan) =>
            `pull request #${plan.pr} merged into release; archive requires a merge into DocksDocks/fixture:main`,
        },
        {
          name: "a non-terminal step",
          options: { status: "in-flight" },
          refusal: () => "archive refused: non-terminal step fix_parser",
        },
        {
          // A merged closing pull request does not replace review approval.
          name: "a review that asks for repair",
          prepare: (plan) =>
            context.addIssueComment(
              plan.number,
              "## Code review\n\ncode-review: repair\nFix data loss.",
            ),
          refusal: () => "archive requires Code-review: pass",
        },
        {
          name: "another owner",
          prepare: (plan) =>
            context.updateIssue(plan.number, (entry) => {
              entry.assignees = ["other-agent"];
            }),
          refusal: (plan) => `plan #${plan.number} is owned by other-agent`,
        },
      ];
      for (const { name, options, prepare, refusal } of cases) {
        for (const [kind, land, state] of landings(context)) {
          const label = `${name}, ${kind} plan`;
          const plan = land(label, options);
          prepare?.(plan);
          refuse(archive(context, plan), refusal(plan));
          assertUntouched(context, plan, state, label);
        }
      }
    },
    SPAWN_TIMEOUT_MS,
  );

  it(
    "archive refuses a broken Steps table that parses to zero rows",
    () => {
      const context = planCliContext();
      // A broken Steps table parses to zero rows; that never counts as complete work.
      const plan = context.closedPlan("broken steps table");
      context.updateIssue(plan.number, (entry) => {
        entry.body = entry.body.replace(
          "| # | Id | Task | Files | Depends | Effect | Status | Done when |\n",
          "",
        );
      });
      refuse(archive(context, plan), "archive refused: no Steps rows parsed");
    },
    SPAWN_TIMEOUT_MS,
  );

  it(
    "archive refuses an open or closed plan whose Steps table holds a malformed row beside a done row",
    () => {
      const context = planCliContext();
      // The nine-cell row is work that the done row does not finish.
      const malformed = "| 2 | broken | Unescaped a | b | src | - | local | planned | Lost |";
      for (const [kind, land, state] of landings(context)) {
        const plan = land(`malformed row, ${kind} plan`);
        context.updateIssue(plan.number, (entry) => {
          entry.body = entry.body.replace(
            "| Records round-trip |\n",
            `| Records round-trip |\n${malformed}\n`,
          );
        });
        refuse(
          archive(context, plan),
          "Steps row 2 has 9 cells; expected 8. Escape a literal pipe as \\| so the row is preserved.",
        );
        assertUntouched(context, plan, state, `${kind} plan`);
      }
    },
    SPAWN_TIMEOUT_MS,
  );

  it(
    "archive refuses a pull request number that exists only in another repository",
    () => {
      const context = planCliContext();
      const plan = context.landedPlan("pull request of another repository");
      context.updateState((state) => {
        const pullRequest = state.prs.find((entry) => entry.number === plan.pr);
        if (pullRequest === undefined) throw new Error(`no pull request #${plan.pr}`);
        pullRequest.repository = "Another/repo";
      });
      refuse(
        archive(context, plan),
        `gh api graphql failed: gh: Could not resolve to a PullRequest with the number of ${plan.pr}.`,
      );
      assertUntouched(context, plan, "OPEN");
    },
    SPAWN_TIMEOUT_MS,
  );

  it(
    "archive refuses an open plan that is not ongoing and writes nothing",
    () => {
      const context = planCliContext();
      const plan = context.landedPlan("blocked plan");
      context.updateIssue(plan.number, (entry) => {
        entry.labels = ["plan", "plan:blocked"];
      });
      refuse(archive(context, plan), "archive requires ongoing or finished status, found blocked");
      expect(context.writes()).toStrictEqual([]);
      expect(context.waits()).toStrictEqual([]);
    },
    SPAWN_TIMEOUT_MS,
  );

  it(
    "archive refuses a retired plan and writes nothing",
    () => {
      const context = planCliContext();
      const plan = context.closedPlan("retired plan");
      context.updateIssue(plan.number, (entry) => {
        entry.stateReason = "NOT_PLANNED";
      });
      refuse(archive(context, plan), "archive requires ongoing or finished status, found retired");
      expect(context.writes()).toStrictEqual([]);
    },
    SPAWN_TIMEOUT_MS,
  );

  it(
    "archive refuses a plan that GitHub left closed with reason REOPENED and writes nothing",
    () => {
      const context = planCliContext();
      const plan = context.closedPlan("stuck plan");
      context.updateIssue(plan.number, (entry) => {
        entry.stateReason = "REOPENED";
      });
      refuse(
        archive(context, plan),
        `GitHub left plan #${plan.number} closed with reason REOPENED and refuses every state change; ask GitHub Support to repair it`,
      );
      assertUntouched(context, plan, "CLOSED");
    },
    SPAWN_TIMEOUT_MS,
  );

  it(
    "show and archive read every page of large comments",
    () => {
      const context = planCliContext();
      const plan = context.closedPlan("large comment pages");
      context.updateState((state) => {
        const entry = state.issues.find((candidate) => candidate.number === plan.number);
        if (entry === undefined) throw new Error(`no issue #${plan.number}`);
        entry.comments ??= [];
        state.nextComment ??= 1;
        for (let i = 0; i < 20; i += 1) {
          const id = state.nextComment++;
          entry.comments.push({
            id,
            body: `Evidence round ${i}\n${"x".repeat(60000)}`,
            author: "plan-agent",
            createdAt: new Date(Date.parse("2026-08-20T20:00:00Z") + id * 1000).toISOString(),
          });
        }
      });
      const largeShow = context.run("show", String(plan.number));
      expectSuccess(largeShow, "show large comment pages");
      expect(largeShow.stdout).toMatch(/^reviews: plan=none code=pass$/m);
      const largeArchive = archive(context, plan);
      expectSuccess(largeArchive, "archive large comment pages");
      expect(largeArchive.stdout).toBe(
        `plan #${plan.number} finished (closed by ${plan.closer.url})\n`,
      );
    },
    SPAWN_TIMEOUT_MS,
  );

  it(
    "show advises on a plan closed with unfinished work, and step needs a reopen before it writes",
    () => {
      const { run, updateIssue, closedPlan } = planCliContext();
      const partialMerge = closedPlan("closed by a partial merge", { status: "in-flight" });
      const partialShow = run("show", String(partialMerge.number));
      expectSuccess(partialShow, "show early closure");
      expect(
        partialShow.stdout
          .split(/\r?\n/)
          .includes(
            `advice: plan is closed as completed while step fix_parser is in-flight; closed by ${partialMerge.closer.url}; reopen the issue if work remains`,
          ),
      ).toBe(true);
      refuse(
        run("step", String(partialMerge.number), "fix_parser", "in-flight"),
        `plan #${partialMerge.number} is finished; reopen it before moving step fix_parser to in-flight`,
      );
      updateIssue(partialMerge.number, (entry) => {
        entry.state = "OPEN";
        entry.stateReason = "REOPENED";
      });
      expectSuccess(
        run("step", String(partialMerge.number), "fix_parser", "done"),
        "finish step after reopen",
      );
    },
    SPAWN_TIMEOUT_MS,
  );

  it(
    "retire repairs labels before it closes the issue, and list filters open and closed plans",
    () => {
      const { run, updateState, issue, updateIssue, createPlan } = planCliContext();
      // Retire repairs labels before closing; list retains its filtered open/closed view.
      const listed = createPlan("listed drafting plan");
      const unlisted = createPlan("issue without plan label");
      updateIssue(unlisted, (entry) => {
        entry.labels = ["other"];
      });
      const retiring = createPlan("retired plan");
      updateIssue(retiring, (entry) => {
        entry.assignees = [];
      });
      updateState((state) => {
        state.labelRemovalErrorOnce = "label removal unavailable";
      });
      refuse(
        run("retire", String(retiring), "--reason", "No longer needed"),
        "gh api graphql failed: label removal unavailable",
      );
      expect(issue(retiring).state, "a failed label repair cannot close the issue").toBe("OPEN");
      expect(issue(retiring).labels).toStrictEqual(["plan", "plan:drafting"]);
      const retired = run("retire", String(retiring), "--reason", "No longer needed");
      expectSuccess(retired, "retire an unassigned plan");
      expect(retired.stdout.trim()).toBe(`plan #${retiring} retired`);
      expect(issue(retiring).state).toBe("CLOSED");
      expect(issue(retiring).stateReason).toBe("NOT_PLANNED");
      expect(issue(retiring).labels).toStrictEqual(["plan"]);
      expect(issue(retiring).assignees, "retire claims the plan in the label edit").toStrictEqual([
        "plan-agent",
      ]);
      const draftingList = run("list", "--status", "drafting");
      expectSuccess(draftingList, "list drafting plans");
      expect(draftingList.stdout).toMatch(
        new RegExp(`^drafting\\t#${listed}\\tlisted drafting plan$`, "m"),
      );
      expect(draftingList.stdout).not.toMatch(/issue without plan label/);
      expect(draftingList.stdout).not.toMatch(new RegExp(`\\t#${retiring}\\t`));
      const retiredList = run("list", "--status", "retired");
      expectSuccess(retiredList, "list retired plans");
      expect(retiredList.stdout.trim()).toBe(`retired\t#${retiring}\tretired plan`);
    },
    SPAWN_TIMEOUT_MS,
  );

  it(
    "list advises that more plans may exist when it stops at 500 plans",
    () => {
      const { run, updateState } = planCliContext();
      updateState((state) => {
        for (let i = 0; i < 500; i += 1) {
          const number = state.nextIssue++;
          state.issues.push({
            number,
            title: `bulk plan ${i}`,
            body: "",
            state: "OPEN",
            stateReason: null,
            labels: ["plan", "plan:drafting"],
            assignees: ["plan-agent"],
            url: `https://github.com/DocksDocks/fixture/issues/${number}`,
            createdAt: "2026-08-20T20:00:00Z",
            updatedAt: "2026-08-20T20:00:00Z",
            comments: [],
            events: [],
          });
        }
      });
      const limitedList = run("list");
      expectSuccess(limitedList, "list limit advice");
      expect(limitedList.stdout).toMatch(
        /^advice: list stopped at 500 plans; more plans may exist$/m,
      );
    },
    SPAWN_TIMEOUT_MS,
  );

  it(
    "list prints open plans first, then closed plans, each in ascending number order",
    () => {
      const { run, updateIssue, createPlan, closedPlan } = planCliContext();
      // Interleave creation so number order differs from the open/closed grouping.
      const finished = closedPlan("finished plan");
      const drafting = createPlan("drafting plan");
      const retired = createPlan("retired plan");
      updateIssue(retired, (entry) => {
        entry.state = "CLOSED";
        entry.stateReason = "NOT_PLANNED";
        entry.labels = ["plan"];
      });
      const ongoing = createPlan("ongoing plan");
      updateIssue(ongoing, (entry) => {
        entry.labels = ["plan", "plan:ongoing"];
      });
      const listed = run("list");
      expectSuccess(listed, "list mixed open and closed plans");
      expect(listed.stdout.trim().split("\n")).toStrictEqual([
        `drafting\t#${drafting}\tdrafting plan`,
        `ongoing\t#${ongoing}\tongoing plan`,
        `finished\t#${finished.number}\tfinished plan`,
        `retired\t#${retired}\tretired plan`,
      ]);
    },
    SPAWN_TIMEOUT_MS,
  );
});
