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
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const faults = vi.hoisted(() => ({
  /**
   * While set, each `writeFileSync` on a path that starts with this prefix
   * writes half of the data and then throws `EIO`, as an interrupted write does.
   * The prefix covers the file and its temporary siblings.
   */
  interruptWritesUnder: undefined as string | undefined,
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
});
