import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { COMMAND_WORD } from "../../lib/plan/entry";
import {
  PLAN_CLI_HOST_SUPPORTED,
  body,
  expectSuccess,
  planCliContext,
  refuse,
} from "../../lib/plan/harness";
import { SPAWN_TIMEOUT_MS } from "../../lib/spawnTimeout";

describe.skipIf(!PLAN_CLI_HOST_SUPPORTED)("plan write gates", () => {
  it(
    "a mutating command refuses a plan owned by another agent, also when the owner is on a later page",
    () => {
      const { run, issue, updateIssue, createPlan } = planCliContext();
      // Ownership is checked before a mutating command can change the record.
      const foreign = createPlan("foreign owner");
      updateIssue(foreign, (entry) => {
        entry.assignees = ["other-agent"];
      });
      refuse(run("status", String(foreign), "ongoing"), `plan #${foreign} is owned by other-agent`);
      expect(issue(foreign).labels).toStrictEqual(["plan", "plan:drafting"]);
      const pagedOwner = createPlan("owner beyond first page");
      updateIssue(pagedOwner, (entry) => {
        entry.assignees = [...Array.from({ length: 100 }, () => "plan-agent"), "other-agent"];
      });
      refuse(
        run("status", String(pagedOwner), "ongoing"),
        `plan #${pagedOwner} is owned by other-agent`,
      );
      expect(issue(pagedOwner).labels, "foreign owner on page two prevents writes").toStrictEqual([
        "plan",
        "plan:drafting",
      ]);
    },
    SPAWN_TIMEOUT_MS,
  );

  it(
    "edit refuses a body that changed remotely after the provenance check passed",
    () => {
      const { run, updateState, issue, createPlan, exported } = planCliContext();
      // A second read catches a writer that races the edit after provenance passes.
      const raced = createPlan("raced body");
      const raceFile = exported(raced);
      writeFileSync(raceFile, issue(raced).body.replace("Fix parser", "Repair parser"));
      const remoteBody = issue(raced).body.replace("Fix parser", "Remote task");
      updateState((state) => {
        state.remoteChange = { issue: raced, viewsBeforeChange: 1, body: remoteBody };
      });
      refuse(
        run("edit", String(raced), "--file", raceFile),
        "plan issue changed remotely; re-read and retry",
      );
      expect(issue(raced).body).toBe(remoteBody);
    },
    SPAWN_TIMEOUT_MS,
  );

  it(
    "partial or missing GraphQL data fails closed and writes nothing",
    () => {
      const { run, updateState, issue, createPlan } = planCliContext();
      // GraphQL may report HTTP-successful partial data; neither that nor missing data authorizes a write.
      const graphqlFailure = createPlan("graphql failure");
      updateState((state) => {
        state.graphqlError = [{ message: "partial snapshot" }];
      });
      const partial = run("status", String(graphqlFailure), "ongoing");
      expect(partial.status, "GraphQL errors fail closed even with usable data").toBe(1);
      expect(partial.stderr).toMatch(/graphql/i);
      expect(issue(graphqlFailure).labels).toStrictEqual(["plan", "plan:drafting"]);
      updateState((state) => {
        // No stage and no data: the next GraphQL response carries `data: null`.
        state.graphqlMissingData = {};
      });
      const missingData = run("status", String(graphqlFailure), "ongoing");
      expect(missingData.status, "missing GraphQL data fails closed").toBe(1);
      expect(missingData.stderr).toMatch(/graphql/i);
      expect(
        issue(graphqlFailure).body,
        "neither partial nor missing GraphQL data writes a body",
      ).toBe(body());
    },
    SPAWN_TIMEOUT_MS,
  );

  it(
    "edit refuses a file whose export provenance is missing, stale, or unreadable",
    () => {
      const { scratch, run, issue, updateIssue, createPlan, exported } = planCliContext();
      // An arbitrary file cannot bypass export provenance.
      const provenance = createPlan("provenance");
      const missingFile = join(scratch, "missing.md");
      writeFileSync(missingFile, issue(provenance).body);
      refuse(
        run("edit", String(provenance), "--file", missingFile),
        `missing export provenance: ${missingFile}.origin does not exist; run \`${COMMAND_WORD} export ${provenance}\` and re-apply the edit`,
      );
      const staleFile = exported(provenance);
      updateIssue(provenance, (entry) => {
        entry.body = entry.body.replace("Fix parser", "Remote task");
      });
      refuse(
        run("edit", String(provenance), "--file", staleFile),
        `stale export: ${staleFile} was exported from a superseded body; run \`${COMMAND_WORD} export ${provenance}\` and re-apply the edit`,
      );
      expect(issue(provenance).body).toMatch(/Remote task/);
      const unreadableFile = exported(provenance);
      writeFileSync(`${unreadableFile}.origin`, "not a digest\n");
      refuse(
        run("edit", String(provenance), "--file", unreadableFile),
        `unreadable export provenance: ${unreadableFile}.origin`,
      );
    },
    SPAWN_TIMEOUT_MS,
  );

  it(
    "a failed remote edit keeps the export valid, so a retry with the same file succeeds (#78)",
    () => {
      const { run, updateState, issue, createPlan, exported } = planCliContext();
      // A failed remote edit keeps the export valid, so the same file can be sent again (#78).
      const retried = createPlan("retried edit");
      const retryFile = exported(retried);
      writeFileSync(
        retryFile,
        readFileSync(retryFile, "utf8").replace("Not run.", "Smoke passed."),
      );
      const transientError = "GraphQL: Something went wrong while executing your query";
      updateState((state) => {
        state.issueEditError = transientError;
      });
      const failedEdit = run("edit", String(retried), "--file", retryFile);
      refuse(failedEdit, `gh api graphql failed: ${transientError}`);
      expect(failedEdit.stdout, "a failed edit prints no result").toBe("");
      updateState((state) => {
        delete state.issueEditError;
      });
      expectSuccess(
        run("edit", String(retried), "--file", retryFile),
        "retry with the same export",
      );
      expect(issue(retried).body, "the retry writes the edited body").toMatch(/Smoke passed\./);
    },
    SPAWN_TIMEOUT_MS,
  );
});
