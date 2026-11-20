import { describe, expect, it } from "vitest";

import {
  PLAN_CLI_HOST_SUPPORTED,
  body,
  expectSuccess,
  planCliContext,
  refuse,
} from "../../lib/plan/harness";
import { SPAWN_TIMEOUT_MS } from "../../lib/spawnTimeout";

const EXAMPLE_ROW = "| 1 | example | Example | x | - | local | done | Never |";

describe.skipIf(!PLAN_CLI_HOST_SUPPORTED)("plan fenced examples", () => {
  it(
    "a fenced example table or Mode line is never live, and a duplicate section heading blocks the write",
    () => {
      const { run, issue, createPlan, edit } = planCliContext();
      // A fenced example table is not the live table, and a duplicate section heading blocks the write.
      const fenced = createPlan("fenced example");
      const example = [
        "```markdown",
        "| # | Id | Task | Files | Depends | Effect | Status | Done when |",
        "|---:|---|---|---|---|---|---|---|",
        EXAMPLE_ROW,
        "```",
        "",
      ].join("\n");
      expectSuccess(
        edit(fenced, (text) => text.replace("## Steps\n\n", `## Steps\n\n${example}`)),
        "edit with fenced example",
      );
      expect(issue(fenced).body.includes(EXAMPLE_ROW), "example untouched").toBe(true);
      expectSuccess(run("status", String(fenced), "ongoing"), "start fenced plan");
      expectSuccess(
        run("step", String(fenced), "fix_parser", "in-flight"),
        "step targets the live table",
      );
      expect(issue(fenced).body).toMatch(/\| fix_parser \| .* \| in-flight \|/);
      expect(issue(fenced).body.includes(EXAMPLE_ROW), "example still untouched").toBe(true);
      const doubled = createPlan("duplicate heading");
      refuse(
        edit(doubled, (text) =>
          text.replace("## Acceptance", "## steps\n\nNothing.\n\n## Acceptance"),
        ),
        "duplicate section heading: Steps",
      );
      expect(issue(doubled).body, "a duplicate heading writes nothing").toBe(body());
      const fencedMode = createPlan("fenced mode example");
      const modeExample = "```markdown\nMode: plan-and-implement\n```\n\n";
      expectSuccess(
        edit(fencedMode, (text) =>
          text
            .replace("Mode: plan-and-implement\n", "Mode: plan-only\n")
            .replace("Fix the parser.\n\n", `Fix the parser.\n\n${modeExample}`),
        ),
        "edit with fenced mode example",
      );
      const fencedModeBody = issue(fencedMode).body;
      expect(
        fencedModeBody.includes(modeExample.trimEnd()),
        "fenced Mode example is preserved",
      ).toBe(true);
      expect(fencedModeBody, "the unfenced Mode decision is the live mode").toMatch(
        /\nMode: plan-only\n/,
      );
      expect(fencedModeBody.match(/^Mode:/gm)?.length, "one example, one live Mode line").toBe(2);
    },
    SPAWN_TIMEOUT_MS,
  );

  it(
    "a fenced block that ends a section survives normalization with either fence style",
    () => {
      const { issue, createPlan, edit } = planCliContext();
      for (const fence of ["```", "~~~"]) {
        const trailing = createPlan(`trailing fence ${fence}`);
        const evidence = `${fence}text\nnode smoke.mjs | tail -1\n${fence}`;
        expectSuccess(
          edit(trailing, (text) =>
            text.replace(
              "The parser loses mixed-case records.\n",
              `The parser loses mixed-case records.\n\n${evidence}\n`,
            ),
          ),
          `edit with trailing ${fence} fence`,
        );
        expect(
          issue(trailing).body.includes(evidence),
          `trailing ${fence} block is preserved`,
        ).toBe(true);
      }
    },
    SPAWN_TIMEOUT_MS,
  );
});
