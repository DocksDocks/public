import { spawnSync } from "node:child_process";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import config from "../../../scripts/pluginContent/config.json" with { type: "json" };
import {
  checkContentHashes,
  hashSkill,
  writeContentHashes,
} from "../../../scripts/pluginContent/contentHash.ts";

/**
 * The docks skill content hash (`scripts/skills/content-hash.mjs` and
 * `tests/idempotency.mjs`), ported to the kit plugin skills.
 */
const REPO_ROOT = resolve(import.meta.dirname, "..", "..", "..", "..");
const LIVE_SKILLS = join(REPO_ROOT, config.pluginDir, "skills");
const SCRIPT = join(REPO_ROOT, "cli", "scripts", "skill-content-hash.ts");
const HASH = /^[0-9a-f]{64}$/;

const fixtures: Array<string> = [];

afterEach(() => {
  for (const root of fixtures.splice(0)) rmSync(root, { recursive: true, force: true });
});

/** A temporary copy of the live skills folder. */
function copySkills(): string {
  const root = mkdtempSync(join(tmpdir(), "kit-plugin-hash-"));
  fixtures.push(root);
  const skills = join(root, "skills");
  cpSync(LIVE_SKILLS, skills, { recursive: true });
  return skills;
}

function edit(file: string, change: (text: string) => string): void {
  const before = readFileSync(file, "utf8");
  const after = change(before);
  expect(after, `the planted change did not change ${file}`).not.toBe(before);
  writeFileSync(file, after);
}

const runScript = (...args: ReadonlyArray<string>) =>
  spawnSync("bun", [SCRIPT, ...args], { cwd: REPO_ROOT, encoding: "utf8" });

describe("kit plugin skill content hash", () => {
  it("matches the stored hash of each live skill", () => {
    expect(checkContentHashes(LIVE_SKILLS)).toEqual([]);
  });

  it("gives the same hash for the same tree twice", () => {
    const dir = join(LIVE_SKILLS, "accessibility");
    const first = hashSkill(dir);
    expect(first).toMatch(HASH);
    expect(hashSkill(dir)).toBe(first);
    const skills = copySkills();
    expect(hashSkill(join(skills, "accessibility"))).toBe(first);
  });

  it("ignores the updated and content_hash lines", () => {
    const skills = copySkills();
    const file = join(skills, "accessibility", "SKILL.md");
    const before = hashSkill(join(skills, "accessibility"));
    edit(file, (text) =>
      text
        .replace(/updated: "[^"]*"/, 'updated: "2000-01-01"')
        .replace(/content_hash: "[^"]*"/, `content_hash: "${"0".repeat(64)}"`),
    );
    expect(hashSkill(join(skills, "accessibility"))).toBe(before);
  });

  it("finds a changed body, refreshes it, and then finds nothing", () => {
    const skills = copySkills();
    const file = join(skills, "accessibility", "SKILL.md");
    edit(file, (text) => text.replace("# ", "# Changed "));
    expect(checkContentHashes(skills)).toEqual([
      { name: "accessibility", reason: "content changed" },
    ]);
    expect(writeContentHashes(skills, "2030-05-06")).toEqual(["accessibility"]);
    const written = readFileSync(file, "utf8");
    expect(written).toContain('  updated: "2030-05-06"');
    expect(written).toContain(`  content_hash: "${hashSkill(join(skills, "accessibility"))}"`);
    expect(checkContentHashes(skills)).toEqual([]);
    expect(writeContentHashes(skills, "2030-05-07")).toEqual([]);
  });

  it("finds a skill without a stored hash", () => {
    const skills = copySkills();
    edit(join(skills, "accessibility", "SKILL.md"), (text) =>
      text.replace(/^ {2}content_hash: .*\n/m, ""),
    );
    expect(checkContentHashes(skills)).toEqual([
      { name: "accessibility", reason: "no content_hash" },
    ]);
  });

  it("skips an upstream skill", () => {
    const skills = copySkills();
    edit(join(skills, "accessibility", "SKILL.md"), (text) =>
      text.replace("user-invocable: false", "user-invocable: false\nupstream:\n  repo: x"),
    );
    expect(checkContentHashes(skills)).toEqual([]);
  });
});

describe("skill-content-hash script", () => {
  it("checks the live skills by default", () => {
    const result = runScript("--check");
    expect(result.stderr).toBe("");
    expect(result.status).toBe(0);
  });

  it("fails --check on a stale skill, refreshes it with --write, and then passes", () => {
    const skills = copySkills();
    edit(join(skills, "zoom-out", "SKILL.md"), (text) => text.replace("# ", "# Changed "));
    const stale = runScript("--check", "--root", skills);
    expect(stale.status).toBe(1);
    expect(stale.stderr).toContain("zoom-out (content changed)");
    const write = runScript("--write", "--root", skills);
    expect(write.status).toBe(0);
    expect(write.stdout).toContain("wrote zoom-out");
    const fresh = runScript("--check", "--root", skills);
    expect(fresh.stderr).toBe("");
    expect(fresh.status).toBe(0);
  });

  it("exits 2 on a bad argument or a missing root", () => {
    expect(runScript().status).toBe(2);
    expect(runScript("--check", "--write").status).toBe(2);
    expect(runScript("--check", "--root", join(tmpdir(), "kit-plugin-hash-none")).status).toBe(2);
  });
});
