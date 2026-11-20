import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { delimiter, join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  GH_STUB_DIR,
  PLAN_CLI_HOST_SUPPORTED,
  body,
  docksKitShimEnv,
  expectSuccess,
  planCliContext,
  refuse,
} from "../../lib/plan/harness";
import { SPAWN_TIMEOUT_MS } from "../../lib/spawnTimeout";

const NON_UTF8_SKIP = "the file system rejects a file name that is not UTF-8";
const NON_UTF8_REFUSAL = "the docks-review folder path is not UTF-8 text\n";

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
        `missing export provenance: ${missingFile}.origin does not exist; run \`docks-kit plan export ${provenance}\` and re-apply the edit`,
      );
      const staleFile = exported(provenance);
      updateIssue(provenance, (entry) => {
        entry.body = entry.body.replace("Fix parser", "Remote task");
      });
      refuse(
        run("edit", String(provenance), "--file", staleFile),
        `stale export: ${staleFile} was exported from a superseded body; run \`docks-kit plan export ${provenance}\` and re-apply the edit`,
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

  // git prints a path as bytes, and Node decodes a working folder with U+FFFD in place of a byte that is not UTF-8.
  // A path with U+FFFD names another folder, which export would create and write.
  it(
    "export writes nothing when the docks-review folder path is not UTF-8 text",
    (context) => {
      const { scratch, run, createPlan } = planCliContext();
      const plan = createPlan("a path that is not UTF-8");
      const gitHome = Buffer.concat([Buffer.from(`${scratch}/`), Buffer.from("g-\xff", "latin1")]);
      try {
        mkdirSync(gitHome);
      } catch {
        context.skip(NON_UTF8_SKIP);
      }
      // The gitfile .git names the moved git folder, so git prints the absolute docks-review path with the byte.
      const gitDir = Buffer.concat([gitHome, Buffer.from("/repo.git")]);
      renameSync(join(scratch, ".git"), gitDir);
      writeFileSync(
        join(scratch, ".git"),
        Buffer.concat([Buffer.from("gitdir: "), gitDir, Buffer.from("\n")]),
      );
      const absolute = run("export", String(plan));
      expect(absolute.status, absolute.stderr).toBe(1);
      expect(absolute.stdout).toBe("");
      expect(absolute.stderr).toBe(NON_UTF8_REFUSAL);
      expect(existsSync(join(scratch, "g-\uFFFD")), "no folder of the decoded git path").toBe(
        false,
      );

      // In a checkout folder with the byte, git prints the relative path `.git/docks-review`, which resolves from
      // the working folder.
      const shim = docksKitShimEnv(scratch);
      const relative = spawnSync(
        "bash",
        [
          "-c",
          `dir=$(printf 'w-\\377') && mkdir "$dir" && cd "$dir" && git init -q && docks-kit plan export ${plan}`,
        ],
        {
          cwd: scratch,
          env: {
            ...process.env,
            PATH: `${GH_STUB_DIR}${delimiter}${shim["PATH"] ?? ""}`,
            GH_STUB_STATE: join(scratch, "gh-state.json"),
            XDG_STATE_HOME: join(scratch, "state"),
          },
          encoding: "utf8",
        },
      );
      expect(relative.status, relative.stderr).toBe(1);
      expect(relative.stdout).toBe("");
      expect(relative.stderr).toBe(NON_UTF8_REFUSAL);
      expect(existsSync(join(scratch, "w-\uFFFD")), "no folder of the decoded working folder").toBe(
        false,
      );
    },
    SPAWN_TIMEOUT_MS,
  );
});
