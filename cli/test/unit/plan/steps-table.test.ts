import { describe, expect, it } from "vitest";

import {
  PLAN_CLI_HOST_SUPPORTED,
  body,
  expectSuccess,
  planCliContext,
  refuse,
} from "../../lib/plan/harness";
import { SPAWN_TIMEOUT_MS } from "../../lib/spawnTimeout";

const MALFORMED_REFUSAL =
  "Steps row 2 has 9 cells; expected 8. Escape a literal pipe as \\| so the row is preserved.";
const MALFORMED_ROW = "| 2 | broken | Unescaped a | b | src | - | local | planned | Lost |";

describe.skipIf(!PLAN_CLI_HOST_SUPPORTED)("plan Steps table", () => {
  it(
    "edit and step preserve sibling rows whose cells hold escaped pipes or backslash runs",
    () => {
      const { run, issue, createPlan, edit } = planCliContext();
      // A step update preserves every sibling row, including one whose cell holds an escaped pipe.
      const piped = createPlan("escaped pipe sibling");
      const pipedRow =
        "| 2 | grep_pipe | Grep `a \\| b` | src/grep.mjs | - | local | planned | Pipe survives |";
      expectSuccess(
        edit(piped, (text) =>
          text.replace("| Records round-trip |\n", `| Records round-trip |\n${pipedRow}\n`),
        ),
        "add piped row",
      );
      expect(issue(piped).body.includes(pipedRow), "edit preserves the escaped pipe cell").toBe(
        true,
      );
      expectSuccess(run("status", String(piped), "ongoing"), "start piped plan");
      expectSuccess(
        run("step", String(piped), "fix_parser", "in-flight"),
        "update sibling of piped row",
      );
      expect(issue(piped).body.includes(pipedRow), "step preserves the escaped pipe row").toBe(
        true,
      );
      expect(issue(piped).body).toMatch(/\| fix_parser \| .* \| in-flight \|/);
      const backslashRow =
        "| 3 | back_slash | Path `C:\\\\` | src\\\\win.mjs | - | local | planned | Ends with a literal backslash |";
      expectSuccess(
        edit(piped, (text) => text.replace(`${pipedRow}\n`, `${pipedRow}\n${backslashRow}\n`)),
        "add a row whose cell ends in an even backslash run",
      );
      expect(
        issue(piped).body.includes(backslashRow),
        "an even backslash run before a pipe is a delimiter",
      ).toBe(true);
      const oddCell = String.raw`Keep a \\\| b`;
      expect(oddCell, "the raw fixture holds exactly three backslashes before the pipe").toBe(
        "Keep a \\\\\\| b",
      );
      const oddRow = `| 4 | odd_run | ${oddCell} | src/odd.mjs | - | local | planned | Three backslashes escape the pipe |`;
      expectSuccess(
        edit(piped, (text) => text.replace(`${backslashRow}\n`, `${backslashRow}\n${oddRow}\n`)),
        "add a row with an odd backslash run before a pipe",
      );
      expect(
        issue(piped).body.includes(`| ${oddCell} |`),
        "an odd backslash run before a pipe keeps the pipe in the cell",
      ).toBe(true);
      expectSuccess(
        run("step", String(piped), "fix_parser", "done"),
        "step rewrite beside the odd-run row",
      );
      expect(
        issue(piped).body.includes(oddRow),
        "the odd-run row survives a step rewrite as one cell",
      ).toBe(true);
    },
    SPAWN_TIMEOUT_MS,
  );

  it(
    "a Steps row that does not parse to eight cells blocks edit and step instead of vanishing",
    () => {
      const { run, issue, updateIssue, createPlan, edit } = planCliContext();
      // A row that does not parse to eight cells blocks every write instead of vanishing.
      const malformed = createPlan("malformed row");
      refuse(
        edit(malformed, (text) =>
          text.replace("| Records round-trip |\n", `| Records round-trip |\n${MALFORMED_ROW}\n`),
        ),
        MALFORMED_REFUSAL,
      );
      updateIssue(malformed, (entry) => {
        entry.body = entry.body.replace(
          "| Records round-trip |\n",
          `| Records round-trip |\n${MALFORMED_ROW}\n`,
        );
      });
      expectSuccess(run("status", String(malformed), "ongoing"), "start malformed plan");
      refuse(run("step", String(malformed), "fix_parser", "in-flight"), MALFORMED_REFUSAL);
      expect(issue(malformed).body, "the malformed row is untouched").toMatch(/\| broken \|/);
    },
    SPAWN_TIMEOUT_MS,
  );

  it(
    "edit restores missing table separators without taking the first data row as one",
    () => {
      const { issue, createPlan, edit } = planCliContext();
      // A missing separator line is inserted; the first data row is never mistaken for it.
      const unseparated = createPlan("missing separator");
      expectSuccess(
        edit(unseparated, (text) =>
          text.replace("|---:|---|---|---|---|---|---|---|\n", "").replace("|---|---|---|\n", ""),
        ),
        "edit without separators",
      );
      const unseparatedBody = issue(unseparated).body;
      expect(
        unseparatedBody.includes("| 1 | fix_parser | Fix parser |"),
        "first step row survives",
      ).toBe(true);
      expect(
        unseparatedBody.includes("| A1 | node smoke.mjs | Exit 0 |"),
        "first acceptance row survives",
      ).toBe(true);
      expect(unseparatedBody, "separators are restored").toBe(body());
    },
    SPAWN_TIMEOUT_MS,
  );
});
