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

import { replaceFile } from "../../src/engine-native/atomicWrite";

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
