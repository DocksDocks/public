/**
 * The verify-gate omp extension of the kit plugin, ported from DocksDocks/docks
 * `scripts/tests/unit/verify-gate.test.mjs`. The cases drive the adapter's
 * `tool_call` handler with bash calls, and call the core's `checkCommand`
 * directly for the deadline and the denial state cases.
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it, onTestFinished, vi } from "vitest";

import {
  EXTENSIONS_DIR,
  GIT_SCRIPT_SKIP,
  type Handler,
  captureOutput,
  extensionHandler,
  realGit,
  tempDir,
  withEnv,
} from "../../lib/extensions/harness";

const EXTENSION = path.join(EXTENSIONS_DIR, "verify-gate.ts");
const CORE = path.join(EXTENSIONS_DIR, "verify-gate-core.ts");
const UNVERIFIED = 'git commit -m "fix: handle empty input"';
const VERIFIED =
  'git commit -m "fix: handle empty input" -m "Verified: bun test scripts/tests/unit"';
const DENY_REASON =
  "verify-gate: the commit message has no Verified: trailer. Add a last paragraph with " +
  "`Verified: <command>[; <command>]` or `Verified: none - <reason>`. Name the checks that you ran, or say why none ran.";

// Each test gives its calls their own state folder. This folder holds XDG_STATE_HOME for the whole run, so a call
// without its own folder cannot write into the real user log.
const SUITE_STATE = fs.realpathSync.native(
  fs.mkdtempSync(path.join(os.tmpdir(), "verify-gate-suite-")),
);
const PREVIOUS_STATE_HOME = process.env["XDG_STATE_HOME"];
process.env["XDG_STATE_HOME"] = SUITE_STATE;
afterAll(() => {
  if (PREVIOUS_STATE_HOME === undefined) delete process.env["XDG_STATE_HOME"];
  else process.env["XDG_STATE_HOME"] = PREVIOUS_STATE_HOME;
  fs.rmSync(SUITE_STATE, { recursive: true, force: true });
});

// The git file that the PATH of the test process names first.
const REAL_GIT = realGit();

// Windows has no POSIX file modes: a file there reports the mode bits that its read-only flag gives.
const POSIX_MODES = process.platform !== "win32";

const FIFO_SKIP = "Windows has no FIFO in its file system, so the fixture cannot exist there";

type GateResult = { readonly block: true; readonly reason: string } | undefined;

/** One line of `verify-gate.jsonl`. */
interface LogLine {
  readonly time: string;
  readonly mode: string;
  readonly session_id: string;
  readonly cwd: string;
  readonly message_sources: ReadonlyArray<string>;
  readonly allowed_after_denials?: number;
}

/** The denial counts of `verify-gate-denials.json`, by session id. */
type Denials = Readonly<Record<string, { readonly count: number; readonly time: number }>>;

interface CheckOptions {
  readonly command: string;
  readonly cwd: string;
  readonly sessionId: string;
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly deadlineMs?: number;
}

type CheckCommand = (options: CheckOptions) => Promise<string | null>;

const isCheckCommand = (value: unknown): value is CheckCommand => typeof value === "function";

// The core's check, loaded from the path that CORE names.
async function coreCheckCommand(): Promise<CheckCommand> {
  // A runtime path: the suite names the core in one constant.
  const core: { readonly checkCommand?: unknown } = await import(CORE);
  const { checkCommand } = core;
  if (!isCheckCommand(checkCommand)) throw new Error(`${CORE} exports no checkCommand function`);
  return checkCommand;
}

const tempFolder = (label: string): string => tempDir(`verify-gate-${label}-`);

// Run the extension factory with a fake `pi` that records each handler, and return the one `tool_call` handler.
const toolCallHandler = (): Promise<Handler<GateResult>> =>
  extensionHandler<GateResult>(EXTENSION, "tool_call");

const sessionContext = (cwd: string, session: string): object => ({
  cwd,
  sessionManager: { getSessionId: () => session },
});

interface GateCall {
  readonly state?: string;
  readonly mode?: string | undefined;
  readonly command: string;
  readonly cwd?: string;
  readonly inputCwd?: string;
  readonly session?: string;
  readonly toolName?: string;
  readonly ctx?: object;
  readonly handler?: Handler<GateResult>;
}

// Drive a tool_call handler once with a bash call. `ctx` replaces the default session context, and `handler`
// replaces a new handler. A call without `state` uses the state folder of the suite.
async function runGate({
  state = SUITE_STATE,
  mode,
  command,
  cwd = os.tmpdir(),
  inputCwd,
  session = "s1",
  toolName = "bash",
  ctx = sessionContext(cwd, session),
  handler,
}: GateCall): Promise<GateResult> {
  const toolCall = handler ?? (await toolCallHandler());
  const input = inputCwd === undefined ? { command } : { command, cwd: inputCwd };
  const event = { type: "tool_call", toolName, toolCallId: "call_1", input };
  return withEnv({ XDG_STATE_HOME: state, DOCKS_VERIFY_GATE: mode }, () => toolCall(event, ctx));
}

// A git command in `repo`.
const gitIn =
  (repo: string) =>
  (...args: ReadonlyArray<string>): string =>
    execFileSync("git", args, { cwd: repo, encoding: "utf8" });

// A git repository with one commit whose message carries the trailer, and a second commit without it.
function gitRepo(label: string): string {
  const repo = tempFolder(label);
  const git = gitIn(repo);
  git("init", "-q", "-b", "main");
  git("config", "user.email", "verify-gate@example.test");
  git("config", "user.name", "Verify Gate Test");
  git(
    "commit",
    "-q",
    "--allow-empty",
    "-m",
    "chore: seed",
    "-m",
    "Verified: none - empty seed commit",
  );
  git("commit", "-q", "--allow-empty", "-m", "chore: second");
  return repo;
}

function logLines(state: string): ReadonlyArray<LogLine> {
  const file = path.join(state, "docks", "verify-gate.jsonl");
  if (!fs.existsSync(file)) return [];
  return fs
    .readFileSync(file, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((line): LogLine => JSON.parse(line));
}

const readDenials = (file: string): Denials => JSON.parse(fs.readFileSync(file, "utf8"));

// A deny gives the unchanged reason text of the old hook.
function expectDenied(result: GateResult): void {
  expect(result).toStrictEqual({ block: true, reason: DENY_REASON });
}

// A read that waits for a writer of the FIFO would keep the test process alive. A writer that opens and closes
// the FIFO ends such a read; without a reader the open fails, and nothing waits.
function releaseFifoAfterCase(fifo: string): void {
  onTestFinished(() => {
    try {
      fs.closeSync(fs.openSync(fifo, fs.constants.O_WRONLY | fs.constants.O_NONBLOCK));
    } catch {
      // No reader waits on the FIFO.
    }
  });
}

// Replace fs.promises.writeFile for the temporary denial files of one state folder. The stub records the name of each
// temporary file and the highest count of these writes at the same time. With `hold`, the first write waits until
// `release()`; `held` settles when that write starts.
function watchDenialWrites(state: string, { hold = false }: { readonly hold?: boolean } = {}) {
  const realWriteFile = fs.promises.writeFile;
  const prefix = path.join(state, "docks", "verify-gate-denials.json.");
  const writes = { names: new Array<string>(), active: 0, maxActive: 0 };
  const gate = Promise.withResolvers<void>();
  const release = gate.resolve;
  const released = hold ? gate.promise : Promise.resolve();
  const { promise: held, resolve: started } = Promise.withResolvers<void>();
  const spy = vi.spyOn(fs.promises, "writeFile").mockImplementation(async (file, ...rest) => {
    if (typeof file !== "string" || !file.startsWith(prefix)) return realWriteFile(file, ...rest);
    writes.names.push(file);
    writes.active += 1;
    writes.maxActive = Math.max(writes.maxActive, writes.active);
    try {
      if (writes.names.length === 1) {
        started();
        await released;
      }
      return await realWriteFile(file, ...rest);
    } finally {
      writes.active -= 1;
    }
  });
  onTestFinished(() => {
    spy.mockRestore();
    release();
  });
  return { writes, held, release };
}

describe("verify-gate extension", () => {
  it("off mode allows a commit without the trailer and writes no log", async () => {
    const state = tempFolder("off");
    expect(await runGate({ state, mode: "off", command: UNVERIFIED })).toBe(undefined);
    expect(fs.existsSync(path.join(state, "docks"))).toBe(false);
  });

  it("observe mode is the default, allows the commit, and appends one log line", async () => {
    const state = tempFolder("observe");
    const cwd = tempFolder("observe-cwd");
    expect(await runGate({ state, command: UNVERIFIED, cwd })).toBe(undefined);
    expect(await runGate({ state, mode: "observe", command: VERIFIED, cwd })).toBe(undefined);
    const lines = logLines(state);
    expect(lines.length).toBe(1);
    const [line] = lines;
    expect(Object.keys(line ?? {}).sort()).toStrictEqual([
      "cwd",
      "message_sources",
      "mode",
      "session_id",
      "time",
    ]);
    expect(line?.mode).toBe("observe");
    expect(line?.message_sources).toStrictEqual(["-m"]);
    expect(line?.session_id).toBe("s1");
    expect(line?.cwd).toBe(cwd);
    expect(new Date(line?.time ?? "").toISOString()).toBe(line?.time);
    if (POSIX_MODES) {
      expect(fs.statSync(path.join(state, "docks")).mode & 0o777).toBe(0o700);
      expect(fs.statSync(path.join(state, "docks", "verify-gate.jsonl")).mode & 0o777).toBe(0o600);
    }
  });

  it("enforce mode denies twice in a session, then allows and logs the third commit", async () => {
    const state = tempFolder("enforce");
    expectDenied(await runGate({ state, mode: "enforce", command: UNVERIFIED }));
    expectDenied(await runGate({ state, mode: "enforce", command: UNVERIFIED }));
    // Another session keeps its own count.
    expectDenied(await runGate({ state, mode: "enforce", command: UNVERIFIED, session: "s2" }));
    expect(logLines(state).length).toBe(0);
    expect(await runGate({ state, mode: "enforce", command: UNVERIFIED })).toBe(undefined);
    const lines = logLines(state);
    expect(lines.length).toBe(1);
    const [line] = lines;
    expect(line?.session_id).toBe("s1");
    expect(line?.mode).toBe("enforce");
    expect(line?.allowed_after_denials).toBe(2);
    expect(Object.keys(line ?? {}).sort()).toStrictEqual([
      "allowed_after_denials",
      "cwd",
      "message_sources",
      "mode",
      "session_id",
      "time",
    ]);
    // The count starts again after the allowed commit.
    expectDenied(await runGate({ state, mode: "enforce", command: UNVERIFIED }));
  });

  it("the log holds no text of the command or the message, so a secret in either stays out", async () => {
    const state = tempFolder("secret");
    const token = "ghp_TESTTOKEN123";
    const commands = [
      `GH_TOKEN=${token} gh auth status && git commit -m "fix: rotate key" -m "Body names ${token}."`,
      `git commit -m "fix: remove token ${token}"`,
      `git commit -F - <<EOF\nfix: remove token ${token}\nEOF`,
    ];
    for (const [index, command] of commands.entries()) {
      expect(await runGate({ state, mode: "observe", command }), command).toBe(undefined);
      for (let call = 0; call < 3; call += 1) {
        await runGate({ state, mode: "enforce", command, session: `secret-${index}` });
      }
    }
    const raw = fs.readFileSync(path.join(state, "docks", "verify-gate.jsonl"), "utf8");
    expect(logLines(state).map((line) => line.mode)).toStrictEqual([
      "observe",
      "enforce",
      "observe",
      "enforce",
      "observe",
      "enforce",
    ]);
    expect(raw.includes(token), raw).toBe(false);
    expect(raw.includes("gh auth status"), raw).toBe(false);
    expect(raw.includes("rotate key"), raw).toBe(false);
    expect(raw.includes("remove token"), raw).toBe(false);
  });

  it("the log names each message source kind", async () => {
    const state = tempFolder("sources");
    await runGate({ state, command: 'git commit -m "fix: x"' });
    await runGate({ state, command: "git commit" });
    await runGate({
      state,
      command: 'git commit -F - --trailer "Reviewed-by=A" <<EOF\nfix: y\nEOF',
    });
    expect(logLines(state).map((line) => line.message_sources)).toStrictEqual([
      ["-m"],
      ["none"],
      ["-F", "--trailer"],
    ]);
  });

  it("enforce mode allows a commit whose message carries the trailer", async () => {
    const state = tempFolder("trailer");
    expect(await runGate({ state, mode: "enforce", command: VERIFIED })).toBe(undefined);
    const heredoc = [
      `git add -A && git commit -m "$(cat <<'EOF'`,
      "fix: handle (unbalanced input",
      "",
      "Verified: none - documentation only",
      "EOF",
      ')"',
    ].join("\n");
    expect(await runGate({ state, mode: "enforce", command: heredoc })).toBe(undefined);
    expect(
      await runGate({
        state,
        mode: "enforce",
        command: 'git commit -m "fix: x" --trailer "Verified=bun test"',
      }),
    ).toBe(undefined);
    // A bare `none` without a reason and a trailer in the subject line do not count.
    expectDenied(
      await runGate({
        state,
        mode: "enforce",
        command: 'git commit -m "fix: x" -m "Verified: none"',
      }),
    );
    expectDenied(
      await runGate({ state, mode: "enforce", command: 'git commit -m "Verified: bun test"' }),
    );
  });

  it("a command without a creating git commit is allowed in enforce mode", async () => {
    const state = tempFolder("non-commit");
    for (const command of [
      "ls -la",
      "git status && git log -1",
      'echo "git commit -m x"',
      "git commit --dry-run -m x",
    ]) {
      expect(await runGate({ state, mode: "enforce", command }), command).toBe(undefined);
    }
    expect(logLines(state).length).toBe(0);
  });

  it("a call of another tool than bash is allowed and logs nothing, also with a commit command", async () => {
    const state = tempFolder("non-bash");
    for (const toolName of ["edit", "write", "eval"]) {
      expect(
        await runGate({ state, mode: "observe", command: UNVERIFIED, toolName }),
        toolName,
      ).toBe(undefined);
      for (let call = 0; call < 3; call += 1) {
        expect(
          await runGate({ state, mode: "enforce", command: UNVERIFIED, toolName }),
          toolName,
        ).toBe(undefined);
      }
    }
    expect(fs.existsSync(path.join(state, "docks"))).toBe(false);
  });

  it("a -F file message is read relative to the command directory", async () => {
    const state = tempFolder("file");
    const cwd = tempFolder("file-cwd");
    fs.writeFileSync(path.join(cwd, "verified.txt"), "fix: x\n\nVerified: bun test\n");
    fs.writeFileSync(path.join(cwd, "plain.txt"), "fix: x\n\nBody only.\n");
    expect(
      await runGate({ state, mode: "enforce", cwd, command: "git commit -F verified.txt" }),
    ).toBe(undefined);
    expect(
      await runGate({ state, mode: "enforce", cwd, command: "git commit --file=verified.txt" }),
    ).toBe(undefined);
    expectDenied(
      await runGate({ state, mode: "enforce", cwd, command: "git commit -aF plain.txt" }),
    );
    const stdinHeredoc = ["git commit -F - <<EOF", "fix: x", "", "Verified: bun test", "EOF"].join(
      "\n",
    );
    expect(await runGate({ state, mode: "enforce", cwd, command: stdinHeredoc })).toBe(undefined);
  });

  it("input.cwd of the bash call sets the commit base folder below ctx.cwd", async () => {
    const state = tempFolder("input-cwd");
    const cwd = tempFolder("input-cwd-session");
    const sub = path.join(cwd, "sub");
    fs.mkdirSync(sub);
    // The same file name holds no trailer in the session folder and a trailer in sub.
    fs.writeFileSync(path.join(cwd, "message.txt"), "fix: x\n\nBody only.\n");
    fs.writeFileSync(path.join(sub, "message.txt"), "fix: x\n\nVerified: bun test\n");
    const command = "git commit -F message.txt";
    expectDenied(await runGate({ state, mode: "enforce", cwd, command }));
    expect(await runGate({ state, mode: "enforce", cwd, inputCwd: "sub", command })).toBe(
      undefined,
    );
    expect(await runGate({ state, mode: "enforce", cwd, inputCwd: sub, command })).toBe(undefined);
    // The log names the resolved base folder, not ctx.cwd.
    await runGate({ state, mode: "observe", cwd, inputCwd: "sub", command: UNVERIFIED });
    const lines = logLines(state);
    expect(lines.length).toBe(1);
    expect(lines[0]?.cwd).toBe(sub);
  });

  it("a context without a session id logs the session id unknown", async () => {
    const state = tempFolder("no-session");
    const cwd = tempFolder("no-session-cwd");
    const contexts = [
      { cwd },
      { cwd, sessionManager: { getSessionId: () => undefined } },
      { cwd, sessionManager: { getSessionId: () => "" } },
    ];
    for (const ctx of contexts) {
      expect(await runGate({ state, mode: "observe", command: UNVERIFIED, ctx })).toBe(undefined);
    }
    const lines = logLines(state);
    expect(lines.map((line) => line.session_id)).toStrictEqual(["unknown", "unknown", "unknown"]);
    expect(lines[0]?.cwd).toBe(cwd);
  });

  it("one handler reads DOCKS_VERIFY_GATE and XDG_STATE_HOME again on each call", async () => {
    const first = tempFolder("env-first");
    const second = tempFolder("env-second");
    // omp keeps one handler for the whole session, so each call goes to the same handler.
    const handler = await toolCallHandler();
    const gate = (state: string, mode: string | undefined): Promise<GateResult> =>
      runGate({ handler, state, mode, command: UNVERIFIED });
    expect(await gate(first, "off")).toBe(undefined);
    expect(fs.existsSync(path.join(first, "docks"))).toBe(false);
    expect(await gate(first, "observe")).toBe(undefined);
    expect(logLines(first).length).toBe(1);
    expectDenied(await gate(second, "enforce"));
    expect(await gate(second, "off")).toBe(undefined);
    expect(await gate(second, "observe")).toBe(undefined);
    expect(await gate(first, undefined)).toBe(undefined);
    expect(logLines(first).length).toBe(2);
    expect(logLines(second).map((line) => line.mode)).toStrictEqual(["observe"]);
  });

  it("an unknown mode works as observe and prints nothing; a known mode is read without case and space", async () => {
    const state = tempFolder("unknown-mode");
    const { result, printed } = await captureOutput(() =>
      runGate({ state, mode: " Bogus ", command: UNVERIFIED }),
    );
    expect(result).toBe(undefined);
    expect(printed).toStrictEqual([]);
    expect(logLines(state).map((line) => line.mode)).toStrictEqual(["observe"]);
    expectDenied(await runGate({ state, mode: " Enforce ", command: UNVERIFIED }));
    expect(await runGate({ state, mode: "OFF", command: UNVERIFIED })).toBe(undefined);
    expect(logLines(state).length).toBe(1);
  });

  it("--amend without a new message reads the HEAD message", async () => {
    const state = tempFolder("amend");
    const repo = tempFolder("amend-repo");
    const git = gitIn(repo);
    git("init", "-q", "-b", "main");
    git("config", "user.email", "verify-gate@example.test");
    git("config", "user.name", "Verify Gate Test");
    git(
      "commit",
      "-q",
      "--allow-empty",
      "-m",
      "chore: seed",
      "-m",
      "Verified: none - empty seed commit",
    );
    const amendNoEdit = "git commit --amend --no-edit";
    expect(await runGate({ state, mode: "enforce", cwd: repo, command: amendNoEdit })).toBe(
      undefined,
    );
    git("commit", "-q", "--allow-empty", "-m", "chore: second");
    expectDenied(await runGate({ state, mode: "enforce", cwd: repo, command: amendNoEdit }));
    expect(
      await runGate({
        state,
        mode: "enforce",
        cwd: repo,
        command: `git commit --amend -m "chore: second" -m "Verified: git log"`,
      }),
    ).toBe(undefined);
  });

  // omp blocks the call when a handler throws, so an internal error must allow the command instead.
  it("an internal error allows the command and prints nothing", async () => {
    const state = tempFolder("error");
    const cwd = tempFolder("error-cwd");
    // A -F file that does not exist makes the message read fail.
    const missingFile = await captureOutput(() =>
      runGate({ state, mode: "enforce", cwd, command: "git commit -F missing.txt" }),
    );
    expect(missingFile.result).toBe(undefined);
    expect(missingFile.printed).toStrictEqual([]);
    // A state folder below a regular file cannot be made, so the log write fails.
    const blocker = path.join(state, "not-a-folder");
    fs.writeFileSync(blocker, "");
    for (const mode of ["observe", "enforce"]) {
      const unwritable = await captureOutput(() =>
        runGate({ state: blocker, mode, cwd, command: UNVERIFIED }),
      );
      expect(unwritable.result, mode).toBe(undefined);
      expect(unwritable.printed, mode).toStrictEqual([]);
    }
    expect(logLines(state).length).toBe(0);
  });

  it("-F /dev/stdin and -F /dev/fd/0 read the heredoc of the command, not the stdin of omp", async () => {
    const state = tempFolder("dev-stdin");
    for (const name of ["/dev/stdin", "/dev/fd/0"]) {
      const heredoc = (body: string): string =>
        [`git commit -F ${name} <<'EOF'`, "fix: x", "", body, "EOF"].join("\n");
      expect(
        await runGate({ state, mode: "enforce", command: heredoc("Verified: bun test") }),
        name,
      ).toBe(undefined);
      expectDenied(
        await runGate({ state, mode: "enforce", command: heredoc("Body only."), session: name }),
      );
    }
  });

  it("a -F path that is not a regular file allows the command at once and prints nothing", async (context) => {
    context.skip(process.platform === "win32", FIFO_SKIP);
    const state = tempFolder("fifo");
    const cwd = tempFolder("fifo-cwd");
    const fifo = path.join(cwd, "message.fifo");
    execFileSync("mkfifo", [fifo]);
    releaseFifoAfterCase(fifo);
    for (const command of ["git commit -F message.fifo", "git commit --file=."]) {
      const started = Date.now();
      const { result, printed } = await captureOutput(() =>
        runGate({ state, mode: "enforce", cwd, command }),
      );
      expect(result, command).toBe(undefined);
      expect(printed, command).toStrictEqual([]);
      expect(Date.now() - started < 3000, `${command} took ${Date.now() - started} ms`).toBe(true);
    }
    expect(fs.existsSync(path.join(state, "docks"))).toBe(false);
  });

  it("a check that runs past its deadline rejects, stops its git calls, and writes no state", async (context) => {
    context.skip(process.platform === "win32", GIT_SCRIPT_SKIP);
    const state = tempFolder("deadline");
    const bin = tempFolder("deadline-bin");
    const finished = path.join(bin, "finished.txt");
    // Each git call takes 400 ms, so each call is quick, but three commits take longer than the deadline.
    fs.writeFileSync(
      path.join(bin, "git"),
      `#!/bin/sh\nsleep 0.4\necho done >> '${finished}'\nexec '${REAL_GIT}' "$@"\n`,
      { mode: 0o755 },
    );
    const checkCommand = await coreCheckCommand();
    const command = [VERIFIED, VERIFIED, UNVERIFIED].join(" && ");
    const started = Date.now();
    await withEnv({ PATH: `${bin}${path.delimiter}${process.env["PATH"]}` }, () =>
      expect(
        checkCommand({
          command,
          cwd: state,
          sessionId: "s1",
          env: { XDG_STATE_HOME: state, DOCKS_VERIFY_GATE: "enforce" },
          deadlineMs: 1000,
        }),
      ).rejects.toThrow(/the check ran longer than 1000 ms/u),
    );
    expect(Date.now() - started < 1300, `the check rejected after ${Date.now() - started} ms`).toBe(
      true,
    );
    // The third git call ends after the deadline unless the deadline stops it, and then it would count a denial.
    // A real wait: the fake git is another process, so only the wall clock lets its third call end.
    await new Promise((resolve) => setTimeout(resolve, 800));
    expect(fs.readFileSync(finished, "utf8")).toBe("done\ndone\n");
    expect(fs.existsSync(path.join(state, "docks"))).toBe(false);
  });

  it("a denial update whose write stalls holds the next update until it settles, and neither check writes state", async () => {
    const state = tempFolder("state-deadline");
    const docks = path.join(state, "docks");
    const denials = path.join(docks, "verify-gate-denials.json");
    fs.mkdirSync(docks, { recursive: true });
    // Two denials of s1 make the next commit the allowed third one, which resets the count and appends a log line.
    fs.writeFileSync(denials, JSON.stringify({ s1: { count: 2, time: Date.now() } }));
    const { writes, held, release } = watchDenialWrites(state, { hold: true });
    const checkCommand = await coreCheckCommand();
    const check = (deadlineMs: number): Promise<string | null> =>
      checkCommand({
        command: "git commit",
        cwd: state,
        sessionId: "s1",
        env: { XDG_STATE_HOME: state, DOCKS_VERIFY_GATE: "enforce" },
        deadlineMs,
      });
    // The first check passes its deadline during its write. The second check waits in the chain after it.
    const first = check(300);
    const second = check(600);
    await held;
    await expect(first).rejects.toThrow(/the check ran longer than 300 ms/u);
    await expect(second).rejects.toThrow(/the check ran longer than 600 ms/u);
    expect(writes.names.length, "the second update must not start while the first one writes").toBe(
      1,
    );
    // The held write ends now, after both deadlines. The third check waits in the chain until the first update settles.
    release();
    expect(await check(5000), "two denials stay recorded, so the third commit is allowed").toBe(
      null,
    );
    expect(readDenials(denials)["s1"]?.count).toBe(0);
    expect(logLines(state).map((line) => line.allowed_after_denials)).toStrictEqual([2]);
    expect(fs.readdirSync(docks).sort()).toStrictEqual([
      "verify-gate-denials.json",
      "verify-gate.jsonl",
    ]);
    expect(writes.maxActive).toBe(1);
    expect(new Set(writes.names).size, "each update must write its own temporary file").toBe(2);
  });

  it("a denial file that is not a regular file allows the command in enforce mode at once", async (context) => {
    context.skip(process.platform === "win32", FIFO_SKIP);
    const state = tempFolder("denial-fifo");
    const denials = path.join(state, "docks", "verify-gate-denials.json");
    fs.mkdirSync(path.dirname(denials), { recursive: true });
    execFileSync("mkfifo", [denials]);
    releaseFifoAfterCase(denials);
    const started = Date.now();
    const { result, printed } = await captureOutput(() =>
      runGate({ state, mode: "enforce", command: UNVERIFIED }),
    );
    expect(result).toBe(undefined);
    expect(printed).toStrictEqual([]);
    expect(Date.now() - started < 3000, `the check took ${Date.now() - started} ms`).toBe(true);
    expect(fs.lstatSync(denials).isFIFO(), "the check must not replace the FIFO").toBe(true);
    expect(logLines(state)).toStrictEqual([]);
  });

  it("two checks of one session at the same time count two denials, each through its own temporary file", async () => {
    const state = tempFolder("concurrent");
    const { writes } = watchDenialWrites(state);
    const handler = await toolCallHandler();
    // `git commit` without a message source starts no git call, so both checks reach the denial state at once.
    const event = {
      type: "tool_call",
      toolName: "bash",
      toolCallId: "call_1",
      input: { command: "git commit" },
    };
    const ctx = sessionContext(state, "s1");
    const results = await withEnv({ XDG_STATE_HOME: state, DOCKS_VERIFY_GATE: "enforce" }, () =>
      Promise.all([handler(event, ctx), handler(event, ctx)]),
    );
    for (const result of results) expectDenied(result);
    const saved = readDenials(path.join(state, "docks", "verify-gate-denials.json"));
    expect(saved["s1"]?.count).toBe(2);
    // After the two denials, the third commit is allowed.
    expect(await runGate({ state, mode: "enforce", command: "git commit", handler })).toBe(
      undefined,
    );
    expect(writes.maxActive, "two denial updates must not overlap").toBe(1);
    expect(
      new Set(writes.names).size,
      "two updates must never use the same temporary file name",
    ).toBe(3);
  });

  it("a denial count older than seven days expires, and the denial file drops it", async () => {
    const state = tempFolder("expiry");
    const denials = path.join(state, "docks", "verify-gate-denials.json");
    fs.mkdirSync(path.dirname(denials), { recursive: true });
    const day = 24 * 60 * 60 * 1000;
    const now = Date.now();
    fs.writeFileSync(
      denials,
      JSON.stringify({
        s1: { count: 2, time: now - 8 * day },
        old: { count: 1, time: now - 8 * day },
        recent: { count: 1, time: now - 6 * day },
      }),
    );
    // Two denials of s1 would allow this commit, but they expired, so this is the first denial of a new count.
    expectDenied(await runGate({ state, mode: "enforce", command: UNVERIFIED }));
    const saved = readDenials(denials);
    expect(Object.keys(saved).sort()).toStrictEqual(["recent", "s1"]);
    expect(saved["s1"]?.count).toBe(1);
    expect(saved["recent"]).toStrictEqual({ count: 1, time: now - 6 * day });
    if (POSIX_MODES) expect(fs.statSync(denials).mode & 0o777).toBe(0o600);
  });

  it("a denial file that is not valid JSON counts as empty", async () => {
    const state = tempFolder("corrupt");
    const denials = path.join(state, "docks", "verify-gate-denials.json");
    fs.mkdirSync(path.dirname(denials), { recursive: true });
    fs.writeFileSync(denials, "{not json");
    expectDenied(await runGate({ state, mode: "enforce", command: UNVERIFIED }));
    expect(Object.keys(readDenials(denials))).toStrictEqual(["s1"]);
  });

  it('a denial count that is not a number reads as a number: "1" counts as 1, "x" and null count as 0, and the file then holds a number', async () => {
    const state = tempFolder("count-type");
    const denials = path.join(state, "docks", "verify-gate-denials.json");
    fs.mkdirSync(path.dirname(denials), { recursive: true });
    const now = Date.now();
    fs.writeFileSync(
      denials,
      JSON.stringify({
        one: { count: "1", time: now },
        x: { count: "x", time: now },
        empty: { count: null, time: now },
      }),
    );
    const checkCommand = await coreCheckCommand();
    const check = (sessionId: string): Promise<string | null> =>
      checkCommand({
        command: UNVERIFIED,
        cwd: state,
        sessionId,
        env: { XDG_STATE_HOME: state, DOCKS_VERIFY_GATE: "enforce" },
      });
    const savedCount = (sessionId: string): unknown => readDenials(denials)[sessionId]?.count;
    // "1" is one earlier denial: this commit is the second denial, and the next commit is allowed.
    expect(await check("one")).toBe(DENY_REASON);
    expect(savedCount("one")).toBe(2);
    expect(await check("one")).toBe(null);
    expect(savedCount("one")).toBe(0);
    // "x" and null are no earlier denial: this commit is the first denial.
    for (const session of ["x", "empty"]) {
      expect(await check(session), session).toBe(DENY_REASON);
      expect(savedCount(session), session).toBe(1);
    }
    expect(await check("x")).toBe(DENY_REASON);
    expect(savedCount("x")).toBe(2);
    expect(await check("x")).toBe(null);
    expect(savedCount("x")).toBe(0);
    expect(logLines(state).map((line) => line.allowed_after_denials)).toStrictEqual([2, 2]);
  });

  it("the Verified key has any case, and an empty value or an empty none reason does not count", async () => {
    const state = tempFolder("trailer-rules");
    const gate = (trailer: string, session: string): Promise<GateResult> =>
      runGate({
        state,
        mode: "enforce",
        command: `git commit -m "fix: x" -m "${trailer}"`,
        session,
      });
    for (const trailer of ["verified: bun test", "VERIFIED: none - docs only"]) {
      expect(await gate(trailer, "s1"), trailer).toBe(undefined);
    }
    for (const trailer of ["Verified:", "Verified:   ", "Verified: none - ", "Verified: none -"]) {
      expectDenied(await gate(trailer, trailer));
    }
  });

  it("-C <rev> and --amend read the message of that commit, and the log names their source", async () => {
    const state = tempFolder("reuse");
    const repo = gitRepo("reuse-repo");
    for (const command of [
      "git commit -C HEAD~1",
      "git commit --reuse-message=HEAD~1",
      "git commit -c HEAD~1",
    ]) {
      expect(await runGate({ state, mode: "enforce", cwd: repo, command }), command).toBe(
        undefined,
      );
    }
    expectDenied(
      await runGate({ state, mode: "enforce", cwd: repo, command: "git commit -C HEAD" }),
    );
    await runGate({ state, mode: "observe", cwd: repo, command: "git commit -C HEAD" });
    await runGate({ state, mode: "observe", cwd: repo, command: "git commit --amend --no-edit" });
    expect(logLines(state).map((line) => line.message_sources)).toStrictEqual([
      ["-C"],
      ["--amend"],
    ]);
  });

  it("the log names the sources of the first commit without the trailer", async () => {
    const state = tempFolder("first-unverified");
    const command = `${VERIFIED} && git commit -m "fix: a" && git commit -F - <<EOF\nfix: b\nEOF`;
    expect(await runGate({ state, mode: "observe", command })).toBe(undefined);
    expect(logLines(state).map((line) => line.message_sources)).toStrictEqual([["-m"]]);
  });

  it("the shell parser follows cd and git -C, skips an environment prefix, and sees a git path", async () => {
    const state = tempFolder("parser");
    const cwd = tempFolder("parser-cwd");
    fs.mkdirSync(path.join(cwd, "sub"));
    // The same file name holds no trailer in the start folder and a trailer in sub.
    fs.writeFileSync(path.join(cwd, "message.txt"), "fix: x\n\nBody only.\n");
    fs.writeFileSync(path.join(cwd, "sub", "message.txt"), "fix: x\n\nVerified: bun test\n");
    for (const command of [
      "cd sub && git commit -F message.txt",
      "git -C sub commit -F message.txt",
    ]) {
      expect(await runGate({ state, mode: "enforce", cwd, command }), command).toBe(undefined);
    }
    const unverified = [
      'FOO=1 git commit -m "fix: x"',
      '/usr/bin/git commit -m "fix: x"',
      // `-S` takes the rest of the word as its key, so the `F` is no -F option.
      'git commit -SFkey -m "fix: x"',
    ];
    for (const command of unverified) {
      expectDenied(await runGate({ state, mode: "enforce", cwd, command, session: command }));
    }
  });
});
