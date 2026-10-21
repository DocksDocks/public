import { resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  defaultTidyHost,
  type DockerAccess,
  type ProcessRow,
  type TidyHost,
  type TidyInputs,
} from "../../src/engine-native/tidy";
import { buildTidyReport, type TidyReportSection } from "../../src/engine-native/tidyReport";
import { createGitSandbox, type GitSandbox } from "../lib/gitSandbox";

const HOUR_MS = 3_600_000;
const WINDOWS = process.platform === "win32";
const NO_DOCKER: DockerAccess = { kind: "missing", reason: "command not found" };
const LOCAL_ENDPOINT = "unix:///run/stub/docker.sock";

let sandbox: GitSandbox;
let inputs: TidyInputs;
const dockerCalls: Array<ReadonlyArray<string>> = [];

function row(fields: Partial<ProcessRow> & Pick<ProcessRow, "pid">): ProcessRow {
  return {
    ppid: 1,
    ageMs: 13 * HOUR_MS,
    rssKb: 2048,
    comm: "node",
    args: "node server.js",
    cwd: resolve("/w/app"),
    ...fields,
  };
}

/** Rows whose PIDs nothing signals: the report only reads them. */
const ROWS: ReadonlyArray<ProcessRow> = [
  row({ pid: 101, args: "node /w/app/node_modules/.bin/vite --port 5173" }),
  row({
    pid: 102,
    comm: "bun",
    args: "bun /home/u/.omp/plugins/node_modules/pi-intercom/broker/broker.ts",
    cwd: "/home/u/.omp/plugins/node_modules/pi-intercom",
  }),
  row({
    pid: 103,
    ppid: 4242,
    comm: "python3",
    args: "python3 -m http.server",
    cwd: "/tmp/tidy-report-test",
  }),
  row({ pid: 104, ageMs: 2 * HOUR_MS, args: "node /w/app/node_modules/.bin/vite" }),
  row({ pid: 105, args: "/opt/google/chrome/chrome_crashpad_handler --monitor-self" }),
  row({
    pid: 106,
    ppid: 4242,
    comm: "omp daemon brok",
    args: "/home/u/.local/share/tern/omp/versions/18.12.4 __omp_worker_daemon_broker",
    cwd: "/tmp",
  }),
];

function stubHost(processes: ReadonlyArray<ProcessRow> | undefined): TidyHost {
  const real = defaultTidyHost();
  const missing = { code: null, stdout: "", stderr: "", missing: true };
  return {
    git: real.git,
    docker: async (args) => {
      dockerCalls.push(args);
      return { code: 0, stdout: "Build Cache\t8.9GB\t5.2GB\n", stderr: "", missing: false };
    },
    dockerEndpoint: async () => missing,
    run: async () => missing,
    processes: async () => processes,
    now: () => Date.now(),
  };
}

function sectionLines(
  sections: ReadonlyArray<TidyReportSection>,
  title: string,
): ReadonlyArray<string> {
  return sections.find((section) => section.title === title)?.lines ?? [];
}

beforeAll(() => {
  sandbox = createGitSandbox();
  inputs = {
    home: sandbox.home,
    worktreeRoot: sandbox.worktreeRoot,
    scratchRoot: sandbox.scratchRoot,
  };
});

afterAll(() => {
  sandbox.dispose();
});

describe("buildTidyReport", () => {
  it.runIf(WINDOWS)("reports that Windows is not supported", async () => {
    expect(await buildTidyReport(inputs, stubHost(ROWS), NO_DOCKER)).toEqual([
      { title: "Report", lines: ["docks-kit tidy --report supports Linux and macOS"] },
    ]);
  });

  it.skipIf(WINDOWS)(
    "lists old orphaned tools and old processes in temporary directories",
    async () => {
      const sections = await buildTidyReport(inputs, stubHost(ROWS), NO_DOCKER);
      const lines = sectionLines(sections, "Processes");
      const pids = lines.map((line) => line.split(" ")[0]);

      // 101: orphaned vite older than 12 h. 103: cwd under /tmp, older than 12 h.
      expect(pids).toContain("101");
      expect(pids).toContain("103");
      // 102: the omp plugin broker. 104: an orphan only 2 h old. 105: a tool
      // directory name (`chrome/`) in the path of a longer program name.
      // 106: an omp worker whose working directory is /tmp.
      expect(pids).not.toContain("102");
      expect(pids).not.toContain("104");
      expect(pids).not.toContain("105");
      expect(pids).not.toContain("106");
      expect(lines.at(-1)).toBe("hint: kill <pid> after you confirm that nothing uses it");
    },
  );

  it.skipIf(WINDOWS)("says when the process list is unavailable", async () => {
    const sections = await buildTidyReport(inputs, stubHost(undefined), NO_DOCKER);

    expect(sectionLines(sections, "Processes")).toEqual(["unavailable: process list unavailable"]);
    expect(sectionLines(sections, "Memory")).toContain("unavailable: process list unavailable");
  });

  it.skipIf(WINDOWS)(
    "lists merged branches without a branch that a worktree checks out",
    async () => {
      const lines = sectionLines(await buildTidyReport(inputs, stubHost([]), NO_DOCKER), "Git");

      expect(lines).toContain(
        `${sandbox.main}: local branches merged into origin/main (1): ${sandbox.doneBranch}`,
      );
      expect(lines).toContain("hint: git branch -d <branch>");
    },
  );

  it.skipIf(WINDOWS)("never calls Docker through an endpoint that is not local", async () => {
    dockerCalls.length = 0;
    const remote: DockerAccess = { kind: "not-local", endpoint: "ssh://prod" };
    const sections = await buildTidyReport(inputs, stubHost([]), remote);

    expect(sectionLines(sections, "Docker")).toEqual([
      "unavailable: docker endpoint ssh://prod is not local",
    ]);
    expect(dockerCalls).toEqual([]);
  });

  it.skipIf(WINDOWS)("puts the verified endpoint first on each Docker call", async () => {
    dockerCalls.length = 0;
    const local: DockerAccess = { kind: "local", endpoint: LOCAL_ENDPOINT };
    const sections = await buildTidyReport(inputs, stubHost([]), local);

    expect(sectionLines(sections, "Docker")).toEqual([
      "Build Cache: 8.9GB, reclaimable 5.2GB",
      "hint: docker builder prune --filter until=168h",
    ]);
    expect(dockerCalls.length).toBeGreaterThan(0);
    for (const args of dockerCalls) expect(args.slice(0, 2)).toEqual(["--host", LOCAL_ENDPOINT]);
  });
});
