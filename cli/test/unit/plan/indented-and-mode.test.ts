import { describe, expect, it } from "vitest";

import {
  PLAN_CLI_HOST_SUPPORTED,
  expectSuccess,
  planCliContext,
  refuse,
} from "../../lib/plan/harness";
import { SPAWN_TIMEOUT_MS } from "../../lib/spawnTimeout";

const INDENTED_MODE = "    Mode: plan-and-implement\n";

function createdNumber(stdout: string): number {
  const match = /^plan created: #(\d+)/m.exec(stdout);
  expect(match, "new prints the issue identity").not.toBeNull();
  return Number(match?.[1]);
}

describe.skipIf(!PLAN_CLI_HOST_SUPPORTED)("plan indented examples and Mode", () => {
  it(
    "an indented Mode example never becomes the live Mode, wherever it sits in Goal",
    () => {
      const { issue, createPlan, edit } = planCliContext();
      // An indented code example never becomes the live Mode.
      const indentedMode = createPlan("indented mode example");
      expectSuccess(
        edit(indentedMode, (text) =>
          text
            .replace("Mode: plan-and-implement\n", "Mode: plan-only\n")
            .replace("Fix the parser.\n\n", `Fix the parser.\n\n${INDENTED_MODE}\n`),
        ),
        "edit with indented mode example",
      );
      expect(
        issue(indentedMode).body.includes(INDENTED_MODE),
        "indented example is preserved",
      ).toBe(true);
      expect(issue(indentedMode).body, "the plan-only decision is the live mode").toMatch(
        /\nMode: plan-only\n/,
      );

      for (const [label, transform] of [
        [
          "leading",
          (text: string): string =>
            text.replace(
              "## Goal\n\nFix the parser.\n\n",
              `## Goal\n\n${INDENTED_MODE}\nFix the parser.\n\n`,
            ),
        ],
        [
          "trailing",
          (text: string): string =>
            text.replace("Mode: plan-only\n\n", `Mode: plan-only\n\n${INDENTED_MODE}\n`),
        ],
      ] as const) {
        const placed = createPlan(`${label} indented mode example`);
        expectSuccess(
          edit(placed, (text) =>
            transform(text.replace("Mode: plan-and-implement\n", "Mode: plan-only\n")),
          ),
          `edit with ${label} indented example`,
        );
        expectSuccess(edit(placed), `${label} second normalization`);
        expect(
          issue(placed).body.includes(INDENTED_MODE),
          `${label} indented example is preserved`,
        ).toBe(true);
        expect(issue(placed).body, `${label}: the plan-only decision stays live`).toMatch(
          /\nMode: plan-only\n/,
        );
        expect(
          issue(placed).body.match(/^Mode:/gm)?.length,
          `${label}: exactly one live Mode line`,
        ).toBe(1);
      }
    },
    SPAWN_TIMEOUT_MS,
  );

  it(
    "an indented example table before the live table is neither selected nor rewritten",
    () => {
      const { run, issue, createPlan, edit } = planCliContext();
      const indentedTable = createPlan("indented example table");
      const indentedExample = [
        "    | # | Id | Task | Files | Depends | Effect | Status | Done when |",
        "    |---:|---|---|---|---|---|---|---|",
        "    | 1 | example | Example | x | - | local | done | Never |",
      ].join("\n");
      expectSuccess(
        edit(indentedTable, (text) =>
          text.replace("## Steps\n\n", `## Steps\n\n${indentedExample}\n\n`),
        ),
        "edit with indented example table",
      );
      expect(
        issue(indentedTable).body.includes(indentedExample),
        "indented example bytes are preserved",
      ).toBe(true);
      expectSuccess(run("status", String(indentedTable), "ongoing"), "start indented-table plan");
      expectSuccess(
        run("step", String(indentedTable), "fix_parser", "in-flight"),
        "step targets the live table",
      );
      expect(issue(indentedTable).body).toMatch(/\| fix_parser \| .* \| in-flight \|/);
      expect(
        issue(indentedTable).body.includes(indentedExample),
        "indented example still untouched",
      ).toBe(true);
    },
    SPAWN_TIMEOUT_MS,
  );

  it(
    "an explicit --mode outranks a Mode line in --goal, and a goal Mode line stays live without --mode",
    () => {
      const { run, issue, edit } = planCliContext();
      // An explicit --mode outranks a Mode line embedded in --goal; a later live Mode line wins.
      const explicit = run(
        "new",
        "--title",
        "explicit mode",
        "--goal",
        "Ship it.\nMode: plan-and-implement\n\n## Context\nDetails.\n\n```text\n## fenced heading\n```",
        "--mode",
        "plan-only",
      );
      expectSuccess(explicit, "new with explicit mode");
      expect(explicit.stdout, "advice honors the explicit --mode").not.toMatch(/Mode defaulted/);
      const explicitNumber = createdNumber(explicit.stdout);
      expect(issue(explicitNumber).body, "explicit --mode is the live mode").toMatch(
        /\nMode: plan-only\n/,
      );
      expect(
        issue(explicitNumber).body.match(/^Mode:/gm)?.length,
        "the embedded Mode line is removed",
      ).toBe(1);
      expect(
        issue(explicitNumber).body.includes(
          "### Context\nDetails.\n\n```text\n## fenced heading\n```\n\nMode: plan-only",
        ),
        "an unfenced H2 in --goal is demoted to H3, a fenced one is kept, and both stay inside Goal",
      ).toBe(true);
      refuse(
        edit(explicitNumber, (text) =>
          text.replace("## Acceptance", "## Context\n\nDetails.\n\n## Acceptance"),
        ),
        "unknown section heading: Context; use only Goal, Research, Steps, Acceptance, Do not touch, Open questions, Verification Results or write it below an existing section as ### or plain text",
      );
      const embedded = run(
        "new",
        "--title",
        "embedded mode",
        "--goal",
        "Ship it.\nMode: plan-and-implement",
      );
      expectSuccess(embedded, "new with embedded mode only");
      expect(
        issue(createdNumber(embedded.stdout)).body,
        "goal-authored Mode is kept without --mode",
      ).toMatch(/\nMode: plan-and-implement\n/);
    },
    SPAWN_TIMEOUT_MS,
  );
});
