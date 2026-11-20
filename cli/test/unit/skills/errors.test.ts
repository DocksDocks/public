import { describe, it } from "vitest";

import { IS_ROOT, expectRun, fixture } from "../../lib/agentDocs/harness";
import { GUARD_USAGE, SKILL_USAGE } from "../../lib/skills/entry";
import {
  RECENT,
  SKILLS_HOST_SUPPORTED,
  bodyLines,
  expectFileError,
  expectRuntimeRun,
  failed,
  passed,
  run,
  runWords,
  runtimeStderr,
  scoreLine,
  skillText,
} from "../../lib/skills/harness";
import { SPAWN_TIMEOUT_MS } from "../../lib/spawnTimeout";

// A skill that passes the validator without a warning and scores 9.
const CLEAN = skillText(
  [
    "name: probe",
    "description: Use when probing the validator.",
    "user-invocable: false",
    "metadata:",
    `  updated: "${RECENT}"`,
  ],
  bodyLines(80),
);
const CLEAN_LINES = ["== skills/probe", scoreLine(9)];

describe.skipIf(!SKILLS_HOST_SUPPORTED)("skill usage errors", { timeout: SPAWN_TIMEOUT_MS }, () => {
  it("guard without a skill folder prints the guard usage line and exits 2", () => {
    const fx = fixture({ git: false });
    expectRun(run("guard", [], fx), 2, [], `${GUARD_USAGE}\n`);
    expectRun(run("guard", ["--strict"], fx), 2, [], `${GUARD_USAGE}\n`);
  });

  it("no command and an unknown command print the usage line and exit 2", () => {
    const fx = fixture({ git: false });
    expectRun(runWords([], fx), 2, [], `${SKILL_USAGE}\n`);
    expectRun(runWords(["check"], fx), 2, [], `${SKILL_USAGE}\n`);
  });
});

// Decision 1a (1) of DocksDocks/public#205: a file error that the script does not catch.
describe.skipIf(!SKILLS_HOST_SUPPORTED)("skill file errors", { timeout: SPAWN_TIMEOUT_MS }, () => {
  it("score of a missing root", () => {
    const fx = fixture({ git: false });
    const message = "ENOENT: no such file or directory, scandir 'missing'";
    expectFileError(run("score", ["missing"], fx), [], message);
    expectFileError(run("score", ["--per-file", "missing"], fx), [], message);
  });

  it("score of a root that is a file", () => {
    const fx = fixture({ git: false, files: { "notes.txt": "notes\n" } });
    expectFileError(
      run("score", ["notes.txt"], fx),
      [],
      "ENOTDIR: not a directory, scandir 'notes.txt'",
    );
  });

  it("score of a root with a dangling symlink prints the rows before it", () => {
    const fx = fixture({
      git: false,
      files: { "skills/probe/SKILL.md": CLEAN },
      links: { "skills/zed": "gone" },
    });
    expectFileError(
      run("score", ["--per-file", "skills"], fx),
      ["probe 9"],
      "ENOENT: no such file or directory, stat 'skills/zed'",
    );
  });

  it("a SKILL.md that is a folder: score and guard of the skill folder fail; a guard walk does not see it", () => {
    const fx = fixture({ git: false, dirs: ["skills/probe/SKILL.md"] });
    const message = "EISDIR: illegal operation on a directory, read 'skills/probe/SKILL.md'";
    expectFileError(run("score", ["--per-file", "skills"], fx), [], message);
    expectFileError(run("guard", ["skills/probe"], fx), ["== skills/probe"], message);
    expectRun(
      run("guard", ["skills"], fx),
      1,
      [failed(1, 0, 0)],
      "FAIL: no SKILL.md found under skills\n",
    );
  });

  it.skipIf(IS_ROOT)("score of an unreadable root", () => {
    const fx = fixture({
      git: false,
      files: { "skills/probe/SKILL.md": CLEAN },
      modes: { skills: 0 },
    });
    expectFileError(
      run("score", ["skills"], fx),
      [],
      "EACCES: permission denied, scandir 'skills'",
    );
  });

  it.skipIf(IS_ROOT)("an unreadable SKILL.md in score and guard", () => {
    const fx = fixture({
      git: false,
      files: { "skills/alpha/SKILL.md": CLEAN, "skills/probe/SKILL.md": CLEAN },
      modes: { "skills/probe/SKILL.md": 0 },
    });
    const message = "EACCES: permission denied, open 'skills/probe/SKILL.md'";
    expectFileError(run("score", ["--per-file", "skills"], fx), ["alpha 9"], message);
    expectFileError(run("guard", ["skills/probe"], fx), ["== skills/probe"], message);
  });

  it.skipIf(IS_ROOT)("an unreadable references/ folder in guard", () => {
    const fx = fixture({
      git: false,
      files: { "skills/probe/SKILL.md": CLEAN, "skills/probe/references/a.md": "# a\n" },
      modes: { "skills/probe/references": 0 },
    });
    expectFileError(
      run("guard", ["skills/probe"], fx),
      ["== skills/probe"],
      "EACCES: permission denied, scandir 'skills/probe/references'",
    );
  });
});

// The guard walk catches a read error and skips that folder (the script's findSkillFiles).
describe.skipIf(!SKILLS_HOST_SUPPORTED)("skill guard walk", { timeout: SPAWN_TIMEOUT_MS }, () => {
  it.skipIf(IS_ROOT)("skips an unreadable folder below the root", () => {
    const fx = fixture({
      git: false,
      files: { "skills/probe/SKILL.md": CLEAN, "skills/locked/inner/SKILL.md": CLEAN },
      modes: { "skills/locked": 0 },
    });
    expectRun(run("guard", ["skills"], fx), 0, [...CLEAN_LINES, passed(1, 0)]);
  });

  it.skipIf(IS_ROOT)("an unreadable root holds no skill", () => {
    const fx = fixture({
      git: false,
      files: { "skills/probe/SKILL.md": CLEAN },
      modes: { skills: 0 },
    });
    expectRun(
      run("guard", ["skills"], fx),
      1,
      [failed(1, 0, 0)],
      "FAIL: no SKILL.md found under skills\n",
    );
  });
});

// Decision 1a (2): the runtime's own stderr for an invalid package.json in the working folder or a parent folder. Bun
// writes it when its event loop reaches it, so the cases check that it occurs once and pin no order.
describe.skipIf(!SKILLS_HOST_SUPPORTED)(
  "skill runtime stderr",
  { timeout: SPAWN_TIMEOUT_MS },
  () => {
    it("an invalid package.json in the working folder", () => {
      const fx = fixture({
        git: false,
        files: { "package.json": "{ no json\n", "skills/probe/SKILL.md": CLEAN },
      });
      const runtime = runtimeStderr(fx);
      expectRuntimeRun(run("score", ["--per-file", "skills"], fx), 0, ["probe 9"], runtime);
      expectRuntimeRun(run("guard", ["skills"], fx), 0, [...CLEAN_LINES, passed(1, 0)], runtime);
    });

    it("an invalid package.json in a parent folder", () => {
      const fx = fixture({
        git: false,
        files: { "package.json": "{ no json\n", "work/skills/probe/SKILL.md": CLEAN },
      });
      const runtime = runtimeStderr(fx, "work");
      expectRuntimeRun(run("score", ["skills"], fx, "work"), 0, ["9"], runtime);
      expectRuntimeRun(
        run("guard", ["skills/missing"], fx, "work"),
        1,
        [failed(1, 0, 0)],
        runtime,
        "FAIL: not a directory: skills/missing\n",
      );
    });
  },
);
