import { chmodSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";

import { cleanup, runEngine } from "../lib/goldenExecution";
import { cleanupTemporaryDirs, makeStubDir, materializeVariant } from "../lib/goldenResources";

afterAll(cleanupTemporaryDirs);

const POSIX = process.platform !== "win32";

describe("sync claude file writes", () => {
  it.skipIf(!POSIX)("keeps owner-only modes on rewritten Claude JSON files", () => {
    const home = materializeVariant("home-fresh", {
      ".claude/settings.json": '{"userOnly":true}\n',
      ".claude.json": '{"userOnly":true}\n',
    });
    chmodSync(join(home, ".claude", "settings.json"), 0o600);
    chmodSync(join(home, ".claude.json"), 0o600);
    const run = runEngine(["sync", "claude"], home, makeStubDir(), { reuseHome: home });
    try {
      expect(run.exitCode, run.output).toBe(0);
      expect(run.output).toContain("Settings merged");
      expect(run.output).toContain("~/.claude.json updated");
      expect(statSync(join(home, ".claude", "settings.json")).mode & 0o777).toBe(0o600);
      expect(statSync(join(home, ".claude.json")).mode & 0o777).toBe(0o600);
    } finally {
      cleanup([run]);
    }
  });

  it.skipIf(!POSIX)("creates a missing ~/.claude.json with owner-only mode", () => {
    const run = runEngine(["sync", "claude"], "home-fresh", makeStubDir());
    try {
      expect(run.exitCode, run.output).toBe(0);
      expect(statSync(join(run.home, ".claude.json")).mode & 0o777).toBe(0o600);
    } finally {
      cleanup([run]);
    }
  });

  it("backs up a different ~/.claude/CLAUDE.md before it deploys the SoT copy", () => {
    const run = runEngine(["sync", "claude"], "home-drift", makeStubDir());
    try {
      expect(readFileSync(join(run.home, ".claude", "CLAUDE.md.bak"), "utf8")).toBe(
        "# old deployed CLAUDE.md\n",
      );
      expect(run.output).toContain("CLAUDE.md synced (backup at CLAUDE.md.bak)");
    } finally {
      cleanup([run]);
    }
  });
});
