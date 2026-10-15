import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { replaceFile } from "../../src/engine-native/atomicWrite";

const windows = process.platform === "win32";
let sandbox = "";

describe("replaceFile", () => {
  beforeEach(() => {
    sandbox = mkdtempSync(join(tmpdir(), "docks-replace-file-"));
  });

  afterEach(() => {
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
    expect(existsSync(`${real}.tmp`)).toBe(false);
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
    expect(existsSync(`${file}.tmp`)).toBe(false);
  });
});
