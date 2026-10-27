import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { captureWithin, processFailureSummary, spawnProcess } from "../../src/engine-native/exec";
import { hostOs } from "../../src/engine-native/os";

/**
 * Whether `pid` still runs. A killed orphan can stay a zombie until an init
 * process reaps it, so on Linux a zombie counts as ended.
 */
function isRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
  } catch {
    return false;
  }
  if (process.platform !== "linux") return true;
  try {
    const stat = readFileSync(`/proc/${pid}/stat`, "utf8");
    return stat.slice(stat.lastIndexOf(")") + 2, stat.lastIndexOf(")") + 3) !== "Z";
  } catch {
    return false;
  }
}

/** A PATH holding exactly the named shims, so resolution is the same on every host. */
const withPath = async <A>(names: ReadonlyArray<string>, use: () => Promise<A>): Promise<A> => {
  const dir = mkdtempSync(join(tmpdir(), "docks-exec-"));
  const savedPath = process.env["PATH"];
  try {
    for (const name of names) {
      const shim = join(dir, name);
      writeFileSync(shim, "");
      chmodSync(shim, 0o755);
    }
    process.env["PATH"] = dir;
    return await use();
  } finally {
    // Assigning `undefined` would write the string "undefined" into the environment.
    if (savedPath === undefined) delete process.env["PATH"];
    else process.env["PATH"] = savedPath;
    rmSync(dir, { recursive: true, force: true });
  }
};

describe("spawnProcess host resolution", () => {
  const savedComSpec = process.env["ComSpec"];

  beforeEach(() => {
    process.env["ComSpec"] = "C:\\Windows\\System32\\cmd.exe";
  });

  afterEach(() => {
    if (savedComSpec === undefined) delete process.env["ComSpec"];
    else process.env["ComSpec"] = savedComSpec;
  });

  it("refuses a name a suffix host cannot resolve instead of spawning it", async () => {
    // An empty PATH, so a runner that happens to hold this name cannot answer.
    const result = await withPath([], () =>
      spawnProcess("docks-kit-absent-tool", ["--version"], { host: hostOs("windows") }),
    );

    expect(result.exitCode).toBeNull();
    expect(result.stdout).toBe("");
    // A pathless spawn would let the parent's current directory answer.
    expect(result.error?.message).toBe("command not found on PATH: docks-kit-absent-tool");
  });

  it("rejects an unrepresentable argument after resolving a Windows command shim", async () => {
    const result = await withPath(["docks-kit-probe.cmd"], () =>
      spawnProcess("docks-kit-probe", ["bad%arg"], { host: hostOs("windows") }),
    );

    expect(result).toMatchObject({
      exitCode: null,
      stdout: "",
      stderr: "",
      error: expect.objectContaining({
        message: expect.stringContaining('argument "bad%arg" contains a percent sign (%)'),
      }),
    });
  });

  it("hands a POSIX host's command through unchanged", async () => {
    // The running interpreter is absolute and present on every host, so the
    // direct-spawn contract is asserted without a PATH lookup.
    const result = await spawnProcess(process.execPath, ["-e", "process.stdout.write('ok')"], {
      host: hostOs("linux"),
      stdio: ["ignore", "pipe", "pipe"],
    });

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("ok");
    expect(result.error).toBeUndefined();
  });

  it("returns the child's exit status and both captured streams on failure", async () => {
    const result = await spawnProcess(
      process.execPath,
      [
        "-e",
        "process.stdout.write('before'); process.stderr.write('failure'); process.exitCode = 4",
      ],
      { host: hostOs("linux"), stdio: ["ignore", "pipe", "pipe"] },
    );

    expect(result).toEqual({
      exitCode: 4,
      stdout: "before",
      stderr: "failure",
    });
  });
});

describe("spawnProcess time limit", () => {
  // These cases spawn a real child, so the limit runs on the real clock: a fake
  // timer cannot make a child process start or print. The child prints its
  // pid, then runs until a signal ends it.
  const neverCloses = [
    "-e",
    "process.stdout.write(String(process.pid)); setInterval(() => {}, 1000)",
  ];

  it("kills a child that does not close within the limit and reports the timeout", async () => {
    const started = Date.now();
    const result = await spawnProcess(process.execPath, neverCloses, {
      host: hostOs("linux"),
      timeoutMs: 1000,
    });

    expect(Date.now() - started).toBeLessThan(5000);
    expect(result).toMatchObject({ exitCode: null, timedOut: true });
    const pid = Number(result.stdout);
    expect(pid).toBeGreaterThan(0);
    // The kill is asynchronous; the pid disappears after the parent reaps it.
    await vi.waitFor(() => expect(() => process.kill(pid, 0)).toThrow(), { timeout: 5000 });
  });

  it("also ends a process that the timed-out child started", async () => {
    // The child starts a grandchild, prints the grandchild's pid, and waits,
    // like a version proxy that runs the real tool. Both end by themselves
    // after 30 s, so a regression cannot leave them running for long.
    const startsGrandchild = [
      "-e",
      [
        "const { spawn } = require('node:child_process');",
        "const grandchild = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 30000)'], { stdio: 'ignore' });",
        "process.stdout.write(String(grandchild.pid));",
        "setTimeout(() => {}, 30000);",
      ].join(" "),
    ];
    let grandchild = 0;
    try {
      const result = await spawnProcess(process.execPath, startsGrandchild, {
        host: hostOs("linux"),
        timeoutMs: 1000,
      });

      expect(result).toMatchObject({ timedOut: true });
      grandchild = Number(result.stdout);
      expect(grandchild).toBeGreaterThan(0);
      await vi.waitFor(() => expect(isRunning(grandchild)).toBe(false), { timeout: 5000 });
    } finally {
      if (grandchild > 0 && isRunning(grandchild)) process.kill(grandchild, "SIGKILL");
    }
  });

  it("tells a command that does not answer in time from one that answers", async () => {
    await expect(captureWithin(process.execPath, neverCloses, 200)).resolves.toEqual({
      kind: "timed-out",
    });
    await expect(
      captureWithin(process.execPath, ["-e", "process.stdout.write('1.2.3\\n')"], 30_000),
    ).resolves.toEqual({ kind: "output", stdout: "1.2.3" });
  });
});

describe("processFailureSummary", () => {
  it("keeps git's fatal line when the CLI prints more text after it", () => {
    const summary = processFailureSummary({
      exitCode: 1,
      stdout: "",
      stderr:
        "✘ Failed to update marketplace: VcsError: Cloning into '/tmp/clone'...\n" +
        "fatal: unable to access 'https://github.com/DocksDocks/docks.git/': Could not resolve host: github.com\n" +
        "    at VcsError (marketplace.ts:42:11)\n",
    });

    expect(summary).toBe(
      "✘ Failed to update marketplace: VcsError: Cloning into '/tmp/clone'... | " +
        "fatal: unable to access 'https://github.com/DocksDocks/docks.git/': Could not resolve host: github.com",
    );
  });

  it("adds git's fatal line when the first line is itself an Error: line", () => {
    const summary = processFailureSummary({
      exitCode: 1,
      stdout: "",
      stderr:
        "Error: git checkout main failed with status exit status: 128\n" +
        "fatal: unable to read tree abc123\n" +
        "hint: retry later\n",
    });

    expect(summary).toBe(
      "Error: git checkout main failed with status exit status: 128 | fatal: unable to read tree abc123",
    );
  });

  it("falls back to the spawn error when the process printed nothing", () => {
    expect(
      processFailureSummary({
        exitCode: null,
        stdout: "",
        stderr: "",
        error: new Error("spawn omp ENOENT"),
      }),
    ).toBe("spawn omp ENOENT");
    expect(processFailureSummary({ exitCode: 1, stdout: "\n", stderr: "" })).toBe("unknown error");
  });
});
