import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import {
  chmodSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import type * as FsModule from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const faults = vi.hoisted(() => ({
  /**
   * While set, each `writeFileSync` on a path that starts with this prefix
   * writes half of the data and then throws `EIO`, as an interrupted write does.
   * The prefix covers the file and its temporary siblings.
   */
  interruptWritesUnder: undefined as string | undefined,
  /** While set, `renameSync` throws an error with this code and renames nothing. */
  renameErrorCode: undefined as string | undefined,
  /** While set, `unlinkSync` throws an error with this code and removes nothing. */
  unlinkErrorCode: undefined as string | undefined,
}));

vi.mock("node:fs", async () => {
  const actual = await vi.importActual<typeof FsModule>("node:fs");
  return {
    ...actual,
    writeFileSync: (
      file: FsModule.PathOrFileDescriptor,
      data: string | NodeJS.ArrayBufferView,
      options?: FsModule.WriteFileOptions,
    ) => {
      const prefix = faults.interruptWritesUnder;
      if (
        prefix === undefined ||
        typeof file === "number" ||
        !resolve(String(file)).startsWith(resolve(prefix))
      ) {
        actual.writeFileSync(file, data, options);
        return;
      }
      const bytes =
        typeof data === "string"
          ? Buffer.from(data)
          : Buffer.from(data.buffer, data.byteOffset, data.byteLength);
      actual.writeFileSync(file, bytes.subarray(0, bytes.length >> 1), options);
      throw Object.assign(new Error(`EIO: injected fault, writeFileSync '${String(file)}'`), {
        code: "EIO",
      });
    },
    renameSync: (from: FsModule.PathLike, to: FsModule.PathLike) => {
      const code = faults.renameErrorCode;
      if (code === undefined) {
        actual.renameSync(from, to);
        return;
      }
      throw Object.assign(new Error(`${code}: injected fault, rename '${String(from)}'`), {
        code,
        syscall: "rename",
      });
    },
    unlinkSync: (path: FsModule.PathLike) => {
      const code = faults.unlinkErrorCode;
      if (code === undefined) {
        actual.unlinkSync(path);
        return;
      }
      throw Object.assign(new Error(`${code}: injected fault, unlink '${String(path)}'`), {
        code,
        syscall: "unlink",
      });
    },
  };
});

import { replaceFile, replaceTextIfChanged } from "../../src/engine-native/atomicWrite";

const windows = process.platform === "win32";
let sandbox = "";

describe("replaceFile", () => {
  beforeEach(() => {
    sandbox = mkdtempSync(join(tmpdir(), "docks-replace-file-"));
  });

  afterEach(() => {
    faults.interruptWritesUnder = undefined;
    faults.renameErrorCode = undefined;
    faults.unlinkErrorCode = undefined;
    rmSync(sandbox, { recursive: true, force: true });
  });

  it.skipIf(windows)("replaces the file a symlink names and keeps the link", () => {
    const real = join(sandbox, "dotfiles-config.yml");
    const link = join(sandbox, "config.yml");
    writeFileSync(real, "old\n");
    symlinkSync(real, link);

    replaceFile(link, "new\n");

    expect(lstatSync(link).isSymbolicLink()).toBe(true);
    expect(readFileSync(real, "utf8")).toBe("new\n");
    // No temporary sibling is left.
    expect(readdirSync(sandbox).sort()).toEqual(["config.yml", "dotfiles-config.yml"]);
  });

  it.skipIf(windows)("creates the file a dangling symlink names", () => {
    const real = join(sandbox, "dotfiles-models.yml");
    const link = join(sandbox, "models.yml");
    symlinkSync(real, link);

    replaceFile(link, "a: 1\n");

    expect(lstatSync(link).isSymbolicLink()).toBe(true);
    expect(readFileSync(real, "utf8")).toBe("a: 1\n");
  });

  it.skipIf(windows)("keeps the permission bits of the replaced file", () => {
    const file = join(sandbox, "settings.json");
    writeFileSync(file, "{}");
    chmodSync(file, 0o600);

    replaceFile(file, '{"a":1}');

    expect(statSync(file).mode & 0o777).toBe(0o600);
    expect(readFileSync(file, "utf8")).toBe('{"a":1}');
  });

  it.skipIf(windows)("applies the caller's mode over the existing bits", () => {
    const file = join(sandbox, "models.yml");
    writeFileSync(file, "a: 1\n");
    chmodSync(file, 0o644);

    replaceFile(file, "a: 2\n", { mode: 0o600 });

    expect(statSync(file).mode & 0o777).toBe(0o600);
  });

  it("creates a missing file", () => {
    const file = join(sandbox, "new.json");

    replaceFile(file, "{}");

    expect(readFileSync(file, "utf8")).toBe("{}");
    // No temporary sibling is left.
    expect(readdirSync(sandbox)).toEqual(["new.json"]);
  });

  it("replaces a file when a stale temporary sibling exists", () => {
    const file = join(sandbox, "settings.json");
    writeFileSync(file, "{}");
    // A directory left at the old fixed temporary name.
    mkdirSync(`${file}.tmp`);

    replaceFile(file, '{"a":1}');

    expect(readFileSync(file, "utf8")).toBe('{"a":1}');
  });

  it("leaves no temporary sibling when the write fails", () => {
    const file = join(sandbox, "settings.json");
    writeFileSync(file, '{"a":1}');

    faults.interruptWritesUnder = file;
    expect(() => replaceFile(file, '{"a":2,"b":3}')).toThrow(/^EIO/);

    expect(readdirSync(sandbox)).toEqual(["settings.json"]);
    expect(readFileSync(file, "utf8")).toBe('{"a":1}');
  });

  it.skipIf(windows)("replaces a symlinked file whose target has a long name", () => {
    // 250 characters: the name plus `.<pid>.<16 hex>.tmp` exceeds the 255-byte limit.
    const real = join(sandbox, `${"a".repeat(245)}.json`);
    const link = join(sandbox, "settings.json");
    writeFileSync(real, "{}");
    symlinkSync(real, link);

    replaceFile(link, '{"a":1}');

    expect(lstatSync(link).isSymbolicLink()).toBe(true);
    expect(readFileSync(real, "utf8")).toBe('{"a":1}');
    // No temporary sibling is left.
    expect(readdirSync(sandbox).sort()).toEqual([basename(real), "settings.json"].sort());
  });

  it("throws the rename error when the cleanup also fails", () => {
    const file = join(sandbox, "settings.json");
    writeFileSync(file, '{"a":1}');

    faults.renameErrorCode = "EPERM";
    faults.unlinkErrorCode = "EBUSY";
    expect(() => replaceFile(file, '{"a":2}')).toThrow(/^EPERM: injected fault, rename /);

    expect(readFileSync(file, "utf8")).toBe('{"a":1}');
  });

  it("leaves no temporary sibling when the rename fails", () => {
    // A directory at the target path makes the rename fail.
    const file = join(sandbox, "settings.json");
    mkdirSync(file);

    expect(() => replaceFile(file, '{"a":1}')).toThrow();

    expect(readdirSync(sandbox)).toEqual(["settings.json"]);
    expect(statSync(file).isDirectory()).toBe(true);
  });
});

/**
 * D-F: a write that a killed process left keeps its temporary sibling. The
 * next write of the same target removes that sibling when its writer exited.
 * Long name: `<target>.<pid>.<16 hex>.tmp`. Short name, when the long name
 * passes 255 bytes: `.<tag>.<pid>.<16 hex>.tmp`, where `tag` is the first 16
 * hex of sha256(basename(target)). `replaceFile` removes them after a
 * successful rename; `replaceTextIfChanged` also removes them when the target
 * already holds the wanted bytes.
 */
describe("replaceFile temporary files of a killed write", () => {
  const liveProcesses: Array<ChildProcess> = [];

  beforeEach(() => {
    sandbox = mkdtempSync(join(tmpdir(), "docks-replace-file-stale-"));
  });

  afterEach(() => {
    faults.renameErrorCode = undefined;
    faults.unlinkErrorCode = undefined;
    for (const child of liveProcesses.splice(0)) child.kill();
    rmSync(sandbox, { recursive: true, force: true });
  });

  /** The PID of a process that ran and exited, so `process.kill(pid, 0)` throws ESRCH. */
  function exitedPid(): number {
    const { pid } = spawnSync(process.execPath, ["-e", ""]);
    if (pid === undefined || pid < 1) throw new Error("the exited child gave no PID");
    return pid;
  }

  /** The PID of another process that waits on its open stdin until the test ends. */
  function livePid(): number {
    const child = spawn(process.execPath, ["-e", "process.stdin.resume()"], {
      stdio: ["pipe", "ignore", "ignore"],
    });
    liveProcesses.push(child);
    if (child.pid === undefined) throw new Error("the live child gave no PID");
    return child.pid;
  }

  const unique = (): string => randomBytes(8).toString("hex");
  /** The first 16 hex of sha256 of the target's base name. */
  const nameTag = (name: string): string =>
    createHash("sha256").update(name).digest("hex").slice(0, 16);
  /** Writes a regular file at `name` in the sandbox and returns `name`. */
  function leftover(name: string): string {
    writeFileSync(join(sandbox, name), "partial");
    return name;
  }

  it("removes the temporary file of a dead writer after a changed write", () => {
    const file = join(sandbox, "settings.json");
    writeFileSync(file, "{}");
    leftover(`settings.json.${exitedPid()}.${unique()}.tmp`);

    replaceFile(file, '{"a":1}');

    expect(readFileSync(file, "utf8")).toBe('{"a":1}');
    expect(readdirSync(sandbox)).toEqual(["settings.json"]);
  });

  it("removes the temporary file of a dead writer on the no-change path of replaceTextIfChanged", () => {
    const file = join(sandbox, "settings.json");
    writeFileSync(file, '{"a":1}');
    leftover(`settings.json.${exitedPid()}.${unique()}.tmp`);

    expect(replaceTextIfChanged(file, '{"a":1}')).toBe(false);

    expect(readFileSync(file, "utf8")).toBe('{"a":1}');
    expect(readdirSync(sandbox)).toEqual(["settings.json"]);
  });

  // A 250-byte name in the temporary folder can pass the Windows MAX_PATH limit.
  it.skipIf(windows)("removes the short-named temporary file of a dead writer", () => {
    const name = `${"a".repeat(245)}.json`;
    const file = join(sandbox, name);
    writeFileSync(file, "{}");
    leftover(`.${nameTag(name)}.${exitedPid()}.${unique()}.tmp`);

    replaceFile(file, '{"a":1}');

    expect(readFileSync(file, "utf8")).toBe('{"a":1}');
    expect(readdirSync(sandbox)).toEqual([name]);
  });

  it.skipIf(windows)("puts the PID in the short temporary name", () => {
    const name = `${"a".repeat(245)}.json`;
    const file = join(sandbox, name);
    writeFileSync(file, "{}");
    // A failed rename and a failed cleanup keep the temporary file, as a killed write does.
    faults.renameErrorCode = "EPERM";
    faults.unlinkErrorCode = "EBUSY";

    expect(() => replaceFile(file, '{"a":1}')).toThrow(/^EPERM: injected fault, rename /);

    const temporaries = readdirSync(sandbox).filter((entry) => entry !== name);
    expect(temporaries).toHaveLength(1);
    expect(temporaries[0]).toMatch(
      new RegExp(`^\\.${nameTag(name)}\\.${process.pid}\\.[0-9a-f]{16}\\.tmp$`),
    );
  });

  it("keeps the temporary file of a live writer", () => {
    const file = join(sandbox, "settings.json");
    writeFileSync(file, "{}");
    const kept = [
      leftover(`settings.json.${process.pid}.${unique()}.tmp`),
      leftover(`settings.json.${livePid()}.${unique()}.tmp`),
    ];
    leftover(`settings.json.${exitedPid()}.${unique()}.tmp`);

    replaceFile(file, '{"a":1}');

    expect(readdirSync(sandbox).sort()).toEqual(["settings.json", ...kept].sort());
  });

  it("keeps the temporary file of another target", () => {
    const file = join(sandbox, "settings.json");
    writeFileSync(file, "{}");
    const dead = exitedPid();
    const kept = [
      leftover(`config.json.${dead}.${unique()}.tmp`),
      // The name parses from the right, so its target is `settings.json.bak`.
      leftover(`settings.json.bak.${dead}.${unique()}.tmp`),
      leftover(`.${nameTag("config.json")}.${dead}.${unique()}.tmp`),
    ];
    leftover(`settings.json.${dead}.${unique()}.tmp`);

    replaceFile(file, '{"a":1}');

    expect(readdirSync(sandbox).sort()).toEqual(["settings.json", ...kept].sort());
  });

  it("keeps a directory or a symlink at the temporary name of a dead writer", () => {
    const file = join(sandbox, "settings.json");
    writeFileSync(file, "{}");
    const dead = exitedPid();
    const directory = `settings.json.${dead}.${unique()}.tmp`;
    mkdirSync(join(sandbox, directory));
    writeFileSync(join(sandbox, directory, "inside"), "keep");
    const kept = [directory];
    if (!windows) {
      const link = `settings.json.${dead}.${unique()}.tmp`;
      writeFileSync(join(sandbox, "link-target"), "keep");
      symlinkSync(join(sandbox, "link-target"), join(sandbox, link));
      kept.push(link, "link-target");
    }
    leftover(`settings.json.${dead}.${unique()}.tmp`);

    replaceFile(file, '{"a":1}');

    expect(readdirSync(sandbox).sort()).toEqual(["settings.json", ...kept].sort());
    expect(readFileSync(join(sandbox, directory, "inside"), "utf8")).toBe("keep");
  });

  it("keeps a file whose name only looks like a temporary name", () => {
    const file = join(sandbox, "settings.json");
    writeFileSync(file, "{}");
    const dead = exitedPid();
    const hex = unique();
    const kept = [
      leftover(`settings.json.${dead}.${hex}.tmp.bak`),
      leftover(`settings.json.${dead}.${hex.slice(1)}.tmp`),
      leftover(`settings.json.${dead}.${"g".repeat(16)}.tmp`),
      leftover(`settings.json.0.${hex}.tmp`),
      leftover(`settings.json.x${dead}.${hex}.tmp`),
      leftover(`settings.json.${hex}.tmp`),
      leftover(`settings.json${dead}.${hex}.tmp`),
      // The short name of the previous kit: no tag and no PID.
      leftover(`.${hex}.tmp`),
    ];
    leftover(`settings.json.${dead}.${unique()}.tmp`);

    replaceFile(file, '{"a":1}');

    expect(readdirSync(sandbox).sort()).toEqual(["settings.json", ...kept].sort());
  });
});
