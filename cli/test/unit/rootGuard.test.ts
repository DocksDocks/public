import { relative, resolve, sep } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Same depth as cli/test/lib, so this matches the guard's own ROOT.
const ROOT = resolve(import.meta.dirname, "..", "..", "..");

// The guard resolves porcelain paths against ROOT, which gives backslashes on
// Windows; the fixtures name files the way git prints them, with slashes.
function repoPath(path: string): string {
  return relative(ROOT, path).split(sep).join("/");
}

type GitResult = {
  status: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
  error: NodeJS.ErrnoException | undefined;
};

const state = vi.hoisted(() => ({
  // `git rev-parse --is-inside-work-tree`: git exists and ROOT is a work tree.
  repo: { status: 0, signal: null, stdout: "true\n", stderr: "", error: undefined } as GitResult,
  // `git status`: NUL-separated porcelain output, or a failure shape.
  git: { status: 0, signal: null, stdout: "", stderr: "", error: undefined } as GitResult,
  files: {} as Record<string, string>,
  names: [] as string[],
}));

// The mocks live in hoisted state so their identity survives vi.resetModules.
const mocks = vi.hoisted(() => ({
  spawnSync: vi.fn(
    (_command: string, args: ReadonlyArray<string>, _options: { readonly maxBuffer?: number }) =>
      args[0] === "rev-parse" ? { ...state.repo } : { ...state.git },
  ),
  readFileSync: vi.fn((path: string) => {
    const content = state.files[repoPath(path)];
    if (content === undefined) throw new Error(`ENOENT: ${path}`);
    return Buffer.from(content);
  }),
  readdirSync: vi.fn(() => [...state.names]),
}));

vi.mock("node:child_process", () => ({ spawnSync: mocks.spawnSync }));
vi.mock("node:fs", () => ({ readFileSync: mocks.readFileSync, readdirSync: mocks.readdirSync }));

const ORIGINAL_EXIT_CODE = process.exitCode;

async function loadGuard() {
  // The guard keeps its setup snapshot in module state, so each case reloads the
  // module; a static import would share one snapshot across cases.
  vi.resetModules();
  return import("../lib/rootGuard");
}

function gitStatus(...entries: string[]): void {
  state.git = {
    status: 0,
    signal: null,
    stdout: entries.map((entry) => `${entry}\0`).join(""),
    stderr: "",
    error: undefined,
  };
}

function spawnError(code: string): NodeJS.ErrnoException {
  return Object.assign(new Error(`spawnSync git ${code}`), { code });
}

describe("rootGuard", () => {
  beforeEach(() => {
    state.files = {};
    state.names = [];
    state.repo = { status: 0, signal: null, stdout: "true\n", stderr: "", error: undefined };
    gitStatus();
  });

  afterEach(() => {
    process.exitCode = ORIGINAL_EXIT_CODE;
    vi.clearAllMocks();
  });

  it("reports an overwrite of a file that was already dirty at setup", async () => {
    const guard = await loadGuard();
    gitStatus(" M SoT/.claude/settings.json");
    state.files["SoT/.claude/settings.json"] = '{"before":true}';
    guard.setup();

    state.files["SoT/.claude/settings.json"] = '{"overwritten":true}';
    expect(() => guard.teardown()).toThrow("modified during run: SoT/.claude/settings.json");
    expect(process.exitCode).toBe(1);
  });

  it("reports a new file inside an already-untracked directory", async () => {
    const guard = await loadGuard();
    gitStatus("?? scratch/a.txt");
    state.files["scratch/a.txt"] = "a";
    guard.setup();

    gitStatus("?? scratch/a.txt", "?? scratch/b.txt");
    state.files["scratch/b.txt"] = "b";
    expect(() => guard.teardown()).toThrow("scratch/b.txt");
    expect(process.exitCode).toBe(1);
    expect(mocks.spawnSync).toHaveBeenCalledWith(
      "git",
      expect.arrayContaining(["--untracked-files=all"]),
      expect.anything(),
    );
  });

  it("stays quiet when status and content are unchanged", async () => {
    const guard = await loadGuard();
    gitStatus(" M SoT/.claude/settings.json", "?? scratch/a.txt");
    state.files["SoT/.claude/settings.json"] = "dirty";
    state.files["scratch/a.txt"] = "a";
    guard.setup();

    expect(() => guard.teardown()).not.toThrow();
    expect(process.exitCode).toBe(ORIGINAL_EXIT_CODE);
  });

  it("fingerprints the rename target, not the origin", async () => {
    const guard = await loadGuard();
    gitStatus("R  new.txt", "old.txt");
    state.files["new.txt"] = "renamed";
    guard.setup();

    const read = mocks.readFileSync.mock.calls.map(([path]) => repoPath(path));
    expect(read).toEqual(["new.txt"]);

    state.files["new.txt"] = "edited";
    expect(() => guard.teardown()).toThrow("modified during run: new.txt");
    expect(process.exitCode).toBe(1);
  });

  it("reports a deleted tracked file", async () => {
    const guard = await loadGuard();
    guard.setup();

    gitStatus(" D cli/src/main.ts");
    expect(() => guard.teardown()).toThrow(" D cli/src/main.ts");
    expect(process.exitCode).toBe(1);
  });

  it("reports a deletion of a file that was already modified at setup", async () => {
    const guard = await loadGuard();
    gitStatus(" M SoT/.claude/settings.json");
    state.files["SoT/.claude/settings.json"] = "dirty";
    guard.setup();

    gitStatus(" D SoT/.claude/settings.json");
    delete state.files["SoT/.claude/settings.json"];
    expect(() => guard.teardown()).toThrow(
      / D SoT\/\.claude\/settings\.json\nmodified during run: SoT\/\.claude\/settings\.json/,
    );
    expect(process.exitCode).toBe(1);
  });

  it("fails the run when git status overflows its output buffer", async () => {
    const guard = await loadGuard();
    state.git = {
      status: null,
      signal: "SIGTERM",
      stdout: "",
      stderr: "",
      error: spawnError("ENOBUFS"),
    };

    expect(() => guard.setup()).toThrow(/could not read git status .*ENOBUFS/);
    expect(process.exitCode).toBe(1);
    // A silent fallback to top-level names would miss every nested change.
    expect(mocks.readdirSync).not.toHaveBeenCalled();
    const statusCall = mocks.spawnSync.mock.calls.find(([, args]) => args[0] === "status");
    expect(statusCall?.[2].maxBuffer).toBeGreaterThan(1024 * 1024);
  });

  it("fails the run when git status exits non-zero while git is present", async () => {
    const guard = await loadGuard();
    guard.setup();

    state.git = {
      status: 128,
      signal: null,
      stdout: "",
      stderr: "fatal: index file corrupt\n",
      error: undefined,
    };
    expect(() => guard.teardown()).toThrow("exit code 128: fatal: index file corrupt");
    expect(process.exitCode).toBe(1);
    expect(mocks.readdirSync).not.toHaveBeenCalled();
  });

  it.each<[string, GitResult]>([
    [
      "git is not installed",
      { status: null, signal: null, stdout: "", stderr: "", error: spawnError("ENOENT") },
    ],
    [
      "the checkout is not a git work tree",
      {
        status: 128,
        signal: null,
        stdout: "",
        stderr: "fatal: not a git repository (or any of the parent directories): .git\n",
        error: undefined,
      },
    ],
  ])("falls back to top-level names when %s", async (_label, failure) => {
    const guard = await loadGuard();
    state.repo = failure;
    state.names = ["cli", "package.json"];
    guard.setup();

    expect(() => guard.teardown()).not.toThrow();
    expect(process.exitCode).toBe(ORIGINAL_EXIT_CODE);
    expect(mocks.spawnSync.mock.calls.some(([, args]) => args[0] === "status")).toBe(false);

    state.names = ["cli", "package.json", "stray.txt"];
    let message = "";
    try {
      guard.teardown();
    } catch (error) {
      message = String(error);
    }
    expect(message).toContain("stray.txt");
    expect(message).not.toContain("package.json");
    expect(process.exitCode).toBe(1);
  });
});
