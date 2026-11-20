import { describe, expect, it } from "vitest";

import type { StubReference } from "../../fixtures/gh-stub/state.ts";
import {
  PLAN_CLI_HOST_SUPPORTED,
  type LandedPlan,
  type PlanCliContext,
  type PlanResult,
  closedBy,
  expectSuccess,
  planCliContext,
  refuse,
} from "../../lib/plan/harness";
import { SPAWN_TIMEOUT_MS } from "../../lib/spawnTimeout";

// The pauses of an archive that reads an open plan 34 times: 250 ms, doubling up to 2 s, then 2 s each.
const CLOSE_WAITS = [250, 500, 1000, ...Array<number>(30).fill(2000)];
const REVIEW = { author: "plan-agent", body: "### Code review (round 2)\n\ncode-review: pass" };
// The refusal for a pull request on the default branch whose description does not close the plan.
function noClosingKeyword(plan: LandedPlan): string {
  return `pull request #${plan.pr} has no closing keyword for plan #${plan.number} in its description; ask the owner before you add \`Closes #${plan.number}\` to the merged pull request, then run archive again`;
}
// A landed plan as an archive that refuses or fails before the close leaves it.
const ONGOING = {
  state: "OPEN",
  stateReason: null,
  labels: ["plan", "plan:ongoing"],
  comments: [REVIEW],
};

// Every archive skips its waits, so the pauses for an open plan return at once and get recorded.
function archive({ runSkippingWaits }: PlanCliContext, plan: LandedPlan): PlanResult {
  return runSkippingWaits("archive", String(plan.number), "--pr", String(plan.pr));
}

function finished(plan: LandedPlan): string {
  return `plan #${plan.number} finished (closed by ${plan.closer.url})\n`;
}

// The one comment of an archive that closes the plan itself: the reason for the close, then the archive record.
function closeComment(pr: number): string {
  return `Closed by archive: pull request #${pr} merged into main and closes this plan, but GitHub left the plan open.\n\n${landingRecord(pr).body}`;
}

// The archive record that a successful archive posts on a plan that GitHub closed.
function landingRecord(pr: number): { author: string; body: string } {
  return { author: "plan-agent", body: `Archived with landing pull request #${pr}` };
}

// The plan fields that an archive may change; a comment reduces to its author and body.
function stored({ issue }: PlanCliContext, number: number) {
  const { state, stateReason, labels, comments } = issue(number);
  return {
    state,
    stateReason,
    labels,
    comments: (comments ?? []).map(({ author, body }) => ({ author, body })),
  };
}

function closes({ loadState }: PlanCliContext): Array<Array<string>> {
  return loadState().calls.filter(([group, command]) => group === "issue" && command === "close");
}

describe.skipIf(!PLAN_CLI_HOST_SUPPORTED)("plan archive closer", () => {
  it(
    "archive finishes a closed plan with terminal work, a trusted pass, and the merged closing pull request",
    () => {
      const context = planCliContext();
      const plan = context.closedPlan("merged closer");
      const archived = archive(context, plan);
      expectSuccess(archived, "archive merged closer");
      expect(archived.stdout).toBe(finished(plan));
      expect(context.waits(), "a closed plan needs no wait").toStrictEqual([]);
      expect(stored(context, plan.number)).toStrictEqual({
        state: "CLOSED",
        stateReason: "COMPLETED",
        labels: ["plan"],
        comments: [REVIEW, landingRecord(plan.pr)],
      });
    },
    SPAWN_TIMEOUT_MS,
  );

  it(
    "archive refuses without an issue or a pull request and writes nothing",
    () => {
      const context = planCliContext();
      const plan = context.closedPlan("no pull request named");
      for (const args of [[String(plan.number)], []]) {
        refuse(context.run("archive", ...args), "archive requires an issue and --pr");
      }
      expect(context.writes()).toStrictEqual([]);
    },
    SPAWN_TIMEOUT_MS,
  );

  it(
    "archive refuses a pull request that has not merged and writes nothing",
    () => {
      const context = planCliContext();
      const plan = context.landedPlan("unmerged pull request", { merged: false });
      refuse(archive(context, plan), `pull request #${plan.pr} is not merged`);
      expect(stored(context, plan.number)).toStrictEqual(ONGOING);
      expect(context.writes()).toStrictEqual([]);
      expect(context.waits()).toStrictEqual([]);
    },
    SPAWN_TIMEOUT_MS,
  );

  it(
    "archive removes a stale phase label beyond the first label page of an owned plan",
    () => {
      const context = planCliContext();
      // The owned plan needs no claim, so the label removal is the whole write.
      const plan = context.closedPlan("phase label beyond first page");
      const unrelatedLabels = Array.from({ length: 100 }, (_, index) => `topic:${index}`);
      context.updateIssue(plan.number, (entry) => {
        entry.labels = ["plan", ...unrelatedLabels, "plan:ongoing"];
        entry.assignees = ["plan-agent"];
      });
      expectSuccess(archive(context, plan), "archive label on second page");
      expect(context.issue(plan.number).labels).toStrictEqual(["plan", ...unrelatedLabels]);
    },
    SPAWN_TIMEOUT_MS,
  );

  it(
    "archive finishes a plan closed by hand when the named pull request merged into main and closes it",
    () => {
      const context = planCliContext();
      const plan = context.closedPlan("closed by hand");
      context.updateIssue(plan.number, (entry) => {
        entry.timelineItems = [{ __typename: "ClosedEvent", closer: null }];
      });
      const archived = archive(context, plan);
      expectSuccess(archived, "archive a plan closed by hand");
      expect(archived.stdout).toBe(finished(plan));
      expect(context.issue(plan.number).labels).toStrictEqual(["plan"]);
    },
    SPAWN_TIMEOUT_MS,
  );

  it(
    "archive finishes a plan that a commit or another pull request closed when the named pull request closes it",
    () => {
      const context = planCliContext();
      // A commit pushed to main without a pull request, and a manually linked pull request without a closing keyword:
      // neither proves the close, and the named pull request does.
      const oid = "c0ffee0000000000000000000000000000000003";
      context.updateState((state) => {
        state.commits = [{ oid, associatedPullRequests: [] }];
      });
      const otherPullRequest: StubReference = {
        __typename: "PullRequest",
        number: 999,
        url: "https://github.com/DocksDocks/fixture/pull/999",
        state: "MERGED",
        mergedAt: "2026-08-21T00:00:05Z",
        baseRefName: "main",
        body: null,
        repository: { nameWithOwner: "DocksDocks/fixture" },
      };
      const closers: ReadonlyArray<readonly [string, StubReference]> = [
        ["closed by a commit", { __typename: "Commit", oid }],
        ["closed by another pull request", otherPullRequest],
      ];
      for (const [name, closer] of closers) {
        const plan = context.closedPlan(name);
        context.updateIssue(plan.number, (entry) => {
          entry.timelineItems = [{ __typename: "ClosedEvent", closer }];
        });
        const archived = archive(context, plan);
        expectSuccess(archived, `archive a plan ${name}`);
        expect(archived.stdout, name).toBe(finished(plan));
        expect(context.issue(plan.number).labels, name).toStrictEqual(["plan"]);
      }
    },
    SPAWN_TIMEOUT_MS,
  );

  it(
    "archive accepts a repository-qualified closing keyword in mixed case",
    () => {
      const context = planCliContext();
      const plan = context.closedPlan("qualified closing keyword", {
        prBody: "fIxEs: dOcKsDoCkS/FiXtUrE#ISSUE",
      });
      expectSuccess(archive(context, plan), "archive qualified mixed-case keyword");
    },
    SPAWN_TIMEOUT_MS,
  );

  it(
    "archive accepts a closing keyword separated from the reference by a tab",
    () => {
      const context = planCliContext();
      const plan = context.closedPlan("tab-separated closing keyword", {
        prBody: "Resolves\t#ISSUE",
      });
      expectSuccess(archive(context, plan), "archive tab-separated keyword");
    },
    SPAWN_TIMEOUT_MS,
  );

  it(
    "archive refuses a merged pull request whose description does not prove it closes the plan",
    () => {
      const context = planCliContext();
      // Each pull request lists the plan in closingIssuesReferences, as one from the linked branch does; only a closing
      // keyword in its description proves that it closes the plan.
      const descriptions: ReadonlyArray<readonly [string, string | null]> = [
        ["number prefix", "Closes #ISSUE0"],
        ["number suffix", "Closes #ISSUEa"],
        ["keyword prefix", "notCloses #ISSUE"],
        ["issue URL", "Closes https://github.com/DocksDocks/fixture/issues/ISSUE"],
        ["different repository", "Fixes: Another/repo#ISSUE"],
        ["keyword and reference in separate paragraphs", "Closes:\n\n#ISSUE is still open"],
        ["keyword and reference on separate lines", "Closes\n#ISSUE"],
        ["null PR description", null],
      ];
      for (const [name, prBody] of descriptions) {
        const plan = context.closedPlan(name, { prBody });
        refuse(archive(context, plan), noClosingKeyword(plan));
        expect(context.issue(plan.number).labels, name).toStrictEqual(["plan", "plan:ongoing"]);
      }
    },
    SPAWN_TIMEOUT_MS,
  );

  it(
    "archive refuses a pull request merged into another branch even when its description closes the plan",
    () => {
      const context = planCliContext();
      // The base check comes first, so a valid closing keyword does not hide the wrong branch.
      const plan = context.closedPlan("closing keyword on another branch", {
        base: "release",
        prBody: "Closes #ISSUE",
      });
      refuse(
        archive(context, plan),
        `pull request #${plan.pr} merged into release; archive requires a merge into DocksDocks/fixture:main`,
      );
      expect(context.issue(plan.number).labels).toStrictEqual(["plan", "plan:ongoing"]);
      expect(context.writes()).toStrictEqual([]);
    },
    SPAWN_TIMEOUT_MS,
  );

  it(
    "archive closes an open ongoing plan that GitHub leaves open after 34 reads, then removes the phase label",
    () => {
      const context = planCliContext();
      const plan = context.landedPlan("left open by GitHub");
      const archived = archive(context, plan);
      expectSuccess(archived, "archive closes the plan");
      expect(archived.stdout).toBe(finished(plan));
      expect(context.waits()).toStrictEqual(CLOSE_WAITS);
      expect(stored(context, plan.number)).toStrictEqual({
        state: "CLOSED",
        stateReason: "COMPLETED",
        labels: ["plan"],
        comments: [REVIEW, { author: "plan-agent", body: closeComment(plan.pr) }],
      });
    },
    SPAWN_TIMEOUT_MS,
  );

  it(
    "archive finishes an open ongoing plan that GitHub closes during the waits, without closing it itself",
    () => {
      const context = planCliContext();
      const plan = context.landedPlan("closed by GitHub during the waits");
      // GitHub records the close for the merge on the third read of the plan.
      context.schedule(plan.number, { afterReads: 2, ...closedBy(plan.closer) });
      const archived = archive(context, plan);
      expectSuccess(archived, "archive after the close by GitHub");
      expect(archived.stdout).toBe(finished(plan));
      expect(context.waits(), "archive stops waiting once it reads the close").toStrictEqual([
        250, 500,
      ]);
      expect(stored(context, plan.number)).toStrictEqual({
        state: "CLOSED",
        stateReason: "COMPLETED",
        labels: ["plan"],
        comments: [REVIEW, landingRecord(plan.pr)],
      });
      expect(closes(context)).toStrictEqual([]);
    },
    SPAWN_TIMEOUT_MS,
  );

  it(
    "archive refuses an open plan whose body changes after its last read, and leaves it open",
    () => {
      const context = planCliContext();
      const plan = context.landedPlan("edited before the close");
      // Another writer adds unfinished work after the last of the 34 reads, so only the pre-write read can see it.
      const followUp =
        "| 2 | follow_up | Follow up | src/follow.mjs | - | local | planned | Follow-up lands |";
      const edited = context
        .issue(plan.number)
        .body.replace("| Records round-trip |\n", `| Records round-trip |\n${followUp}\n`);
      context.schedule(plan.number, { afterReads: 34, body: edited });
      refuse(archive(context, plan), "plan issue changed remotely; re-read and retry");
      expect(context.waits()).toStrictEqual(CLOSE_WAITS);
      expect(stored(context, plan.number)).toStrictEqual(ONGOING);
      expect(context.writes()).toStrictEqual([]);
    },
    SPAWN_TIMEOUT_MS,
  );

  it(
    "archive refuses an open plan that another login claims after its last read, and leaves it open",
    () => {
      const context = planCliContext();
      const plan = context.landedPlan("claimed before the close");
      // The claim lands after the last of the 34 reads, so only the pre-write read can see it.
      context.schedule(plan.number, { afterReads: 34, assignees: ["plan-agent", "other-agent"] });
      refuse(archive(context, plan), `plan #${plan.number} is owned by other-agent`);
      expect(context.waits()).toStrictEqual(CLOSE_WAITS);
      expect(stored(context, plan.number)).toStrictEqual(ONGOING);
      expect(context.writes()).toStrictEqual([]);
    },
    SPAWN_TIMEOUT_MS,
  );

  it(
    "archive leaves a plan open when its close fails before or after the comment; a rerun closes it with one comment",
    () => {
      const context = planCliContext();
      const failure = "HTTP 502: Bad Gateway (https://api.github.com/graphql)";
      // gh posts the comment in one request and closes the plan in a second, so the close can fail on either side of it.
      for (const [point, fault, commented] of [
        ["before the comment", "issueCloseErrorBeforeWriteOnce", false],
        ["after the comment", "issueCloseErrorAfterCommentOnce", true],
      ] as const) {
        const plan = context.landedPlan(`close fails ${point}`);
        const closed = { author: "plan-agent", body: closeComment(plan.pr) };
        context.updateState((state) => {
          state[fault] = failure;
        });
        refuse(archive(context, plan), `gh issue close failed: ${failure}`);
        const comments = commented ? [REVIEW, closed] : [REVIEW];
        expect(stored(context, plan.number), point).toStrictEqual({ ...ONGOING, comments });
        const rerun = archive(context, plan);
        expectSuccess(rerun, `rerun archive after a close that failed ${point}`);
        expect(rerun.stdout, point).toBe(finished(plan));
        expect(stored(context, plan.number), point).toStrictEqual({
          state: "CLOSED",
          stateReason: "COMPLETED",
          labels: ["plan"],
          comments: [REVIEW, closed],
        });
      }
    },
    SPAWN_TIMEOUT_MS,
  );
});
