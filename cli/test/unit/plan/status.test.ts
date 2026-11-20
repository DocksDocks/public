import { describe, expect, it } from "vitest";

import {
  PLAN_CLI_HOST_SUPPORTED,
  body,
  expectSuccess,
  planCliContext,
  refuse,
} from "../../lib/plan/harness";
import { SPAWN_TIMEOUT_MS } from "../../lib/spawnTimeout";

describe.skipIf(!PLAN_CLI_HOST_SUPPORTED)("plan status", () => {
  it(
    "history freezes step state once work starts, and status refuses transitions that erase started work",
    () => {
      const { run, issue, updateIssue, createPlan, edit } = planCliContext();
      // The event history keeps step state frozen even if phase labels are reset.
      const frozen = createPlan("frozen steps");
      updateIssue(frozen, (entry) => {
        entry.events = [{ event: "labeled", label: { name: "plan:ongoing" } }];
      });
      for (const [name, before, after] of [
        ["Status", "| planned |", "| done |"],
        ["Id", "| fix_parser |", "| renamed |"],
        ["Depends", "| - |", "| 2 |"],
      ] as const) {
        const result = edit(frozen, (text) => text.replace(before, after));
        expect(result.status, `${name} must stay frozen`).toBe(1);
        expect(result.stderr).toMatch(/^step state is frozen once work starts: .+\n$/);
        expect(issue(frozen).body, `${name} refusal must preserve the remote body`).toBe(body());
      }
      expectSuccess(
        edit(frozen, (text) => text.replace("Fix parser", "Repair parser")),
        "task text edit",
      );
      expect(issue(frozen).body).toMatch(/Repair parser/);
      const pagedHistory = createPlan("ongoing history beyond first page");
      updateIssue(pagedHistory, (entry) => {
        entry.events = [
          ...Array.from({ length: 100 }, () => ({
            event: "labeled",
            label: { name: "unrelated" },
          })),
          { event: "labeled", label: { name: "plan:ongoing" } },
        ];
      });
      refuse(
        edit(pagedHistory, (text) => text.replace("| planned |", "| done |")),
        "step state is frozen once work starts: step fix_parser status changed",
      );
      expect(issue(pagedHistory).body, "a late history event freezes the original step state").toBe(
        body(),
      );

      // Labels cannot erase started work, but drafting can enter implementation.
      const transitions = createPlan("status transitions");
      expectSuccess(run("status", String(transitions), "ongoing"), "drafting to ongoing");
      expect(issue(transitions).labels.includes("plan:ongoing")).toBe(true);
      refuse(
        run("status", String(transitions), "planned"),
        "illegal plan status transition: ongoing -> planned",
      );
      refuse(
        run("status", String(frozen), "planned"),
        "illegal plan status transition: drafting -> planned",
      );
    },
    SPAWN_TIMEOUT_MS,
  );

  it(
    "phase labels compare case-insensitively and a transition removes the stored spelling",
    () => {
      const { run, issue, updateIssue, createPlan, edit } = planCliContext();
      // Phase labels compare case-insensitively and are removed by their stored spelling.
      const mixedLabels = createPlan("mixed-case labels");
      updateIssue(mixedLabels, (entry) => {
        entry.labels = ["plan", "Plan:Drafting"];
      });
      expect(run("show", String(mixedLabels)).stdout, "mixed-case phase label is read").toMatch(
        /· drafting ·/,
      );
      expectSuccess(
        run("status", String(mixedLabels), "planned"),
        "transition from a mixed-case label",
      );
      expect(issue(mixedLabels).labels, "the mixed-case label is removed").toStrictEqual([
        "plan",
        "plan:planned",
      ]);
      updateIssue(mixedLabels, (entry) => {
        entry.events = [{ event: "labeled", label: { name: "Plan:Ongoing" } }];
      });
      refuse(
        edit(mixedLabels, (text) => text.replace("| planned |", "| done |")),
        "step state is frozen once work starts: step fix_parser status changed",
      );
      refuse(
        run("status", String(mixedLabels), "drafting"),
        "illegal plan status transition: planned -> drafting",
      );
      expect(issue(mixedLabels).labels, "history keeps the plan out of drafting").toStrictEqual([
        "plan",
        "plan:planned",
      ]);
    },
    SPAWN_TIMEOUT_MS,
  );

  it(
    "a phase label beyond the first label page is read and replaced, and other labels stay",
    () => {
      const { run, issue, updateIssue, createPlan } = planCliContext();
      const pagedLabels = createPlan("phase label beyond first page");
      const unrelatedLabels = Array.from({ length: 100 }, (_, index) => `topic:${index}`);
      updateIssue(pagedLabels, (entry) => {
        entry.labels = ["plan", ...unrelatedLabels, "Plan:Drafting"];
      });
      const pagedLabelShow = run("show", String(pagedLabels));
      expectSuccess(pagedLabelShow, "show label on second page");
      expect(pagedLabelShow.stdout).toMatch(/· drafting ·/);
      expectSuccess(
        run("status", String(pagedLabels), "planned"),
        "transition label on second page",
      );
      expect(
        issue(pagedLabels).labels,
        "phase repair preserves other labels and removes the stored spelling",
      ).toStrictEqual(["plan", ...unrelatedLabels, "plan:planned"]);
    },
    SPAWN_TIMEOUT_MS,
  );

  it(
    "status creates a phase label that the repository lacks and applies it",
    () => {
      const { run, loadState, updateState, issue, createPlan } = planCliContext();
      // The target phase label can be missing, for example after someone deleted it from the repository.
      const unlabelled = createPlan("missing phase label");
      updateState((state) => {
        delete state.labels["plan:planned"];
      });
      expectSuccess(
        run("status", String(unlabelled), "planned"),
        "status with a missing phase label",
      );
      expect(
        Object.hasOwn(loadState().labels, "plan:planned"),
        "the status write creates the missing label",
      ).toBe(true);
      expect(issue(unlabelled).labels).toStrictEqual(["plan", "plan:planned"]);
    },
    SPAWN_TIMEOUT_MS,
  );

  it(
    "step refuses to reopen a terminal row",
    () => {
      const { run, issue, createPlan } = planCliContext();
      // A terminal row cannot be reopened by the step command.
      const terminal = createPlan("terminal step", body("done"));
      expectSuccess(run("status", String(terminal), "ongoing"), "start terminal plan");
      refuse(
        run("step", String(terminal), "fix_parser", "in-flight"),
        "illegal step status transition: done -> in-flight",
      );
      expect(issue(terminal).body).toMatch(/\| `?done`? \|/);
    },
    SPAWN_TIMEOUT_MS,
  );
});
