import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { processFailureSummary, spawnProcess } from "../../src/engine-native/exec";
import { hostOs } from "../../src/engine-native/os";

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
