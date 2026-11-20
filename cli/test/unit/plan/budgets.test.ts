import { describe, expect, it } from "vitest";

import {
  PLAN_CLI_HOST_SUPPORTED,
  type PlanCliContext,
  type PlanResult,
  body,
  expectSuccess,
  planCliContext,
} from "../../lib/plan/harness";
import { SPAWN_TIMEOUT_MS } from "../../lib/spawnTimeout";

// The split budgets (E4) and the scope-freeze advice of a started v5 plan (E3).
const SPLIT = /^advice: split into child plans: /m;

// A plan body of exactly `bytes` UTF-8 bytes: the Verification Results text pads it.
function bodyOfSize(bytes: number): string {
  const base = Buffer.byteLength(body().replace("Not run.", ""), "utf8");
  const text = body().replace("Not run.", "x".repeat(bytes - base));
  expect(Buffer.byteLength(text, "utf8")).toBe(bytes);
  return text;
}

// A step row with its own file, so rows need no Depends link.
function stepRow(index: number): string {
  return `| ${index} | step_${index} | Step ${index} | src/step-${index}.mjs | - | local | planned | Step ${index} works |`;
}

// A plan body with `count` step rows.
function bodyWithSteps(count: number): string {
  const rows = Array.from({ length: count }, (_, index) => stepRow(index + 1)).join("\n");
  return body().replace(/^\| 1 \| fix_parser .*$/m, rows);
}

function addComments(context: PlanCliContext, number: number, count: number): void {
  context.updateState((state) => {
    const entry = state.issues.find((candidate) => candidate.number === number);
    if (entry === undefined) throw new Error(`no issue #${number}`);
    entry.comments ??= [];
    state.nextComment ??= 1;
    for (let index = 0; index < count; index += 1) {
      const id = state.nextComment++;
      entry.comments.push({
        id,
        body: "Routine discussion.",
        author: "foreign-agent",
        createdAt: "2026-08-20T20:00:00Z",
      });
    }
  });
}

function shownAdvice(context: PlanCliContext, number: number): Array<string> {
  const shown = context.run("show", String(number));
  expectSuccess(shown, `show #${number}`);
  return shown.stdout.split("\n").filter((line) => SPLIT.test(line));
}

const SCOPE = (number: number): string =>
  `advice: check for new scope; move new work into a child plan (new --parent ${number})`;

function scopeAdvice(result: PlanResult): Array<string> {
  expectSuccess(result, "edit");
  return result.stdout.split("\n").filter((line) => line.startsWith("advice: check for new scope"));
}

describe.skipIf(!PLAN_CLI_HOST_SUPPORTED)("plan budgets", () => {
  it(
    "show advises a split for a body above 50,000 bytes and not for a body of 50,000 bytes",
    () => {
      const context = planCliContext();
      const over = context.createPlan("large body", bodyOfSize(50_001));
      expect(shownAdvice(context, over)).toStrictEqual([
        "advice: split into child plans: body is 50001 bytes (budget 50000)",
      ]);
      const atBudget = context.createPlan("body at budget", bodyOfSize(50_000));
      expect(shownAdvice(context, atBudget)).toStrictEqual([]);
      // The budget counts UTF-8 bytes: one two-byte character takes a body of 50,000 characters past it.
      const multibyte = context.createPlan(
        "multibyte body",
        bodyOfSize(50_000).replace("Fix the parser.", "Fix the pars\u00e9r."),
      );
      expect(shownAdvice(context, multibyte)).toStrictEqual([
        "advice: split into child plans: body is 50001 bytes (budget 50000)",
      ]);
    },
    SPAWN_TIMEOUT_MS,
  );

  it(
    "show advises a split for 21 steps and not for 20 steps",
    () => {
      const context = planCliContext();
      expect(shownAdvice(context, context.createPlan("21 steps", bodyWithSteps(21)))).toStrictEqual(
        ["advice: split into child plans: 21 steps (budget 20)"],
      );
      expect(shownAdvice(context, context.createPlan("20 steps", bodyWithSteps(20)))).toStrictEqual(
        [],
      );
    },
    SPAWN_TIMEOUT_MS,
  );

  it(
    "show advises a split for 61 comments and not for 60 comments",
    () => {
      const context = planCliContext();
      const over = context.createPlan("61 comments");
      addComments(context, over, 61);
      expect(shownAdvice(context, over)).toStrictEqual([
        "advice: split into child plans: 61 comments (budget 60)",
      ]);
      const atBudget = context.createPlan("60 comments");
      addComments(context, atBudget, 60);
      expect(shownAdvice(context, atBudget)).toStrictEqual([]);
    },
    SPAWN_TIMEOUT_MS,
  );

  it(
    "edit advises a split for each budget that the edited plan passes",
    () => {
      const context = planCliContext();
      const plan = context.createPlan("growing plan", bodyWithSteps(20));
      addComments(context, plan, 61);
      const base = Buffer.byteLength(context.issue(plan).body.replace("Not run.", ""), "utf8");
      const edited = context.edit(plan, (text) =>
        text
          .replace(
            "Not run.",
            "x".repeat(50_001 - base - Buffer.byteLength(`${stepRow(21)}\n`, "utf8")),
          )
          .replace(stepRow(20), `${stepRow(20)}\n${stepRow(21)}`),
      );
      expectSuccess(edited, "edit past every budget");
      expect(edited.stdout.split("\n").filter((line) => SPLIT.test(line))).toStrictEqual([
        "advice: split into child plans: body is 50001 bytes (budget 50000)",
        "advice: split into child plans: 21 steps (budget 20)",
        "advice: split into child plans: 61 comments (budget 60)",
      ]);
    },
    SPAWN_TIMEOUT_MS,
  );

  it(
    "an edit of a started v5 plan advises a child plan for new rows, new paths, and changed Task or Done when",
    () => {
      const context = planCliContext();
      const plan = context.createPlan("started v5 plan", body("in-flight"));
      context.updateIssue(plan, (entry) => {
        entry.labels = ["plan", "plan:ongoing"];
      });
      const row =
        "| 1 | fix_parser | Fix parser | src/parser.mjs | - | local | in-flight | Records round-trip |";
      for (const [name, change] of [
        [
          "an added row",
          (text: string): string =>
            text.replace(
              row,
              `${row}\n| 2 | add_docs | Add docs | docs/a.md | - | local | planned | Docs exist |`,
            ),
        ],
        [
          "an added Files path",
          (text: string): string =>
            text.replace("| src/parser.mjs |", "| src/parser.mjs, src/lexer.mjs |"),
        ],
        [
          "a changed Task",
          (text: string): string => text.replace("| Fix parser |", "| Rewrite parser |"),
        ],
        [
          "a changed Done when",
          (text: string): string =>
            text.replace("| Records round-trip |", "| Records and dates round-trip |"),
        ],
      ] as const) {
        expect(scopeAdvice(context.edit(plan, change)), name).toStrictEqual([SCOPE(plan)]);
      }
      for (const [name, change] of [
        ["an evidence edit", (text: string): string => text.replace("Not run.", "Smoke passed.")],
        [
          "a removed Files path",
          (text: string): string => text.replace("src/parser.mjs, src/lexer.mjs", "src/parser.mjs"),
        ],
        ["a no-op edit", (text: string): string => text],
      ] as const) {
        expect(scopeAdvice(context.edit(plan, change)), name).toStrictEqual([]);
      }
    },
    SPAWN_TIMEOUT_MS,
  );

  it(
    "an added row gets no scope advice before work starts or on a started v4 plan",
    () => {
      const context = planCliContext();
      const addRow = (text: string): string =>
        text.replace(
          /^(\| 1 \| fix_parser .*)$/m,
          "$1\n| 2 | add_docs | Add docs | docs/a.md | - | local | planned | Docs exist |",
        );
      const unstarted = context.createPlan("unstarted v5 plan");
      expect(scopeAdvice(context.edit(unstarted, addRow))).toStrictEqual([]);
      const legacy = context.createPlan("started v4 plan", body("in-flight", 4));
      context.updateIssue(legacy, (entry) => {
        entry.labels = ["plan", "plan:ongoing"];
      });
      expect(scopeAdvice(context.edit(legacy, addRow))).toStrictEqual([]);
    },
    SPAWN_TIMEOUT_MS,
  );
});
