import { describe, expect, it } from "vitest";

import { normalizePlan } from "../../../src/plan/records";
import {
  PLAN_CLI_HOST_SUPPORTED,
  body,
  expectSuccess,
  planCliContext,
} from "../../lib/plan/harness";
import { SPAWN_TIMEOUT_MS } from "../../lib/spawnTimeout";

// The display `1, a` holds a comma, so normalization keeps the Depends entry `fix_parser` as an id. Each consumer
// of Depends must resolve that id to its step.
const FIRST_ROW =
  "| 1 | fix_parser | Fix parser | src/parser.mjs | - | local | planned | Records round-trip |";
const commaRows = (secondFiles: string): string =>
  [
    "| 1, a | fix_parser | Fix parser | src/parser.mjs | - | local | planned | Records round-trip |",
    `| 2 | parse_dates | Parse dates | ${secondFiles} | fix_parser | local | planned | Dates parse |`,
  ].join("\n");

describe("plan Depends by id", () => {
  it("normalization keeps a Depends id whose step display holds a comma", () => {
    const { body: normalized } = normalizePlan(
      body().replace(FIRST_ROW, commaRows("src/dates.mjs")),
    );
    expect(normalized).toMatch(
      /\| 2 \| parse_dates \| Parse dates \| src\/dates\.mjs \| fix_parser \|/,
    );
  });

  it.skipIf(!PLAN_CLI_HOST_SUPPORTED)(
    "step resolves a Depends id when it checks for an unfinished dependency",
    () => {
      const { run, createPlan } = planCliContext();
      const number = createPlan(
        "depends by id",
        body().replace(FIRST_ROW, commaRows("src/dates.mjs")),
      );
      expectSuccess(run("status", String(number), "ongoing"), "start plan");
      const early = run("step", String(number), "parse_dates", "in-flight");
      expectSuccess(early, "start the dependent step before its dependency");
      expect(
        early.stdout.includes("advice: step parse_dates has unfinished dependency fix_parser"),
        "an unfinished dependency named by id gets advice",
      ).toBe(true);
      expectSuccess(
        run("step", String(number), "parse_dates", "planned"),
        "move the dependent step back",
      );
      expectSuccess(run("step", String(number), "fix_parser", "done"), "finish the dependency");
      const late = run("step", String(number), "parse_dates", "in-flight");
      expectSuccess(late, "start the dependent step after its dependency");
      expect(
        late.stdout.includes("unfinished dependency"),
        `a done dependency named by id is finished: ${late.stdout}`,
      ).toBe(false);
    },
    SPAWN_TIMEOUT_MS,
  );

  it("shared-path advice follows a Depends id whose step display holds a comma", () => {
    const { advice } = normalizePlan(body().replace(FIRST_ROW, commaRows("src/parser.mjs")));
    expect(
      advice.filter((message) => message.includes(" share ")),
      "the Depends id orders the two steps that share src/parser.mjs",
    ).toStrictEqual([]);
  });
});
