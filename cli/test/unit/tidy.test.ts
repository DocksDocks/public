import { spawn, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  unlinkSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { kitCacheDir } from "../../src/engine-native/scratch";
import {
  applyTidy,
  defaultTidyHost,
  isLocalDockerEndpoint,
  orphanParents,
  planTidy,
  resolveProcessCwds,
  tidyLockPath,
  tidyLogPath,
  type CwdProbe,
  type ListedProcess,
  type ProcessRow,
  type TidyAction,
  type TidyHost,
  type TidyInputs,
  type TidyPlan,
  type TidyProcess,
} from "../../src/engine-native/tidy";
import { ageAdminFiles, createGitSandbox, type GitSandbox } from "../lib/gitSandbox";

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;
const POSIX = process.platform !== "win32";
/** Mode 000 blocks `lstat` below a directory only for a POSIX user that is not root. */
const CAN_DENY = POSIX && process.getuid?.() !== 0;

let sandbox: GitSandbox;
let inputs: TidyInputs;
let rows: Array<ProcessRow>;
let busyChild: ChildProcess;
let wipOrphan: ChildProcess;
let srvOrphan: ChildProcess;
let wipOrphanExit: Promise<[number | null, NodeJS.Signals | null]>;
const children: Array<ChildProcess> = [];
const calls: Array<string> = [];
const srvApp = resolve("/srv/app");
const srvOther = resolve("/srv/other");
const LOCAL_ENDPOINT = "unix:///run/stub/docker.sock";

/** A child that only waits; tidy may signal only these PIDs. */
function spawnIdle(): ChildProcess {
  const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], {
    stdio: "ignore",
  });
  children.push(child);
  return child;
}

function ok(stdout = ""): TidyProcess {
  return { code: 0, stdout, stderr: "", missing: false };
}

interface StubOptions {
  readonly processes?: () => Promise<ReadonlyArray<ProcessRow> | undefined>;
  /** The `docker context inspect` result; a local socket by default. */
  readonly endpoint?: TidyProcess;
  /** The `docker ps` result; the four stub containers by default. */
  readonly ps?: TidyProcess;
}

function stubHost(options: StubOptions = {}): TidyHost {
  const real = defaultTidyHost();
  const containerRows = [
    ["c-merged", "running", "proj-merged", sandbox.worktrees.merged],
    ["c-wip", "running", "proj-wip", sandbox.worktrees.wip],
    ["c-gone", "exited", "proj-gone", sandbox.gone],
    ["c-other", "running", "proj-other", srvOther],
  ]
    .map((fields) => fields.join("\t"))
    .join("\n");
  return {
    git: async (args) => {
      calls.push(`git ${args.join(" ")}`);
      return real.git(args);
    },
    docker: async (args) => {
      calls.push(`docker ${args.join(" ")}`);
      return args[2] === "ps" ? (options.ps ?? ok(`${containerRows}\n`)) : ok();
    },
    dockerEndpoint: async () => options.endpoint ?? ok(`${LOCAL_ENDPOINT}\n`),
    run: async () => ({ code: null, stdout: "", stderr: "", missing: true }),
    processes: options.processes ?? (async () => rows),
    now: () => Date.now(),
  };
}

function dockerCalls(): Array<string> {
  return calls.filter((call) => call.startsWith("docker "));
}

function kinds(plan: TidyPlan, kind: TidyAction["kind"]): Array<TidyAction> {
  return plan.actions.filter((action) => action.kind === kind);
}

function keptReason(plan: TidyPlan, subject: string): string | undefined {
  return plan.kept.find((entry) => entry.subject === subject)?.reason;
}

function setAge(path: string, ageMs: number): void {
  const time = new Date(Date.now() - ageMs);
  utimesSync(path, time, time);
}

beforeAll(() => {
  sandbox = createGitSandbox();
  inputs = {
    home: sandbox.home,
    worktreeRoot: sandbox.worktreeRoot,
    scratchRoot: sandbox.scratchRoot,
  };
  const old = join(sandbox.scratchRoot, "old-ab12");
  mkdirSync(old);
  writeFileSync(join(old, "result.txt"), "x\n");
  setAge(join(old, "result.txt"), 8 * DAY_MS);
  setAge(old, 8 * DAY_MS);
  mkdirSync(join(sandbox.scratchRoot, "fresh-cd34"));

  busyChild = spawnIdle();
  wipOrphan = spawnIdle();
  srvOrphan = spawnIdle();
  wipOrphanExit = once(wipOrphan, "exit") as Promise<[number | null, NodeJS.Signals | null]>;
  const row = (child: ChildProcess, fields: Partial<ProcessRow>): ProcessRow => ({
    pid: child.pid!,
    ppid: 1,
    ageMs: 30 * HOUR_MS,
    rssKb: 1024,
    comm: "node",
    args: "node server.js",
    cwd: undefined,
    ...fields,
  });
  rows = [
    row(busyChild, { ppid: process.pid, ageMs: HOUR_MS, cwd: sandbox.worktrees.busy }),
    row(wipOrphan, { cwd: sandbox.worktrees.wip }),
    row(srvOrphan, { cwd: srvApp }),
  ];
});

afterAll(() => {
  for (const child of children) {
    if (child.exitCode === null && child.signalCode === null) child.kill();
  }
  sandbox.dispose();
});

describe("resolveProcessCwds", () => {
  const listed = (pid: number, comm: string, ppid = 1): ListedProcess => ({
    pid,
    ppid,
    ageMs: 30 * HOUR_MS,
    rssKb: 1024,
    comm,
    args: comm,
  });
  /** Reads that the test names per PID; a PID it does not name has `/w`. */
  const reader =
    (probes: Record<number, CwdProbe>) =>
    (pid: number): CwdProbe =>
      probes[pid] ?? { kind: "cwd", path: "/w" };

  it("drops a process that exited during the probe", () => {
    const resolved = resolveProcessCwds(
      [listed(10, "node"), listed(11, "node")],
      reader({ 11: { kind: "exited" } }),
    );

    expect(resolved?.map((row) => row.pid)).toEqual([10]);
  });

  it("keeps an unreadable systemd row without a cwd, so that its children stay orphans", () => {
    const resolved = resolveProcessCwds(
      [listed(2005, "systemd"), listed(2021, "(sd-pam)", 2005), listed(3000, "node", 2005)],
      reader({ 2005: { kind: "unreadable" }, 2021: { kind: "unreadable" } }),
    );

    expect(resolved).toBeDefined();
    expect(resolved!.find((row) => row.pid === 2005)?.cwd).toBeUndefined();
    expect(resolved!.find((row) => row.pid === 2021)?.cwd).toBeUndefined();
    expect(orphanParents(resolved!).has(2005)).toBe(true);
  });

  it.each(["ssh-agent", "gpg-agent", "/usr/bin/ssh-agent"])(
    "keeps an unreadable %s row without a cwd",
    (comm) => {
      const resolved = resolveProcessCwds(
        [listed(40, comm)],
        reader({ 40: { kind: "unreadable" } }),
      );

      expect(resolved).toEqual([{ ...listed(40, comm), cwd: undefined }]);
    },
  );

  it("returns undefined when any other live process has an unreadable cwd", () => {
    const resolved = resolveProcessCwds(
      [listed(2005, "systemd"), listed(50, "node", 2005)],
      reader({ 2005: { kind: "unreadable" }, 50: { kind: "unreadable" } }),
    );

    expect(resolved).toBeUndefined();
  });
});

describe("isLocalDockerEndpoint", () => {
  it.each([
    "unix:///run/user/1000/docker.sock",
    "unix:///var/run/docker.sock",
    "unix:///Users/dev/.docker/run/docker.sock",
    "npipe:////./pipe/docker_engine",
    "npipe:////./pipe/dockerDesktopLinuxEngine",
  ])("accepts %j", (value) => {
    expect(isLocalDockerEndpoint(value)).toBe(true);
  });

  it.each([
    "",
    "ssh://prod",
    "ssh://user@prod:22",
    "tcp://10.0.0.5:2375",
    "tcp://localhost:2375",
    "fd://",
    "fd://3",
    "unix://relative",
    "unix://",
    "unix:///",
    " unix:///var/run/docker.sock",
    "unix:///var/run/docker.sock\nssh://prod",
    "unix:///var/run\\docker.sock",
    "npipe:////host/pipe/docker_engine",
    "npipe:////./pipe/",
    "npipe:////./pipe/a/b",
    "npipe:////./pipe/a\\b",
    "npipe://./pipe/docker_engine",
    "npipe:\\\\.\\pipe\\docker_engine",
    "npipe:////.\\pipe\\docker_engine",
  ])("rejects %j", (value) => {
    expect(isLocalDockerEndpoint(value)).toBe(false);
  });
});

describe("planTidy", () => {
  it("removes the merged idle worktree and keeps every other worktree with its reason", async () => {
    calls.length = 0;
    const plan = await planTidy(inputs, stubHost());
    const { merged, wip, dirty, recent, busy } = sandbox.worktrees;

    expect(dockerCalls().length).toBeGreaterThan(0);
    for (const call of dockerCalls()) {
      expect(call.startsWith(`docker --host ${LOCAL_ENDPOINT} `)).toBe(true);
    }

    expect(kinds(plan, "remove-worktree")).toEqual([
      {
        kind: "remove-worktree",
        path: merged,
        repo: sandbox.main,
        containerIds: ["c-merged"],
        projects: ["proj-merged"],
        reason: "merged into origin/main, idle 48 h",
      },
    ]);
    expect(keptReason(plan, `worktree ${wip}`)).toBe("not merged into origin/main");
    expect(keptReason(plan, `worktree ${dirty}`)).toBe("has changes");
    expect(keptReason(plan, `worktree ${recent}`)).toBe("active 0 h ago");
    expect(keptReason(plan, `worktree ${busy}`)).toBe("in use by a running process");

    expect(kinds(plan, "stop-process")).toEqual([
      {
        kind: "stop-process",
        pid: wipOrphan.pid,
        args: "node server.js",
        cwd: wip,
        reason: "orphaned for 30 h",
      },
    ]);

    // The orphan in wip uses that worktree, so its container keeps running.
    expect(kinds(plan, "stop-containers")).toEqual([]);
    expect(keptReason(plan, `containers of proj-wip in ${wip}`)).toBe(
      "in use by a running process",
    );
    expect(kinds(plan, "remove-containers")).toEqual([
      {
        kind: "remove-containers",
        project: "proj-gone",
        workingDir: sandbox.gone,
        ids: ["c-gone"],
        reason: "directory is gone",
      },
    ]);
    expect(JSON.stringify(plan)).not.toContain("c-other");

    expect(kinds(plan, "remove-scratch")).toEqual([
      {
        kind: "remove-scratch",
        path: join(sandbox.scratchRoot, "old-ab12"),
        reason: "idle 8 d",
      },
    ]);
    expect(keptReason(plan, `scratch ${join(sandbox.scratchRoot, "fresh-cd34")}`)).toBe(
      "active 0 h ago",
    );
  });

  it("keeps every in-use-dependent candidate when the process list is unavailable", async () => {
    const plan = await planTidy(inputs, stubHost({ processes: async () => undefined }));

    expect(plan.actions.map((action) => action.kind)).toEqual(["remove-containers"]);
    expect(keptReason(plan, `worktree ${sandbox.worktrees.merged}`)).toBe(
      "process list unavailable",
    );
    expect(keptReason(plan, `scratch ${join(sandbox.scratchRoot, "old-ab12")}`)).toBe(
      "process list unavailable",
    );
    expect(plan.notes).toContain(
      "process list unavailable; kept every candidate that a running process could use",
    );
  });

  it("refuses a root that contains the home directory", async () => {
    const plan = await planTidy({ ...inputs, worktreeRoot: sandbox.base }, stubHost());

    expect(plan.notes).toContain(`refusing root ${sandbox.base}: it contains the home directory`);
    expect(kinds(plan, "remove-worktree")).toEqual([]);
  });

  it.skipIf(!CAN_DENY)("keeps the containers of a directory that it cannot check", async () => {
    const sealed = join(sandbox.worktreeRoot, "sealed");
    const workingDir = join(sealed, "app");
    mkdirSync(workingDir, { recursive: true });
    chmodSync(sealed, 0o000);
    try {
      const ps = ok(`c-sealed\texited\tproj-sealed\t${workingDir}\n`);
      const plan = await planTidy(inputs, stubHost({ ps }));

      // `existsSync` reports false for EACCES; only ENOENT or ENOTDIR means gone.
      expect(kinds(plan, "remove-containers")).toEqual([]);
      expect(plan.notes).toContain(`cannot check ${workingDir}: EACCES`);
    } finally {
      chmodSync(sealed, 0o700);
      rmSync(sealed, { recursive: true, force: true });
    }
  });

  it.skipIf(!CAN_DENY)("keeps an old scratch entry whose children it cannot list", async () => {
    const sealed = join(sandbox.scratchRoot, "sealed-ef56");
    mkdirSync(sealed);
    setAge(sealed, 8 * DAY_MS);
    chmodSync(sealed, 0o000);
    try {
      const plan = await planTidy(inputs, stubHost());

      const removed = plan.actions.some(
        (action) => action.kind === "remove-scratch" && action.path === sealed,
      );
      expect(removed).toBe(false);
      expect(keptReason(plan, `scratch ${sealed}`)).toBe(`cannot check ${sealed}: EACCES`);
    } finally {
      chmodSync(sealed, 0o700);
      rmSync(sealed, { recursive: true, force: true });
    }
  });

  it("counts a recent change to a file with a non-ASCII name toward the stack idle time", async () => {
    const accent = join(sandbox.worktreeRoot, "repo", "accent");
    sandbox.git(sandbox.main, "worktree", "add", "-q", "--detach", accent, "main");
    writeFileSync(join(accent, "café.ts"), "export {};\n");
    ageAdminFiles(accent, 48 * HOUR_MS);

    const ps = ok(`c-accent\trunning\tproj-accent\t${accent}\n`);
    const plan = await planTidy(inputs, stubHost({ ps }));

    // Plain porcelain quotes the name as "caf\303\251.ts"; `-z` keeps it as is.
    expect(keptReason(plan, `worktree ${accent}`)).toBe("has changes");
    expect(kinds(plan, "stop-containers")).toEqual([]);
    expect(keptReason(plan, `containers of proj-accent in ${accent}`)).toBe("active 0 h ago");
  });
});

describe("planTidy without a verified local Docker endpoint", () => {
  it.each([
    { endpoint: ok("ssh://prod\n"), shown: "ssh://prod" },
    { endpoint: ok("tcp://10.0.0.5:2375\n"), shown: "tcp://10.0.0.5:2375" },
    {
      endpoint: ok("npipe:////host/pipe/docker_engine\n"),
      shown: "npipe:////host/pipe/docker_engine",
    },
    { endpoint: ok(""), shown: "<empty>" },
    {
      endpoint: { code: 1, stdout: "", stderr: "context not found", missing: false },
      shown: "<empty>",
    },
  ])("$shown: no container action, and every removable worktree stays", async (row) => {
    calls.length = 0;
    const plan = await planTidy(inputs, stubHost({ endpoint: row.endpoint }));

    // The orphan and scratch rules do not use Docker.
    expect(plan.actions.map((action) => action.kind).sort()).toEqual([
      "remove-scratch",
      "stop-process",
    ]);
    expect(keptReason(plan, `worktree ${sandbox.worktrees.merged}`)).toBe(
      "docker endpoint not local",
    );
    expect(plan.notes).toContain(
      `docker endpoint ${row.shown} is not local; skipped container rules`,
    );
    expect(dockerCalls()).toEqual([]);
  });

  it("keeps the worktree rule when docker is not installed", async () => {
    calls.length = 0;
    const missing = { code: null, stdout: "", stderr: "spawn docker ENOENT", missing: true };
    const plan = await planTidy(inputs, stubHost({ endpoint: missing }));

    expect(kinds(plan, "remove-worktree")).toEqual([
      expect.objectContaining({ path: sandbox.worktrees.merged, containerIds: [] }),
    ]);
    expect(kinds(plan, "remove-containers")).toEqual([]);
    expect(plan.notes).toContain("docker unavailable: spawn docker ENOENT");
    expect(dockerCalls()).toEqual([]);
  });

  it("keeps every removable worktree when the local daemon cannot list containers", async () => {
    const down = { code: 1, stdout: "", stderr: "Cannot connect to the daemon", missing: false };
    const plan = await planTidy(inputs, stubHost({ ps: down }));

    expect(plan.actions.map((action) => action.kind).sort()).toEqual([
      "remove-scratch",
      "stop-process",
    ]);
    expect(keptReason(plan, `worktree ${sandbox.worktrees.merged}`)).toBe(
      "container list unavailable",
    );
    expect(plan.notes).toContain("docker unavailable: Cannot connect to the daemon");
  });
});

describe("applyTidy", () => {
  it("changes nothing while another run holds a fresh lock", async () => {
    const host = stubHost();
    const plan = await planTidy(inputs, host);
    mkdirSync(kitCacheDir(sandbox.home), { recursive: true });
    const lock = tidyLockPath(sandbox.home);
    writeFileSync(lock, `${process.pid} ${new Date().toISOString()}\n`);
    calls.length = 0;

    const outcome = await applyTidy(plan, inputs, host);

    expect(outcome).toEqual({
      locked: true,
      failures: 0,
      lines: [`another docks-kit tidy run holds ${lock}`],
    });
    expect(calls).toEqual([]);
    expect(existsSync(sandbox.worktrees.merged)).toBe(true);
    expect(existsSync(join(sandbox.scratchRoot, "old-ab12"))).toBe(true);
    expect(wipOrphan.exitCode).toBeNull();
    expect(wipOrphan.signalCode).toBeNull();
    unlinkSync(lock);
  });

  it("fails each container action when the plan carries no local endpoint", async () => {
    const host = stubHost();
    const plan = await planTidy(inputs, host);
    // A plan whose endpoint changed after the check: `localDocker` checks again.
    const tampered: TidyPlan = {
      ...plan,
      actions: plan.actions.filter(
        (action) => action.kind === "remove-worktree" || action.kind === "remove-containers",
      ),
      docker: { kind: "local", endpoint: "ssh://prod" },
    };
    calls.length = 0;

    const outcome = await applyTidy(tampered, inputs, host);

    expect(outcome.failures).toBe(2);
    expect(outcome.lines).toContain(
      `failed worktree ${sandbox.worktrees.merged} with 1 container: docker endpoint ssh://prod is not local`,
    );
    expect(dockerCalls()).toEqual([]);
    expect(existsSync(sandbox.worktrees.merged)).toBe(true);
  });

  it("performs the plan: containers first, then the worktree, and only the selected PID", async () => {
    const host = stubHost();
    const plan = await planTidy(inputs, host);
    calls.length = 0;

    const outcome = await applyTidy(plan, inputs, host);

    expect(outcome.locked).toBe(false);
    expect(outcome.failures).toBe(0);
    expect(existsSync(sandbox.worktrees.merged)).toBe(false);
    expect(sandbox.git(sandbox.main, "worktree", "list")).not.toContain("merged");
    const dockerRemove = calls.indexOf(
      `docker --host ${LOCAL_ENDPOINT} rm --force --volumes c-merged`,
    );
    const worktreeRemove = calls.indexOf(
      `git -C ${sandbox.main} worktree remove -- ${sandbox.worktrees.merged}`,
    );
    expect(dockerRemove).toBeGreaterThanOrEqual(0);
    expect(worktreeRemove).toBeGreaterThan(dockerRemove);
    expect(calls.some((call) => call.includes("--force") && call.startsWith("git "))).toBe(false);
    expect(calls).toContain(`docker --host ${LOCAL_ENDPOINT} rm --force --volumes c-gone`);
    expect(calls.some((call) => call.includes("c-other") || call.includes("c-wip"))).toBe(false);
    for (const call of dockerCalls()) {
      expect(call.startsWith(`docker --host ${LOCAL_ENDPOINT} `)).toBe(true);
    }

    const [, signal] = await wipOrphanExit;
    if (POSIX) expect(signal).toBe("SIGTERM");
    expect(srvOrphan.exitCode).toBeNull();
    expect(srvOrphan.signalCode).toBeNull();
    expect(busyChild.exitCode).toBeNull();

    expect(existsSync(join(sandbox.scratchRoot, "old-ab12"))).toBe(false);
    expect(existsSync(join(sandbox.scratchRoot, "fresh-cd34"))).toBe(true);
    expect(existsSync(tidyLockPath(sandbox.home))).toBe(false);
    const log = readFileSync(tidyLogPath(sandbox.home), "utf8");
    expect(log).toContain(`removed worktree ${sandbox.worktrees.merged} with 1 container`);
    expect(log).toMatch(/^\d{4}-\d{2}-\d{2}T\S+ stopped process /m);
  });
});
