import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  statSync,
  symlinkSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  allowedRemovalRoots,
  createScratchDir,
  removeTemporaryPath,
} from "../../src/engine-native/scratch";

const sandboxes: Array<string> = [];

/** A sandbox with a scratch root, a temporary root, an outside directory, and a home. */
function sandbox() {
  const base = realpathSync(mkdtempSync(join(tmpdir(), "scratch-test-")));
  sandboxes.push(base);
  const layout = {
    base,
    scratch: join(base, "scratch"),
    tmp: join(base, "tmp"),
    outside: join(base, "outside"),
    home: join(base, "home"),
  };
  // A root that group or others can write is not trusted, so the mode must not
  // depend on the umask of the test run.
  for (const directory of [layout.scratch, layout.tmp, layout.outside, layout.home]) {
    mkdirSync(directory);
    chmodSync(directory, 0o755);
  }
  const roots = allowedRemovalRoots({
    home: layout.home,
    scratch: layout.scratch,
    tmp: layout.tmp,
    platform: "win32",
  });
  return { ...layout, roots };
}

afterEach(() => {
  for (const base of sandboxes.splice(0)) rmSync(base, { recursive: true, force: true });
});

describe("createScratchDir", () => {
  it("creates a private labelled directory inside the root", () => {
    const { scratch } = sandbox();
    const created = createScratchDir(scratch, "eval");
    expect(created.startsWith(join(scratch, "eval-"))).toBe(true);
    expect(statSync(created).isDirectory()).toBe(true);
    if (process.platform !== "win32") {
      expect(statSync(created).mode & 0o777).toBe(0o700);
      expect(statSync(scratch).mode & 0o777).toBe(0o700);
    }
  });

  it.each(["", "../x", "a/b", ".hidden", "a".repeat(65)])("rejects the label %j", (label) => {
    const { scratch } = sandbox();
    expect(() => createScratchDir(scratch, label)).toThrow(/label must match/);
  });
});

describe("removeTemporaryPath", () => {
  it("removes a nested tree inside a root", () => {
    const { scratch, roots, home } = sandbox();
    const tree = join(scratch, "eval-1");
    mkdirSync(join(tree, "a", "b"), { recursive: true });
    expect(removeTemporaryPath(tree, roots, home)).toEqual({ kind: "removed", path: tree });
    expect(existsSync(tree)).toBe(false);
  });

  it("refuses a root itself, a path outside the roots, and a missing path", () => {
    const { scratch, tmp, outside, roots, home } = sandbox();
    const outsideReason =
      "is outside the scratch root, the system temporary directory, and /var/tmp";
    expect(removeTemporaryPath(scratch, roots, home)).toMatchObject({ reason: outsideReason });
    expect(removeTemporaryPath(tmp, roots, home)).toMatchObject({ reason: outsideReason });
    expect(removeTemporaryPath(outside, roots, home)).toMatchObject({ reason: outsideReason });
    expect(removeTemporaryPath(join(scratch, "missing"), roots, home)).toMatchObject({
      kind: "refused",
      reason: "does not exist",
    });
    expect(existsSync(scratch) && existsSync(tmp) && existsSync(outside)).toBe(true);
  });

  it("drops a root that contains the home directory", () => {
    const { scratch, tmp } = sandbox();
    const home = join(tmp, "home");
    mkdirSync(join(home, "work"), { recursive: true });
    const roots = allowedRemovalRoots({ home, scratch, tmp, platform: "win32" });
    expect(roots).toEqual([scratch]);
    expect(removeTemporaryPath(join(home, "work"), roots, home)).toMatchObject({
      kind: "refused",
    });
    expect(existsSync(join(home, "work"))).toBe(true);
  });

  it.skipIf(process.platform === "win32")("refuses a symbolic link and a link escape", () => {
    const { scratch, outside, roots, home } = sandbox();
    const link = join(scratch, "escape");
    symlinkSync(outside, link);
    expect(removeTemporaryPath(link, roots, home)).toMatchObject({
      kind: "refused",
      reason: "is a symbolic link",
    });
    expect(removeTemporaryPath(`${link}/`, roots, home)).toMatchObject({
      kind: "refused",
      reason: "is a symbolic link",
    });
    mkdirSync(join(outside, "child"));
    expect(removeTemporaryPath(join(link, "child"), roots, home)).toMatchObject({
      kind: "refused",
    });
    expect(existsSync(join(outside, "child"))).toBe(true);
  });

  it.skipIf(process.platform === "win32")(
    "refuses a trailing-separator link whose target is inside a root",
    () => {
      const { scratch, roots, home } = sandbox();
      const real = join(scratch, "real");
      mkdirSync(join(real, "data"), { recursive: true });
      symlinkSync(real, join(scratch, "alias"));
      expect(removeTemporaryPath(`${join(scratch, "alias")}//`, roots, home)).toMatchObject({
        kind: "refused",
        reason: "is a symbolic link",
      });
      expect(existsSync(join(real, "data"))).toBe(true);
    },
  );

  it("refuses a root that lies inside another root", () => {
    const { scratch, tmp, home } = sandbox();
    const inner = join(scratch, "inner-tmp");
    mkdirSync(inner);
    chmodSync(inner, 0o755);
    const roots = allowedRemovalRoots({ home, scratch, tmp: inner, platform: "win32" });
    expect(roots).toEqual([scratch, inner]);
    expect(removeTemporaryPath(inner, roots, home)).toMatchObject({ kind: "refused" });
    expect(existsSync(inner)).toBe(true);
    expect(existsSync(tmp)).toBe(true);
  });

  it.skipIf(process.platform === "win32")(
    "refuses a target below a directory that others can write without the sticky bit",
    () => {
      const { scratch, roots, home } = sandbox();
      const shared = join(scratch, "shared");
      mkdirSync(join(shared, "mine"), { recursive: true });
      chmodSync(shared, 0o777);
      expect(removeTemporaryPath(join(shared, "mine"), roots, home)).toEqual({
        kind: "refused",
        path: join(shared, "mine"),
        reason: `has a parent directory that another user can change: ${shared}`,
      });
      expect(existsSync(join(shared, "mine"))).toBe(true);

      // A sticky directory protects an entry that the user owns.
      chmodSync(shared, 0o1777);
      expect(removeTemporaryPath(join(shared, "mine"), roots, home)).toMatchObject({
        kind: "removed",
      });
    },
  );

  it.skipIf(process.platform === "win32")(
    "drops a root that others can write without the sticky bit",
    () => {
      const { scratch, tmp, home } = sandbox();
      chmodSync(tmp, 0o777);
      expect(allowedRemovalRoots({ home, scratch, tmp, platform: "win32" })).toEqual([scratch]);
      chmodSync(tmp, 0o1777);
      expect(allowedRemovalRoots({ home, scratch, tmp, platform: "win32" })).toEqual([
        scratch,
        tmp,
      ]);
    },
  );
});
