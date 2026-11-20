import { type SpawnSyncReturns, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { delimiter, join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  GH_STUB_DIR,
  PATHS_ARE_BYTES,
  PLAN_CLI_HOST_SUPPORTED,
  UNICODE_PATHS_SKIP,
  body,
  docksKitShimEnv,
  expectSuccess,
  planCliContext,
  refuse,
} from "../../lib/plan/harness";
import { SPAWN_TIMEOUT_MS } from "../../lib/spawnTimeout";

const NON_UTF8_SKIP = "the file system rejects a file name that is not UTF-8";

// `<dir>/<name>`, where each character of `name` is one byte, so that `\xff` is the byte 0xff, which is no UTF-8.
function rawPath(dir: string, name: string): Buffer {
  return Buffer.concat([Buffer.from(`${dir}/`, "utf8"), Buffer.from(name, "latin1")]);
}

// Runs a bash script in `scratch` with `docks-kit` and the gh stub of the case on PATH, and keeps the raw bytes of
// its output. A script can name a path that is not UTF-8, which an argv or a working folder of Node cannot.
function planScript(scratch: string, script: string): SpawnSyncReturns<Buffer> {
  const shim = docksKitShimEnv(scratch);
  return spawnSync("bash", ["-c", script], {
    cwd: scratch,
    env: {
      ...process.env,
      PATH: `${GH_STUB_DIR}${delimiter}${shim["PATH"] ?? ""}`,
      GH_STUB_STATE: join(scratch, "gh-state.json"),
      XDG_STATE_HOME: join(scratch, "state"),
    },
  });
}

// Exports the plan, prints the path that export printed, and edits the plan from that path.
function exportAndEdit(plan: number): string {
  return `f=$(docks-kit plan export ${plan}) && printf '%s\\n' "$f" && docks-kit plan edit ${plan} --file "$f" >/dev/null`;
}

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

  // git prints the docks-review path as bytes, and the working folder is read as bytes, so export writes the folder
  // of those bytes and prints them; the printed path then reaches edit as an argument with the same bytes. A path
  // with U+FFFD in place of the byte would name another folder.
  it(
    "export writes and prints a docks-review folder whose path is not UTF-8, and edit reads that path",
    (context) => {
      const { scratch, createPlan } = planCliContext();
      const plan = createPlan("a path that is not UTF-8");
      const gitHome = rawPath(scratch, "g-\xff");
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
      const absolute = planScript(scratch, exportAndEdit(plan));
      expect(absolute.status, absolute.stderr.toString("utf8")).toBe(0);
      expect(absolute.stdout).toStrictEqual(
        rawPath(scratch, `g-\xff/repo.git/docks-review/plan-${plan}.md\n`),
      );
      expect(existsSync(join(scratch, "g-\uFFFD")), "no folder of a decoded git path").toBe(false);

      // In a checkout folder with the byte, git prints the relative path `.git/docks-review`, which resolves from
      // the working folder.
      const relative = planScript(
        scratch,
        `dir=$(printf 'w-\\377') && mkdir "$dir" && cd "$dir" && git init -q && ${exportAndEdit(plan)}`,
      );
      expect(relative.status, relative.stderr.toString("utf8")).toBe(0);
      expect(relative.stdout).toStrictEqual(
        rawPath(scratch, `w-\xff/.git/docks-review/plan-${plan}.md\n`),
      );
      expect(existsSync(join(scratch, "w-\uFFFD")), "no folder of a decoded working folder").toBe(
        false,
      );
    },
    SPAWN_TIMEOUT_MS,
  );

  it(
    "export and edit in a working folder with a literal U+FFFD behave as in any other folder",
    () => {
      const { scratch, createPlan } = planCliContext();
      const plan = createPlan("a literal U+FFFD");
      const result = planScript(
        scratch,
        `mkdir 'w-\uFFFD' && cd 'w-\uFFFD' && git init -q && ${exportAndEdit(plan)}`,
      );
      expect(result.status, result.stderr.toString("utf8")).toBe(0);
      expect(result.stdout.toString("utf8")).toBe(
        `${scratch}/w-\uFFFD/.git/docks-review/plan-${plan}.md\n`,
      );
    },
    SPAWN_TIMEOUT_MS,
  );

  // PLAN_CLI_PROC_ROOT (a test hook) names an empty folder, as on a Linux without a mounted /proc.
  it(
    "without /proc, export in a U+FFFD working folder and edit of a U+FFFD path refuse, and ASCII paths work",
    (context) => {
      context.skip(!PATHS_ARE_BYTES, UNICODE_PATHS_SKIP);
      const { scratch, createPlan } = planCliContext();
      const plan = createPlan("no /proc");
      const noProc = join(scratch, "no-proc");
      mkdirSync(noProc);
      const withoutProc = `PLAN_CLI_PROC_ROOT='${noProc}' docks-kit plan`;
      const lost = planScript(
        scratch,
        `mkdir 'w-\uFFFD' && cd 'w-\uFFFD' && git init -q && ${withoutProc} export ${plan}`,
      );
      expect(lost.status, lost.stderr.toString("utf8")).toBe(1);
      expect(lost.stdout.toString("utf8")).toBe("");
      expect(lost.stderr.toString("utf8")).toBe(
        "the bytes of the working folder cannot be recovered without /proc\n",
      );
      expect(existsSync(join(scratch, "w-\uFFFD", ".git", "docks-review")), "no folder").toBe(
        false,
      );
      const edit = planScript(scratch, `${withoutProc} edit ${plan} --file 'x-\uFFFD.md'`);
      expect(edit.status, edit.stderr.toString("utf8")).toBe(1);
      expect(edit.stderr.toString("utf8")).toBe(
        "the bytes of an argument cannot be recovered without /proc\n",
      );
      const ascii = planScript(
        scratch,
        `f=$(${withoutProc} export ${plan}) && printf '%s\\n' "$f" && ${withoutProc} edit ${plan} --file "$f" >/dev/null`,
      );
      expect(ascii.status, ascii.stderr.toString("utf8")).toBe(0);
      expect(ascii.stdout.toString("utf8")).toBe(`${scratch}/.git/docks-review/plan-${plan}.md\n`);
    },
    SPAWN_TIMEOUT_MS,
  );
});
