import { existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  AGENT_DOCS_HOST_SUPPORTED,
  IS_ROOT,
  MARKED_SKILL,
  MARKS,
  VERIFY_SKILL,
  expectRun,
  expectUsage,
  fixture,
  run,
} from "../../lib/agentDocs/harness";
import { SPAWN_TIMEOUT_MS } from "../../lib/spawnTimeout";

describe.skipIf(!AGENT_DOCS_HOST_SUPPORTED)(
  "verify-skill detect",
  { timeout: SPAWN_TIMEOUT_MS },
  () => {
    it("a present skill prints no link line, also when .claude/skills links to .agents/skills", () => {
      const own = fixture({ files: { ".agents/skills/verify/SKILL.md": VERIFY_SKILL } });
      expectRun(run("verify-skill", ["detect"], own), 0, ["verify skill: present"]);
      const linkedFolder = fixture({
        files: { ".agents/skills/verify/SKILL.md": VERIFY_SKILL },
        links: { ".claude/skills": "../.agents/skills" },
      });
      expectRun(run("verify-skill", ["detect"], linkedFolder), 0, ["verify skill: present"]);
    });

    it("one line per not observed mark", () => {
      const fx = fixture({ files: { ".agents/skills/verify/SKILL.md": MARKED_SKILL } });
      expectRun(run("verify-skill", ["detect"], fx), 0, [
        "verify skill: present",
        ...MARKS.map((m) => `verify unverified: ${m}`),
      ]);
    });

    it("a skill under .claude/skills is no verify skill", () => {
      const folder = fixture({ files: { ".claude/skills/verify/SKILL.md": VERIFY_SKILL } });
      expectRun(run("verify-skill", ["detect"], folder), 0, ["verify skill: missing"]);
    });

    it("no skill", () => {
      expectRun(run("verify-skill", ["detect"], fixture()), 0, ["verify skill: missing"]);
    });

    it.skipIf(IS_ROOT)("an unreadable skill prints the ERROR line", () => {
      const fx = fixture({
        files: { ".agents/skills/verify/SKILL.md": VERIFY_SKILL },
        modes: { ".agents/skills/verify/SKILL.md": 0o000 },
      });
      // (b) the old block printed the same lines and exited 0.
      expectRun(
        run("verify-skill", ["detect"], fx),
        2,
        [
          "verify skill: present",
          "ERROR verify skill check failed: cannot read .agents/skills/verify/SKILL.md",
        ],
        "verify-skill: cannot read .agents/skills/verify/SKILL.md (EACCES); make it readable and run detect again\n",
      );
    });
  },
);

describe.skipIf(!AGENT_DOCS_HOST_SUPPORTED)(
  "verify-skill write-gate",
  { timeout: SPAWN_TIMEOUT_MS },
  () => {
    it("refuses a symlink and a path outside the repository, and accepts the rest", () => {
      const fx = fixture({
        files: { "real.md": "real\n" },
        links: { "link.md": "real.md", out: "..", ".claude/skills": "../.agents/skills" },
        dirs: [".agents/skills"],
      });
      const paths = [
        "link.md",
        "out/new.md",
        ".agents/skills/verify/SKILL.md",
        ".claude/skills/verify",
        "new/deep/file.md",
        "real.md",
      ];
      expectRun(run("verify-skill", ["write-gate", ...paths], fx), 0, [
        "target occupied: link.md is a symlink",
        "target occupied: out/new.md resolves outside the repository",
      ]);
      expectRun(
        run(
          "verify-skill",
          ["write-gate", ".agents/skills/verify/SKILL.md", ".claude/skills/verify"],
          fx,
        ),
        0,
        [],
      );
      expectUsage(run("verify-skill", ["write-gate"], fx), "verify-skill");
    });

    it.skipIf(IS_ROOT)("refuses a path whose nearest folder cannot be entered", () => {
      const fx = fixture({ dirs: ["locked"], modes: { locked: 0o000 } });
      expectRun(run("verify-skill", ["write-gate", "locked/new.md"], fx), 0, [
        "target occupied: cannot resolve the folder of locked/new.md",
      ]);
    });

    it("refuses a path with a .. segment, also through a symlink or a missing folder", () => {
      const fx = fixture({ links: { link: ".." } });
      expectRun(run("verify-skill", ["write-gate", "link/../x", "missing/../../x"], fx), 0, [
        "target occupied: link/../x holds a .. segment",
        "target occupied: missing/../../x holds a .. segment",
      ]);
    });
  },
);

describe.skipIf(!AGENT_DOCS_HOST_SUPPORTED)(
  "verify-skill entry-gate",
  { timeout: SPAWN_TIMEOUT_MS },
  () => {
    it("names .agents/skills/verify when an entry is there, a dangling link included, and no .claude entry; an unknown command is a usage error", () => {
      const fx = fixture({
        dirs: [".agents/skills/verify"],
        links: { ".claude/skills/verify": "../../.agents/skills/verify" },
      });
      expectRun(run("verify-skill", ["entry-gate"], fx), 0, [
        "target occupied: .agents/skills/verify exists",
      ]);
      const dangling = fixture({ links: { ".agents/skills/verify": "../../gone" } });
      expectRun(run("verify-skill", ["entry-gate"], dangling), 0, [
        "target occupied: .agents/skills/verify exists",
      ]);
      expectRun(run("verify-skill", ["entry-gate"], fixture()), 0, []);
      expectUsage(run("verify-skill", ["bogus"], fx), "verify-skill");
    });
  },
);

describe.skipIf(!AGENT_DOCS_HOST_SUPPORTED)(
  "verify-skill link",
  { timeout: SPAWN_TIMEOUT_MS },
  () => {
    it("is a usage error that names no link command and creates no .claude entry", () => {
      const fx = fixture({ files: { ".agents/skills/verify/SKILL.md": VERIFY_SKILL } });
      const result = run("verify-skill", ["link"], fx);
      expectUsage(result, "verify-skill");
      expect(result.stderr).not.toMatch(/\blink\b/u);
      expect(existsSync(join(fx.dir, ".claude"))).toBe(false);
    });
  },
);
