import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { cliEntry } from "../lib/cliEntry";
import { SPAWN_TIMEOUT_MS } from "../lib/spawnTimeout";

const CLI = cliEntry();
const home = mkdtempSync(join(tmpdir(), "workflow-removal-"));
const env = { ...process.env, HOME: home, AGENTS_DIR: join(home, ".agents") };
afterAll(() => rmSync(home, { recursive: true, force: true }));

describe("removed workflow configuration surface", () => {
  it(
    "rejects the former workflow model selector with a usable tool list",
    () => {
      const result = spawnSync("bun", [CLI, "models", "workflow"], {
        encoding: "utf8",
        env,
        timeout: SPAWN_TIMEOUT_MS,
      });
      expect(result.status).toBe(2);
      expect(result.stderr).toContain("Unknown tool 'workflow' (valid: claude, codex, omp)");
    },
    SPAWN_TIMEOUT_MS,
  );

  it(
    "rejects retired root overrides before creating prompt files",
    () => {
      for (const flag of [
        "--model-orchestrator=claude:fable@high",
        "--model-reviewer=codex:gpt-5.6-sol@high",
        "--model-implementer=codex:gpt-5.6-sol@high",
        "--review-min-score=80",
        "--review-max-rounds=2",
      ]) {
        const result = spawnSync("bun", [CLI, flag], {
          encoding: "utf8",
          env,
          timeout: SPAWN_TIMEOUT_MS,
        });
        expect(result.status, flag).toBe(2);
        expect(result.stderr, flag).toContain(`unknown flag ${flag}`);
        expect(existsSync(join(home, ".claude", "CLAUDE.md")), flag).toBe(false);
        expect(existsSync(join(home, ".codex", "AGENTS.md")), flag).toBe(false);
      }
    },
    SPAWN_TIMEOUT_MS,
  );

  it(
    "rejects the former native workflow command without writing prompt files",
    () => {
      const result = spawnSync("bun", [CLI, "workflow"], {
        encoding: "utf8",
        env: { ...env, DOCKS_KIT_ENGINE: "native-raw" },
        timeout: SPAWN_TIMEOUT_MS,
      });
      expect(result.status).toBe(2);
      expect(`${result.stdout}\n${result.stderr}`).toContain("Unknown arg: workflow");
      expect(existsSync(join(home, ".claude", "CLAUDE.md"))).toBe(false);
      expect(existsSync(join(home, ".codex", "AGENTS.md"))).toBe(false);
    },
    SPAWN_TIMEOUT_MS,
  );

  it(
    "omits former workflow override flags from root help",
    () => {
      const result = spawnSync("bun", [CLI, "--help"], {
        encoding: "utf8",
        env,
        timeout: SPAWN_TIMEOUT_MS,
      });
      expect(result.status).toBe(0);
      expect(result.stdout).not.toMatch(
        /--(?:model-orchestrator|model-reviewer|model-implementer|review-min-score|review-max-rounds)\b/,
      );
    },
    SPAWN_TIMEOUT_MS,
  );
});
