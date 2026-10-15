import { relative, resolve, sep } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Same depth as cli/test/lib, so this matches the guard's own ROOT.
const ROOT = resolve(import.meta.dirname, "..", "..", "..");

// The guard resolves porcelain paths against ROOT, which gives backslashes on
// Windows; the fixtures name files the way git prints them, with slashes.
function repoPath(path: string): string {
  return relative(ROOT, path).split(sep).join("/");
}

const state = vi.hoisted(() => ({
  // NUL-separated porcelain output, or a failure shape when git is unusable.
  git: { status: 0 as number | null, stdout: "", error: undefined as Error | undefined },
  files: {} as Record<string, string>,
  names: [] as string[],
}));

// The mocks live in hoisted state so their identity survives vi.resetModules.
const mocks = vi.hoisted(() => ({
  spawnSync: vi.fn(() => ({ ...state.git })),
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
    stdout: entries.map((entry) => `${entry}\0`).join(""),
    error: undefined,
  };
}

describe("rootGuard", () => {
  beforeEach(() => {
    state.files = {};
    state.names = [];
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

  it.each([
    ["spawn error", { status: null, stdout: "", error: new Error("spawn git ENOENT") }],
    ["status 128", { status: 128, stdout: "", error: undefined }],
  ])("falls back to top-level names when git fails (%s)", async (_label, failure) => {
    const guard = await loadGuard();
    state.git = failure;
    state.names = ["cli", "package.json"];
    guard.setup();

    expect(() => guard.teardown()).not.toThrow();
    expect(process.exitCode).toBe(ORIGINAL_EXIT_CODE);

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
