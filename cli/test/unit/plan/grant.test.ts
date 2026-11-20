import { describe, expect, it } from "vitest";

import {
  PLAN_CLI_HOST_SUPPORTED,
  type PlanCliContext,
  body,
  expectSuccess,
  planCliContext,
} from "../../lib/plan/harness";
import { SPAWN_TIMEOUT_MS } from "../../lib/spawnTimeout";

// Authority events and the `grant:` line of `show` (contract, Delegated decisions).

const YOLO_LINE = "Yolo: the user delegated every decision except the merge to the agent.";
const QUOTE = "decide yourself";
const delegatedLine = (quote: string): string =>
  `Delegated: the user delegated the design and tradeoff decisions to the agent. User: "${quote}"`;
// The harness gives comment k the time 2026-08-20T20:00:00Z plus k seconds.
const at = (seconds: number): string =>
  new Date(Date.parse("2026-08-20T20:00:00Z") + seconds * 1000).toISOString();

// A plan body whose Goal holds `lines` after its first paragraph.
function withGoal(...lines: ReadonlyArray<string>): string {
  return body().replace("Fix the parser.\n", `Fix the parser.\n\n${lines.join("\n")}\n`);
}

// Post a comment and return its id, the number that `show` names.
function post(context: PlanCliContext, number: number, text: string, author?: string): string {
  // The harness starts every state at comment 1.
  const id = context.loadState().nextComment ?? 1;
  context.addIssueComment(number, text, author);
  return String(id);
}

function setCreatedAt(
  context: PlanCliContext,
  number: number,
  id: string,
  createdAt: string,
): void {
  context.updateIssue(number, (entry) => {
    const comment = entry.comments?.find((candidate) => String(candidate.id) === id);
    if (comment === undefined) throw new Error(`plan #${number} has no comment ${id}`);
    comment.createdAt = createdAt;
  });
}

// The output of `show`, after a check that the grant line follows the reviews line.
function show(
  context: PlanCliContext,
  number: number,
): { readonly grant: string | undefined; readonly lines: ReadonlyArray<string> } {
  const shown = context.run("show", String(number));
  expectSuccess(shown, `show #${number}`);
  const lines = shown.stdout.split("\n");
  expect(lines[1]).toMatch(/^reviews: /);
  expect(lines[2]).toMatch(/^grant: /);
  return { grant: lines[2], lines };
}

const grantLine = (context: PlanCliContext, number: number): string | undefined =>
  show(context, number).grant;

// A child plan of `parent` whose Goal holds `lines`.
function childWithGoal(
  context: PlanCliContext,
  parent: number,
  ...lines: ReadonlyArray<string>
): number {
  const child = context.createChild("child plan", parent).number;
  context.updateIssue(child, (entry) => {
    entry.body = withGoal(...lines);
  });
  return child;
}

const endedAdvice = (parent: number, id: string): string =>
  `advice: parent #${parent} comment ${id} ended the grant; remove the delegation line from Goal, with no new event`;

describe.skipIf(!PLAN_CLI_HOST_SUPPORTED)("plan grant", () => {
  it(
    "show prints grant: none for a plan without an authority event or a delegation line",
    () => {
      const context = planCliContext();
      const plan = context.createPlan("no grant");
      expect(grantLine(context, plan)).toBe("grant: none");
      post(context, plan, "## Plan review (round 1)\n\nplan-review: pass");
      post(context, plan, "Delegation granted to the agent, as discussed.");
      expect(grantLine(context, plan)).toBe("grant: none");
    },
    SPAWN_TIMEOUT_MS,
  );

  it(
    "a trusted grant event with its matching Delegated line is in force",
    () => {
      const context = planCliContext();
      const plan = context.createPlan("delegated grant", withGoal(delegatedLine(QUOTE)));
      const grant = post(context, plan, `Delegation grant: ${QUOTE}`);
      expect(grantLine(context, plan)).toBe(`grant: in force (delegated) by comment ${grant}`);
      // The quotes compare after trimming and without one pair of surrounding double quotes.
      const quoted = post(context, plan, `Delegation grant: "${QUOTE}"`);
      expect(grantLine(context, plan)).toBe(`grant: in force (delegated) by comment ${quoted}`);
    },
    SPAWN_TIMEOUT_MS,
  );

  it(
    "a trusted yolo grant event with the yolo line is in force",
    () => {
      const context = planCliContext();
      const plan = context.createPlan("yolo grant", withGoal(YOLO_LINE));
      const grant = post(context, plan, "Delegation grant: yolo: go for the best durable solution");
      expect(grantLine(context, plan)).toBe(`grant: in force (yolo) by comment ${grant}`);
    },
    SPAWN_TIMEOUT_MS,
  );

  it(
    "a revocation ends the grant, also when the user types it by hand",
    () => {
      const context = planCliContext();
      const plan = context.createPlan("revoked grant", withGoal(YOLO_LINE));
      for (const revocation of [
        "Delegation revoked",
        'Delegation revoked\n"stop deciding for me"',
        "**Delegation revoked**",
        "`delegation REVOKED`",
        "\n  _Delegation Revoked_  \n",
      ]) {
        const grant = post(context, plan, "Delegation grant: yolo: go");
        expect(grantLine(context, plan), revocation).toBe(
          `grant: in force (yolo) by comment ${grant}`,
        );
        const revoked = post(context, plan, revocation);
        expect(grantLine(context, plan), revocation).toBe(
          `grant: ended by revocation comment ${revoked}`,
        );
      }
    },
    SPAWN_TIMEOUT_MS,
  );

  it(
    "only trusted events count: an untrusted author and two assignees give no grant",
    () => {
      const context = planCliContext();
      const plan = context.createPlan("untrusted grant", withGoal(YOLO_LINE));
      post(context, plan, "Delegation grant: yolo: go", "foreign-agent");
      const untrusted = "grant: none; the Goal delegation line has no trusted authority event";
      expect(grantLine(context, plan)).toBe(untrusted);
      const grant = post(context, plan, "Delegation grant: yolo: go");
      expect(grantLine(context, plan)).toBe(`grant: in force (yolo) by comment ${grant}`);
      post(context, plan, "Delegation revoked", "foreign-agent");
      expect(grantLine(context, plan), "an untrusted revocation").toBe(
        `grant: in force (yolo) by comment ${grant}`,
      );
      context.updateIssue(plan, (entry) => {
        entry.assignees = ["plan-agent", "foreign-agent"];
      });
      expect(grantLine(context, plan)).toBe(untrusted);
    },
    SPAWN_TIMEOUT_MS,
  );

  it(
    "a live delegation line without a trusted event gives no grant",
    () => {
      const context = planCliContext();
      for (const line of [YOLO_LINE, delegatedLine(QUOTE)]) {
        const plan = context.createPlan("line without event", withGoal(line));
        expect(grantLine(context, plan)).toBe(
          "grant: none; the Goal delegation line has no trusted authority event",
        );
      }
    },
    SPAWN_TIMEOUT_MS,
  );

  it(
    "a Goal line that does not match the deciding event gives no grant",
    () => {
      const context = planCliContext();
      const mismatch = (id: string): string =>
        `the Goal delegation line does not match comment ${id}`;
      const twoLines = (id: string): string => `the Goal has 2 delegation lines for comment ${id}`;
      const noLine = (id: string): string => `the Goal has no delegation line for comment ${id}`;
      const typographic = delegatedLine(QUOTE).replace(/"(.*)"$/, "\u201c$1\u201d");
      const cases: ReadonlyArray<
        readonly [string, ReadonlyArray<string>, string, (id: string) => string]
      > = [
        ["a quote mismatch", [delegatedLine(QUOTE)], "Delegation grant: go fast", mismatch],
        ["typographic quotes", [typographic], `Delegation grant: ${QUOTE}`, mismatch],
        ["a yolo line for a Delegated event", [YOLO_LINE], `Delegation grant: ${QUOTE}`, mismatch],
        [
          "a Delegated line for a yolo event",
          [delegatedLine(QUOTE)],
          `Delegation grant: yolo: ${QUOTE}`,
          mismatch,
        ],
        [
          "both lines",
          [YOLO_LINE, "", delegatedLine(QUOTE)],
          "Delegation grant: yolo: go",
          twoLines,
        ],
        ["no line", [], "Delegation grant: yolo: go", noLine],
      ];
      for (const [name, lines, event, reason] of cases) {
        const plan = context.createPlan(name, lines.length ? withGoal(...lines) : body());
        const id = post(context, plan, event);
        expect(grantLine(context, plan), name).toBe(`grant: none; ${reason(id)}`);
      }
    },
    SPAWN_TIMEOUT_MS,
  );

  it(
    "a quoted, decorated, or fenced event line and a fenced or indented Goal line do not count",
    () => {
      const context = planCliContext();
      const plan = context.createPlan("quoted events", withGoal(YOLO_LINE));
      for (const text of [
        "> Delegation grant: yolo: go",
        "**Delegation grant: yolo: go**",
        "`Delegation grant: yolo: go`",
        " Delegation grant: yolo: go",
        "delegation grant: yolo: go",
        "```\nDelegation grant: yolo: go\n```",
        "As agreed:\nDelegation grant: yolo: go",
      ]) {
        post(context, plan, text);
      }
      expect(grantLine(context, plan)).toBe(
        "grant: none; the Goal delegation line has no trusted authority event",
      );
      for (const lines of [["```text", YOLO_LINE, "```"], [`    ${YOLO_LINE}`]]) {
        const example = context.createPlan("example line", withGoal(...lines));
        const grant = post(context, example, "Delegation grant: yolo: go");
        expect(grantLine(context, example)).toBe(
          `grant: none; the Goal has no delegation line for comment ${grant}`,
        );
      }
    },
    SPAWN_TIMEOUT_MS,
  );

  it(
    "a narrowed yolo grant is in force as the narrower Delegated grant",
    () => {
      const context = planCliContext();
      const plan = context.createPlan("narrowed yolo", withGoal(YOLO_LINE));
      post(context, plan, "Delegation grant: yolo: go");
      post(context, plan, "Delegation revoked");
      const narrowed = post(context, plan, `Delegation grant: ${QUOTE}`);
      expect(grantLine(context, plan)).toBe(
        `grant: none; the Goal delegation line does not match comment ${narrowed}`,
      );
      context.updateIssue(plan, (entry) => {
        entry.body = withGoal(delegatedLine(QUOTE));
      });
      expect(grantLine(context, plan)).toBe(`grant: in force (delegated) by comment ${narrowed}`);
    },
    SPAWN_TIMEOUT_MS,
  );

  it(
    "a child grant with a Parent event link holds only while that event is the parent latest",
    () => {
      const context = planCliContext();
      const parent = context.createPlan("parent plan", withGoal(YOLO_LINE));
      const parentGrant = post(context, parent, "Delegation grant: yolo: go");
      const child = childWithGoal(context, parent, YOLO_LINE);
      const childGrant = post(
        context,
        child,
        `Delegation grant: yolo: go\nParent event: ${parentGrant}`,
      );
      expect(grantLine(context, child)).toBe(`grant: in force (yolo) by comment ${childGrant}`);
      const revoked = post(context, parent, "Delegation revoked");
      expect(grantLine(context, child)).toBe(
        `grant: ended by parent #${parent} comment ${revoked}`,
      );
      // A parent event ends the linked grant whatever its timestamp, also one older than the child grant.
      setCreatedAt(context, parent, revoked, at(Number(parentGrant) + 0.5));
      expect(grantLine(context, child)).toBe(
        `grant: ended by parent #${parent} comment ${revoked}`,
      );
      // A new parent grant ends it too, and a child grant that copies the new event holds.
      const newGrant = post(context, parent, "Delegation grant: yolo: go again");
      expect(grantLine(context, child)).toBe(
        `grant: ended by parent #${parent} comment ${newGrant}`,
      );
      const copied = childWithGoal(context, parent, YOLO_LINE);
      const copiedGrant = post(
        context,
        copied,
        `Delegation grant: yolo: go again\nParent event: ${newGrant}`,
      );
      expect(grantLine(context, copied)).toBe(`grant: in force (yolo) by comment ${copiedGrant}`);
      // A link in another form, such as the comment URL, never matches.
      const urlLink = childWithGoal(context, parent, YOLO_LINE);
      const url = `${context.issue(parent).url}#issuecomment-${newGrant}`;
      post(context, urlLink, `Delegation grant: yolo: go again\nParent event: ${url}`);
      expect(grantLine(context, urlLink)).toBe(
        `grant: ended by parent #${parent} comment ${newGrant}`,
      );
    },
    SPAWN_TIMEOUT_MS,
  );

  it(
    "a child grant without a Parent event link ends at a parent event that is not older",
    () => {
      const context = planCliContext();
      const parent = context.createPlan("parent plan", withGoal(YOLO_LINE));
      post(context, parent, "Delegation grant: yolo: go");
      const child = childWithGoal(context, parent, YOLO_LINE);
      // A child without a grant event gives no grant and does not read the parent.
      const parentReads = context.issue(parent).graphqlReads ?? 0;
      expect(grantLine(context, child)).toBe(
        "grant: none; the Goal delegation line has no trusted authority event",
      );
      expect(context.issue(parent).graphqlReads ?? 0, "no parent read without a child grant").toBe(
        parentReads,
      );
      const childGrant = post(context, child, "Delegation grant: yolo: go on the child");
      expect(grantLine(context, child), "an older parent event").toBe(
        `grant: in force (yolo) by comment ${childGrant}`,
      );
      const revoked = post(context, parent, "Delegation revoked");
      expect(grantLine(context, child), "a newer event").toBe(
        `grant: ended by parent #${parent} comment ${revoked}`,
      );
      setCreatedAt(context, parent, revoked, at(Number(childGrant) - 0.5));
      expect(grantLine(context, child), "an older timestamp").toBe(
        `grant: in force (yolo) by comment ${childGrant}`,
      );
      // Equal timestamps cannot prove the order, so the parent event ends the grant (fail closed).
      setCreatedAt(context, parent, revoked, at(Number(childGrant)));
      expect(grantLine(context, child), "an equal timestamp").toBe(
        `grant: ended by parent #${parent} comment ${revoked}`,
      );
    },
    SPAWN_TIMEOUT_MS,
  );

  it(
    "a Parent event line on a plan without a parent gives no grant",
    () => {
      const context = planCliContext();
      const plan = context.createPlan("no parent", withGoal(YOLO_LINE));
      const grant = post(context, plan, "Delegation grant: yolo: go\nParent event: 6982300228");
      expect(grantLine(context, plan)).toBe(
        `grant: none; comment ${grant} names a parent event, but the plan has no parent`,
      );
    },
    SPAWN_TIMEOUT_MS,
  );

  it(
    "a parent in another repository, an unreadable parent, or a parent without trusted events gives no grant",
    () => {
      const context = planCliContext();
      const foreign = context.createPlan("foreign parent", withGoal(YOLO_LINE));
      context.updateIssue(foreign, (entry) => {
        entry.foreignParent = { number: 7, nameWithOwner: "DocksDocks/other" };
      });
      post(context, foreign, "Delegation grant: yolo: go");
      expect(grantLine(context, foreign)).toBe(
        "grant: none; parent #7 is in another repository (DocksDocks/other)",
      );

      const parent = context.createPlan("unreadable parent", withGoal(YOLO_LINE));
      const child = childWithGoal(context, parent, YOLO_LINE);
      post(context, child, "Delegation grant: yolo: go");
      context.updateIssue(parent, (entry) => {
        entry.readError = "HTTP 502: Bad Gateway";
      });
      expect(grantLine(context, child)).toBe(`grant: none; parent #${parent} cannot be read`);

      const shared = context.createPlan("shared parent", withGoal(YOLO_LINE));
      const parentGrant = post(context, shared, "Delegation grant: yolo: go");
      const linked = childWithGoal(context, shared, YOLO_LINE);
      post(context, linked, `Delegation grant: yolo: go\nParent event: ${parentGrant}`);
      context.updateIssue(shared, (entry) => {
        entry.assignees = ["plan-agent", "foreign-agent"];
      });
      expect(grantLine(context, linked)).toBe(
        `grant: none; parent #${shared} has no trusted authority event`,
      );
    },
    SPAWN_TIMEOUT_MS,
  );

  it(
    "show advises the removal of a child line only when a parent event ended the grant",
    () => {
      const context = planCliContext();
      const parent = context.createPlan("parent plan", withGoal(YOLO_LINE));
      const parentGrant = post(context, parent, "Delegation grant: yolo: go");
      const child = childWithGoal(context, parent, YOLO_LINE);
      post(context, child, `Delegation grant: yolo: go\nParent event: ${parentGrant}`);
      expect(
        show(context, child).lines.some((line) => line.includes("ended the grant")),
        "a grant in force",
      ).toBe(false);
      const revoked = post(context, parent, "Delegation revoked");
      expect(
        show(context, child).lines.includes(endedAdvice(parent, revoked)),
        "a live line after the end",
      ).toBe(true);
      context.updateIssue(child, (entry) => {
        entry.body = body();
      });
      const removed = show(context, child);
      expect(removed.grant).toBe(`grant: ended by parent #${parent} comment ${revoked}`);
      expect(
        removed.lines.some((line) => line.includes("ended the grant")),
        "no line to remove",
      ).toBe(false);
    },
    SPAWN_TIMEOUT_MS,
  );

  it(
    "show --body writes the grant line to stderr with the other metadata",
    () => {
      const context = planCliContext();
      const plan = context.createPlan("body grant", withGoal(YOLO_LINE));
      const grant = post(context, plan, "Delegation grant: yolo: go");
      const shown = context.run("show", String(plan), "--body");
      expectSuccess(shown, "show --body");
      expect(shown.stdout).toBe(context.issue(plan).body);
      expect(shown.stderr.split("\n").slice(1, 3)).toStrictEqual([
        "reviews: plan=none code=none",
        `grant: in force (yolo) by comment ${grant}`,
      ]);
    },
    SPAWN_TIMEOUT_MS,
  );
});
