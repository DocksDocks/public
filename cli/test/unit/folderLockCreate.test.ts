/**
 * Folder creation under the folder locks (plan #164, D2). A folder lock
 * creates its missing folder after the locks of its ancestors. Each folder
 * that it creates gets mode 0700, as the omp pipeline gives the parents of its
 * folders. An existing folder keeps its mode.
 */
import { chmodSync, mkdirSync, mkdtempSync, realpathSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { withHomeAndFolderLocks } from "../../src/engine-native/syncDispatch";

const POSIX = process.platform !== "win32";
const roots: Array<string> = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("folders under the folder locks", () => {
  it("creates a missing folder and its parents with mode 0700 and keeps the mode of an existing parent", async () => {
    const root = realpathSync.native(mkdtempSync(join(tmpdir(), "folder-lock-create-")));
    roots.push(root);
    const parent = join(root, "shared");
    mkdirSync(parent);
    chmodSync(parent, 0o755);
    const folder = join(parent, "omp", "agent");
    const errors: Array<string> = [];

    const code = await withHomeAndFolderLocks(
      root,
      [folder],
      (line) => errors.push(line),
      async () => 0,
    );

    expect(code).toBe(0);
    expect(errors).toEqual([]);
    expect(statSync(folder).isDirectory()).toBe(true);
    if (POSIX) {
      expect(statSync(join(parent, "omp")).mode & 0o777).toBe(0o700);
      expect(statSync(folder).mode & 0o777).toBe(0o700);
      expect(statSync(parent).mode & 0o777).toBe(0o755);
    }
  });
});
