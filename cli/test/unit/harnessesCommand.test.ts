import { existsSync } from "node:fs";
import { afterAll, describe, expect, it } from "vitest";
import { writeHarnessSelection } from "../../src/engine-native/harnesses";
import { kitDbFile } from "../../src/engine-native/kitDb";
import { runPublicCli } from "../lib/goldenExecution";
import { cleanupTemporaryDirs, makeStubDir, temporaryDir } from "../lib/goldenResources";
import { SPAWN_TIMEOUT_MS } from "../lib/spawnTimeout";

afterAll(cleanupTemporaryDirs);

describe("harnesses command", () => {
  it(
    "reports the legacy default without creating selection state",
    () => {
      const run = runPublicCli(["harnesses"], "home-fresh", makeStubDir());

      expect(run.exitCode).toBe(0);
      expect(run.stderr).toBe("");
      expect(run.stdout).toBe(
        "Harness selection: claude, codex, agents (no selection is stored yet; the legacy default applies)\n",
      );
      expect(existsSync(kitDbFile(run.home))).toBe(false);
    },
    SPAWN_TIMEOUT_MS,
  );

  it(
    "reports an omp-only stored selection exactly",
    () => {
      const home = temporaryDir("harnesses-command-home-");
      writeHarnessSelection(home, ["omp"]);

      const run = runPublicCli(["harnesses"], "home-fresh", makeStubDir(), { reuseHome: home });

      expect(run.exitCode).toBe(0);
      expect(run.stderr).toBe("");
      expect(run.stdout).toBe("Harness selection: omp\n");
    },
    SPAWN_TIMEOUT_MS,
  );
});
