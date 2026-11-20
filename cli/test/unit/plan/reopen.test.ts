import { describe, expect, it } from "vitest";

import type { StubChange, StubReference } from "../../fixtures/gh-stub/state";
import {
  PLAN_CLI_HOST_SUPPORTED,
  type PartialMerge,
  type PartialMergeOptions,
  type PlanCliContext,
  type PlanResult,
  closedBy,
  expectSuccess,
  planCliContext,
  refuse,
} from "../../lib/plan/harness";
import { SPAWN_TIMEOUT_MS } from "../../lib/spawnTimeout";

// The fake gh counts the GraphQL reads of each issue and lands a scheduled change once the plan has served
// `afterReads` of them. These cases expect `reopen` to read the plan once per poll, the first read being
// poll 1, and once more after the settle wait, right before its single write request.
const SETTLE_WAIT = 10_000;
const ONGOING = {
  state: "OPEN",
  stateReason: null,
  labels: ["plan", "plan:ongoing"],
  assignees: [],
  comments: [],
};

function reopenComment(pr: number): string {
  return `Reopened: partial pull request #${pr} closed this plan through its linked branch. Work continues.`;
}

function stuckRefusal(number: number): string {
  return `GitHub left plan #${number} closed with reason REOPENED and refuses every state change; ask GitHub Support to repair it`;
}

function settleRefusal(number: number): string {
  return `plan #${number} changed during the settle wait; run reopen again`;
}

function closedAgainRefusal(number: number): string {
  return `plan #${number} closed again after the reopen; run reopen again`;
}

function childPlanRefusal(number: number): string {
  return `plan #${number} uses child plans; a partial pull request is not allowed (open a child plan with new --parent ${number})`;
}

// A close that lands after the merge of the pull request and after the first write of the reopen.
const LATER_CLOSE = "2026-08-21T00:00:09Z";

// Every reopen skips its waits, so its pauses and its settle wait return at once and get recorded.
function reopen({ runSkippingWaits }: PlanCliContext, plan: PartialMerge): PlanResult {
  return runSkippingWaits("reopen", String(plan.number), "--pr", String(plan.pr));
}

// The plan fields that a reopen may change; a comment reduces to its author and body.
function stored({ issue }: PlanCliContext, number: number) {
  const { state, stateReason, labels, assignees, comments } = issue(number);
  return {
    state,
    stateReason,
    labels,
    assignees,
    comments: comments?.map(({ author, body }) => ({ author, body })),
  };
}

describe.skipIf(!PLAN_CLI_HOST_SUPPORTED)("plan reopen", () => {
  it(
    "reopen waits for the close by the pull request, then reopens with the contract comment and a claim",
    () => {
      const context = planCliContext();
      const plan = context.partialMerge("reopen after the close");
      // GitHub records the close on the third read, so the helper pauses 250 ms and 500 ms before it sees it.
      context.schedule(plan.number, { afterReads: 2, ...closedBy(plan.closer) });
      const result = reopen(context, plan);
      expectSuccess(result, "reopen");
      expect(result.stdout).toBe(`plan #${plan.number} reopened: ongoing\n`);
      expect(result.stderr).toBe("");
      expect(context.waits()).toStrictEqual([250, 500, SETTLE_WAIT]);
      expect(stored(context, plan.number)).toStrictEqual({
        ...ONGOING,
        stateReason: "REOPENED",
        assignees: ["plan-agent"],
        comments: [{ author: "plan-agent", body: reopenComment(plan.pr) }],
      });
      expect(
        context.writes().length,
        "the reopen, the comment, and the claim land in one request",
      ).toBe(1);
    },
    SPAWN_TIMEOUT_MS,
  );

  it(
    "reopen restores the ongoing phase label of a plan that lost it, in the same request",
    () => {
      const context = planCliContext();
      const plan = context.partialMerge("reopen without a phase label", {
        assignees: ["plan-agent"],
      });
      context.updateIssue(plan.number, (entry) => {
        entry.labels = ["plan"];
      });
      context.schedule(plan.number, { afterReads: 0, ...closedBy(plan.closer) });
      const result = reopen(context, plan);
      expectSuccess(result, "reopen a plan without a phase label");
      expect(result.stdout).toBe(`plan #${plan.number} reopened: ongoing\n`);
      expect(stored(context, plan.number).labels).toStrictEqual(["plan", "plan:ongoing"]);
      expect(
        context.writes().length,
        "the reopen, the label, and the comment land in one request",
      ).toBe(1);
    },
    SPAWN_TIMEOUT_MS,
  );

  it(
    "reopen accepts the close by a commit of the merged pull request and leaves an owned plan with its owner",
    () => {
      const context = planCliContext();
      const plan = context.partialMerge("commit close", { assignees: ["plan-agent"] });
      const oid = "c0ffee0000000000000000000000000000000001";
      context.updateState((state) => {
        state.commits = [{ oid, associatedPullRequests: [{ number: plan.pr }] }];
      });
      context.schedule(plan.number, {
        afterReads: 0,
        ...closedBy({ __typename: "Commit", oid }),
      });
      const result = reopen(context, plan);
      expectSuccess(result, "reopen after a commit close");
      expect(result.stdout).toBe(`plan #${plan.number} reopened: ongoing\n`);
      expect(context.waits()).toStrictEqual([SETTLE_WAIT]);
      expect(stored(context, plan.number)).toStrictEqual({
        ...ONGOING,
        stateReason: "REOPENED",
        assignees: ["plan-agent"],
        comments: [{ author: "plan-agent", body: reopenComment(plan.pr) }],
      });
      expect(context.writes().length).toBe(1);
    },
    SPAWN_TIMEOUT_MS,
  );

  it(
    "reopen finds the merged pull request of a commit closer beyond the first page of its pull requests",
    () => {
      const context = planCliContext();
      const plan = context.partialMerge("commit close beyond the first page");
      const oid = "c0ffee0000000000000000000000000000000002";
      // GitHub returns the pull requests of a commit 100 per page; the merged pull request comes after 100 others.
      const others = Array.from({ length: 100 }, (_, index) => ({
        number: 10_000 + index,
        state: "MERGED",
        mergedAt: "2026-08-21T00:00:00Z",
        baseRefName: "release",
      }));
      context.updateState((state) => {
        state.commits = [{ oid, associatedPullRequests: [...others, { number: plan.pr }] }];
      });
      context.schedule(plan.number, {
        afterReads: 0,
        ...closedBy({ __typename: "Commit", oid }),
      });
      const result = reopen(context, plan);
      expectSuccess(result, "reopen after a commit close whose pull request is on the second page");
      expect(result.stdout).toBe(`plan #${plan.number} reopened: ongoing\n`);
    },
    SPAWN_TIMEOUT_MS,
  );

  it(
    "reopen writes nothing when the merged pull request does not close the plan",
    () => {
      const context = planCliContext();
      const plan = context.partialMerge("not closed by the pull request", { closes: false });
      const result = reopen(context, plan);
      expectSuccess(result, "reopen without a closing reference");
      expect(result.stdout).toBe(
        `pull request #${plan.pr} does not close plan #${plan.number}; nothing to reopen\n`,
      );
      expect(result.stderr).toBe("");
      expect(stored(context, plan.number)).toStrictEqual(ONGOING);
      expect(context.writes()).toStrictEqual([]);
      expect(context.waits()).toStrictEqual([]);
    },
    SPAWN_TIMEOUT_MS,
  );

  it(
    "reopen leaves a retired plan untouched when the merged pull request does not close it",
    () => {
      const context = planCliContext();
      // The shape of probe issue #94: retired, unlabelled, owned by the viewer, and not closed by #95.
      const plan = context.partialMerge("retired probe", {
        assignees: ["plan-agent"],
        closes: false,
      });
      context.updateIssue(plan.number, (entry) => {
        entry.state = "CLOSED";
        entry.stateReason = "NOT_PLANNED";
        entry.labels = [];
      });
      const result = reopen(context, plan);
      expectSuccess(result, "reopen a retired plan");
      expect(result.stdout).toBe(
        `pull request #${plan.pr} does not close plan #${plan.number}; nothing to reopen\n`,
      );
      expect(stored(context, plan.number)).toStrictEqual({
        ...ONGOING,
        state: "CLOSED",
        stateReason: "NOT_PLANNED",
        labels: [],
        assignees: ["plan-agent"],
      });
      expect(context.writes()).toStrictEqual([]);
    },
    SPAWN_TIMEOUT_MS,
  );

  it(
    "reopen refuses a pull request that has not merged",
    () => {
      const context = planCliContext();
      const plan = context.partialMerge("unmerged pull request", { merged: false });
      refuse(reopen(context, plan), `pull request #${plan.pr} is not merged`);
      expect(stored(context, plan.number)).toStrictEqual(ONGOING);
      expect(context.writes()).toStrictEqual([]);
    },
    SPAWN_TIMEOUT_MS,
  );

  it(
    "reopen refuses a v5 plan before any wait or write, and names child plans",
    () => {
      const context = planCliContext();
      // A v5 plan lands each pull request through a child plan, so a partial pull request that closed it is refused.
      const plan = context.partialMerge("v5 partial pull request", { version: 5 });
      context.schedule(plan.number, { afterReads: 0, ...closedBy(plan.closer) });
      refuse(reopen(context, plan), childPlanRefusal(plan.number));
      expect(context.writes()).toStrictEqual([]);
      expect(context.waits()).toStrictEqual([]);
      expect(context.issue(plan.number).state, "the plan stays closed").toBe("CLOSED");
    },
    SPAWN_TIMEOUT_MS,
  );

  for (const [name, options] of [
    ["an unmerged pull request", { merged: false }],
    ["a pull request that does not close the plan", { closes: false }],
  ] as const satisfies ReadonlyArray<readonly [string, PartialMergeOptions]>) {
    it(
      `reopen refuses a v5 plan with ${name} before it reads the pull request`,
      () => {
        const context = planCliContext();
        const plan = context.partialMerge(`v5 plan with ${name}`, { version: 5, ...options });
        refuse(reopen(context, plan), childPlanRefusal(plan.number));
        expect(
          context
            .loadState()
            .calls.filter(([group, command]) => group === "api" && command === "graphql"),
          "the pull request is not read",
        ).toStrictEqual([]);
        expect(context.writes()).toStrictEqual([]);
        expect(stored(context, plan.number)).toStrictEqual(ONGOING);
      },
      SPAWN_TIMEOUT_MS,
    );
  }

  it(
    "reopen refuses a plan that another closer closed after the pull request merged",
    () => {
      const context = planCliContext();
      const plan = context.partialMerge("closed by another pull request");
      const other = {
        __typename: "PullRequest",
        number: plan.pr + 1,
        url: `https://github.com/DocksDocks/fixture/pull/${plan.pr + 1}`,
        state: "MERGED",
        mergedAt: "2026-08-21T00:00:05Z",
        baseRefName: "main",
        repository: { nameWithOwner: "DocksDocks/fixture" },
      } satisfies StubReference;
      context.schedule(plan.number, {
        afterReads: 0,
        ...closedBy(other, "2026-08-21T00:00:06Z"),
      });
      refuse(
        reopen(context, plan),
        `plan #${plan.number} was closed by ${other.url} after pull request #${plan.pr} merged; reopen it by hand only if that close was a mistake`,
      );
      expect(stored(context, plan.number)).toStrictEqual({
        ...ONGOING,
        state: "CLOSED",
        stateReason: "COMPLETED",
      });
      expect(context.writes()).toStrictEqual([]);
    },
    SPAWN_TIMEOUT_MS,
  );

  it(
    "reopen refuses a plan that GitHub left closed with reason REOPENED, and show advises GitHub Support",
    () => {
      const context = planCliContext();
      const plan = context.partialMerge("stuck before the reopen");
      // A hand reopen raced GitHub's close, as in #90.
      context.schedule(plan.number, {
        afterReads: 0,
        ...closedBy(plan.closer),
        stateReason: "REOPENED",
      });
      refuse(reopen(context, plan), stuckRefusal(plan.number));
      expect(stored(context, plan.number)).toStrictEqual({
        ...ONGOING,
        state: "CLOSED",
        stateReason: "REOPENED",
      });
      expect(context.writes()).toStrictEqual([]);
      const shown = context.run("show", String(plan.number));
      expectSuccess(shown, "show a stuck plan");
      const lines = shown.stdout.split("\n");
      expect(lines[0]).toBe(
        `#${plan.number} · unreadable · stuck before the reopen · https://github.com/DocksDocks/fixture/issues/${plan.number}`,
      );
      expect(
        lines.includes(
          "advice: GitHub left this issue closed with reason REOPENED and refuses every state change; ask GitHub Support to repair it, and record step results in an issue comment until then",
        ),
        shown.stdout,
      ).toBe(true);
    },
    SPAWN_TIMEOUT_MS,
  );

  it(
    "reopen refuses when GitHub leaves the plan closed with reason REOPENED after the reopen",
    () => {
      const context = planCliContext();
      const plan = context.partialMerge("stuck after the reopen");
      context.schedule(plan.number, { afterReads: 0, ...closedBy(plan.closer) });
      context.updateState((state) => {
        state.reopenLeavesClosed = true;
      });
      refuse(reopen(context, plan), stuckRefusal(plan.number));
      // The one request ran every field: the comment and the claim landed, and only the state stuck.
      expect(stored(context, plan.number)).toStrictEqual({
        ...ONGOING,
        state: "CLOSED",
        stateReason: "REOPENED",
        assignees: ["plan-agent"],
        comments: [{ author: "plan-agent", body: reopenComment(plan.pr) }],
      });
      expect(context.writes().length).toBe(1);
    },
    SPAWN_TIMEOUT_MS,
  );

  for (const [name, change] of [
    ["as completed", {}],
    ["as not planned", { stateReason: "NOT_PLANNED" }],
  ] as const satisfies ReadonlyArray<readonly [string, StubChange]>) {
    it(
      `reopen names its rerun when another actor closes the plan ${name} right after the write`,
      () => {
        const context = planCliContext();
        const plan = context.partialMerge(`closed ${name} after the reopen`);
        context.schedule(plan.number, { afterReads: 0, ...closedBy(plan.closer) });
        context.updateState((state) => {
          state.afterMutationOnce = {
            issue: plan.number,
            ...closedBy(null, LATER_CLOSE),
            ...change,
          };
        });
        const result = reopen(context, plan);
        refuse(result, closedAgainRefusal(plan.number));
        expect(result.stdout, "no reopened status is reported").toBe("");
        expect(context.writes().length).toBe(1);
        // The rerun reads the close by the other actor and leaves it to a hand decision.
        refuse(
          reopen(context, plan),
          `plan #${plan.number} was closed by an unknown closer after pull request #${plan.pr} merged; reopen it by hand only if that close was a mistake`,
        );
        expect(context.writes().length, "the rerun writes nothing").toBe(1);
        const { state, stateReason } = context.issue(plan.number);
        const expectedReason: string = "stateReason" in change ? change.stateReason : "COMPLETED";
        expect([state, stateReason]).toStrictEqual(["CLOSED", expectedReason]);
      },
      SPAWN_TIMEOUT_MS,
    );
  }

  it(
    "reopen names its rerun, which reopens the plan, when the pull request closes it again right after the write",
    () => {
      const context = planCliContext();
      const plan = context.partialMerge("closed again by the pull request");
      context.schedule(plan.number, { afterReads: 0, ...closedBy(plan.closer) });
      context.updateState((state) => {
        state.afterMutationOnce = { issue: plan.number, ...closedBy(plan.closer, LATER_CLOSE) };
      });
      refuse(reopen(context, plan), closedAgainRefusal(plan.number));
      const result = reopen(context, plan);
      expectSuccess(result, "reopen after the new close");
      expect(result.stdout).toBe(`plan #${plan.number} reopened: ongoing\n`);
      expect(stored(context, plan.number)).toStrictEqual({
        ...ONGOING,
        stateReason: "REOPENED",
        assignees: ["plan-agent"],
        comments: [
          { author: "plan-agent", body: reopenComment(plan.pr) },
          { author: "plan-agent", body: reopenComment(plan.pr) },
        ],
      });
      expect(context.writes().length).toBe(2);
    },
    SPAWN_TIMEOUT_MS,
  );

  it(
    "reopen refuses with the stuck state when GitHub answers the reopen with an error",
    () => {
      const context = planCliContext();
      const plan = context.partialMerge("reopen answered with an error");
      // Another reopen races GitHub's close after the helper's second read, so the issue is stuck at the write.
      context.schedule(
        plan.number,
        { afterReads: 0, ...closedBy(plan.closer) },
        { afterReads: 2, stateReason: "REOPENED" },
      );
      refuse(reopen(context, plan), stuckRefusal(plan.number));
      const { state, stateReason } = context.issue(plan.number);
      expect([state, stateReason]).toStrictEqual(["CLOSED", "REOPENED"]);
      expect(context.writes().length, "the helper does not retry the reopen").toBe(1);
    },
    SPAWN_TIMEOUT_MS,
  );

  it(
    "reopen prints the open status and writes nothing for a plan reopened after the pull request closed it",
    () => {
      const context = planCliContext();
      const plan = context.partialMerge("already reopened");
      context.schedule(plan.number, {
        afterReads: 0,
        ...closedBy(plan.closer),
        state: "OPEN",
        stateReason: "REOPENED",
      });
      const result = reopen(context, plan);
      expectSuccess(result, "reopen an open plan");
      expect(result.stdout).toBe(`plan #${plan.number} is open: ongoing\n`);
      expect(result.stderr).toBe("");
      expect(stored(context, plan.number)).toStrictEqual({ ...ONGOING, stateReason: "REOPENED" });
      expect(context.writes()).toStrictEqual([]);
    },
    SPAWN_TIMEOUT_MS,
  );

  it(
    "reopen prints the open status and writes nothing when someone reopens the plan during the settle wait",
    () => {
      const context = planCliContext();
      const plan = context.partialMerge("reopened during the settle wait");
      context.schedule(
        plan.number,
        { afterReads: 0, ...closedBy(plan.closer) },
        { afterReads: 1, state: "OPEN", stateReason: "REOPENED" },
      );
      const result = reopen(context, plan);
      expectSuccess(result, "reopen a plan reopened meanwhile");
      expect(result.stdout).toBe(`plan #${plan.number} is open: ongoing\n`);
      expect(result.stderr).toBe("");
      expect(context.waits()).toStrictEqual([SETTLE_WAIT]);
      expect(stored(context, plan.number)).toStrictEqual({ ...ONGOING, stateReason: "REOPENED" });
      expect(context.writes()).toStrictEqual([]);
    },
    SPAWN_TIMEOUT_MS,
  );

  it(
    "reopen refuses a plan whose latest close changes during the settle wait",
    () => {
      const context = planCliContext();
      const plan = context.partialMerge("closed again during the settle wait");
      // A later close by the same pull request replaces the latest close, so only the time of the close differs.
      const laterClose = "2026-08-21T00:00:09Z";
      context.schedule(
        plan.number,
        { afterReads: 0, ...closedBy(plan.closer) },
        { afterReads: 1, ...closedBy(plan.closer, laterClose) },
      );
      refuse(reopen(context, plan), settleRefusal(plan.number));
      expect(context.waits()).toStrictEqual([SETTLE_WAIT]);
      expect(stored(context, plan.number)).toStrictEqual({
        ...ONGOING,
        state: "CLOSED",
        stateReason: "COMPLETED",
      });
      expect(context.issue(plan.number).timelineItems?.at(-1)?.createdAt).toBe(laterClose);
      expect(context.writes()).toStrictEqual([]);
    },
    SPAWN_TIMEOUT_MS,
  );

  it(
    "reopen refuses a plan that someone closes as not planned during the settle wait",
    () => {
      const context = planCliContext();
      const plan = context.partialMerge("not planned during the settle wait");
      // The latest close stays the same. A closed plan takes its status from the close reason, so the plan reads
      // retired instead of finished.
      context.schedule(
        plan.number,
        { afterReads: 0, ...closedBy(plan.closer) },
        { afterReads: 1, stateReason: "NOT_PLANNED" },
      );
      refuse(reopen(context, plan), settleRefusal(plan.number));
      expect(context.waits()).toStrictEqual([SETTLE_WAIT]);
      expect(stored(context, plan.number)).toStrictEqual({
        ...ONGOING,
        state: "CLOSED",
        stateReason: "NOT_PLANNED",
      });
      expect(context.writes()).toStrictEqual([]);
    },
    SPAWN_TIMEOUT_MS,
  );

  it(
    "reopen refuses after 34 reads when GitHub never closes the plan for the merged pull request",
    () => {
      const context = planCliContext();
      const plan = context.partialMerge("never closed");
      // The latest close is older than this merge: a commit that an earlier partial pull request merged, and that
      // this pull request also contains, closed the plan before someone reopened it.
      const earlier = plan.pr - 1;
      const oid = "c0ffee0000000000000000000000000000000002";
      context.updateState((state) => {
        state.prs.push({
          number: earlier,
          url: `https://github.com/DocksDocks/fixture/pull/${earlier}`,
          state: "MERGED",
          mergedAt: "2026-08-20T22:00:00Z",
          baseRefName: "main",
          repository: "DocksDocks/fixture",
          closingIssuesReferences: [plan.number],
        });
        state.commits = [
          { oid, associatedPullRequests: [{ number: earlier }, { number: plan.pr }] },
        ];
      });
      context.updateIssue(plan.number, (entry) => {
        entry.stateReason = "REOPENED";
        entry.timelineItems = [
          {
            __typename: "ClosedEvent",
            closer: { __typename: "Commit", oid },
            createdAt: "2026-08-20T22:00:02Z",
          },
        ];
      });
      refuse(
        reopen(context, plan),
        `GitHub has not closed plan #${plan.number} for pull request #${plan.pr} yet; run reopen again once it has`,
      );
      expect(context.issue(plan.number).graphqlReads).toBe(34);
      // The pause starts at 250 ms and doubles up to 2 s between reads; no settle wait follows.
      expect(context.waits()).toStrictEqual([
        250,
        500,
        1000,
        ...Array.from({ length: 30 }, () => 2000),
      ]);
      expect(stored(context, plan.number)).toStrictEqual({ ...ONGOING, stateReason: "REOPENED" });
      expect(context.writes()).toStrictEqual([]);
    },
    SPAWN_TIMEOUT_MS,
  );

  it(
    "reopen refuses after 34 reads when another closer closed the plan before the pull request merged",
    () => {
      const context = planCliContext();
      const plan = context.partialMerge("closed before the merge");
      const earlier = {
        __typename: "PullRequest",
        number: plan.pr - 1,
        url: `https://github.com/DocksDocks/fixture/pull/${plan.pr - 1}`,
        state: "MERGED",
        mergedAt: "2026-08-20T22:00:00Z",
        baseRefName: "main",
        repository: { nameWithOwner: "DocksDocks/fixture" },
      } satisfies StubReference;
      // GitHub cannot close a closed issue, so this merge adds no close, and "run reopen again" would loop forever.
      context.schedule(plan.number, {
        afterReads: 0,
        ...closedBy(earlier, "2026-08-20T22:00:02Z"),
      });
      refuse(
        reopen(context, plan),
        `plan #${plan.number} was closed by ${earlier.url} before pull request #${plan.pr} merged; reopen it by hand only if that close was a mistake`,
      );
      expect(context.issue(plan.number).graphqlReads).toBe(34);
      expect(context.waits()).toStrictEqual([
        250,
        500,
        1000,
        ...Array.from({ length: 30 }, () => 2000),
      ]);
      expect(stored(context, plan.number)).toStrictEqual({
        ...ONGOING,
        state: "CLOSED",
        stateReason: "COMPLETED",
      });
      expect(context.writes()).toStrictEqual([]);
    },
    SPAWN_TIMEOUT_MS,
  );

  it(
    "reopen refuses a plan that another login claims during the settle wait",
    () => {
      const context = planCliContext();
      const plan = context.partialMerge("claimed during the settle wait");
      context.schedule(
        plan.number,
        { afterReads: 0, ...closedBy(plan.closer) },
        { afterReads: 1, assignees: ["other-agent"] },
      );
      refuse(reopen(context, plan), `plan #${plan.number} is owned by other-agent`);
      expect(context.waits()).toStrictEqual([SETTLE_WAIT]);
      expect(stored(context, plan.number)).toStrictEqual({
        ...ONGOING,
        state: "CLOSED",
        stateReason: "COMPLETED",
        assignees: ["other-agent"],
      });
      expect(context.writes()).toStrictEqual([]);
    },
    SPAWN_TIMEOUT_MS,
  );

  it(
    "reopen refuses a plan that another login claims after the settle-wait read, right before the write",
    () => {
      const context = planCliContext();
      const plan = context.partialMerge("claimed before the write");
      // The claim lands after the read that follows the settle wait, so only the pre-write read can see it.
      context.schedule(
        plan.number,
        { afterReads: 0, ...closedBy(plan.closer) },
        { afterReads: 2, assignees: ["other-agent"] },
      );
      refuse(reopen(context, plan), `plan #${plan.number} is owned by other-agent`);
      expect(context.waits()).toStrictEqual([SETTLE_WAIT]);
      expect(stored(context, plan.number)).toStrictEqual({
        ...ONGOING,
        state: "CLOSED",
        stateReason: "COMPLETED",
        assignees: ["other-agent"],
      });
      expect(context.writes()).toStrictEqual([]);
    },
    SPAWN_TIMEOUT_MS,
  );
});
