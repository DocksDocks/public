import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "vitest";

import {
  AGENT_DOCS_HOST_SUPPORTED,
  BASE,
  BASE_FILES,
  C10_ERROR,
  C3_NEXT_TO,
  C9_NO_SKILL,
  IS_ROOT,
  NO_PLUGIN,
  ROOT_AGENTS,
  STALE,
  audit,
  expectRun,
  fixture,
  listingFailed,
  routed,
  run,
} from "../../lib/agentDocs/harness";
import { SPAWN_TIMEOUT_MS } from "../../lib/spawnTimeout";

const LISTING_CHECKS = ["C2", "C3", "C5", "C6", "C7", "C8"];

// (f) the old blocks read a failed `git ls-files`, an unreadable folder, or an unreadable file as no match.
describe.skipIf(!AGENT_DOCS_HOST_SUPPORTED)(
  "failed listings and unreadable files",
  { timeout: SPAWN_TIMEOUT_MS },
  () => {
    it("a corrupt git index prints ERROR lines in agent-first and bridge-check", () => {
      const fx = fixture({ ...BASE, files: { ...BASE_FILES, "CLAUDE.md": "rules\n" } });
      writeFileSync(join(fx.dir, ".git/index"), "not an index\n");
      // Each failed `git ls-files` prints git's message and the status it stopped with.
      const corrupt =
        "fatal: .git/index: index file smaller than expected\nagent-docs: git ls-files stopped with the status 128; fix the cause and run the check again\n";
      expectRun(
        run("agent-first", ["check"], fx),
        2,
        LISTING_CHECKS.map(listingFailed),
        corrupt.repeat(6),
      );
      expectRun(
        run("agent-first", ["detect"], fx),
        2,
        [
          fx.dir,
          "root AGENTS.md: present",
          ".agents/skills: present",
          listingFailed("legacy:"),
          listingFailed("personal:"),
          listingFailed("node:"),
          "pull-request template: .github/pull_request_template.md (file)",
          "verify skill: present",
        ],
        corrupt.repeat(3),
      );
      expectRun(
        run("bridge-check", ["audit"], fx),
        2,
        [...audit("AGENTS.md", "CLAUDE.md (root)"), listingFailed("legacy:"), NO_PLUGIN],
        corrupt,
      );
      expectRun(
        run("bridge-check", ["verify"], fx),
        2,
        [listingFailed("legacy:"), listingFailed("routing:"), listingFailed("volatile:")],
        corrupt.repeat(3),
      );
    });

    it.skipIf(IS_ROOT)("a folder that cannot be listed prints ERROR lines outside git", () => {
      const fx = fixture({
        git: false,
        files: { "AGENTS.md": ROOT_AGENTS },
        dirs: ["locked"],
        modes: { locked: 0o000 },
      });
      const cannotList =
        "agent-docs: cannot list the folder locked (EACCES); make it readable and run the check again\n";
      expectRun(
        run("bridge-check", ["audit"], fx),
        2,
        [...audit("AGENTS.md"), listingFailed("legacy:"), listingFailed("personal:"), NO_PLUGIN],
        cannotList.repeat(2),
      );
      expectRun(
        run("agent-first", ["check"], fx),
        2,
        [...LISTING_CHECKS.map(listingFailed), C9_NO_SKILL, C10_ERROR],
        `${cannotList.repeat(6)}fatal: not a git repository (or any of the parent directories): .git\n`,
      );
    });

    it.skipIf(IS_ROOT)(
      "an unreadable file prints ERROR C<n> and a bridge ERROR line, except for C3",
      () => {
        const claude = fixture({
          ...BASE,
          files: { ...BASE_FILES, "CLAUDE.md": "@AGENTS.md\n" },
          modes: { "CLAUDE.md": 0o000 },
        });
        // C3 judges a CLAUDE.md by the AGENTS.md next to it, so an unreadable one still gets its FAIL line.
        expectRun(run("agent-first", ["check"], claude), 0, [C3_NEXT_TO("CLAUDE.md")]);
        const node = fixture({
          ...BASE,
          files: { ...BASE_FILES, "AGENTS.md": routed("api/AGENTS.md"), "api/AGENTS.md": STALE },
          modes: { "api/AGENTS.md": 0o000 },
        });
        const cannotRead =
          "agent-docs: cannot read api/AGENTS.md (EACCES); make it readable and run the check again\n";
        expectRun(
          run("agent-first", ["check"], node),
          2,
          [
            "ERROR C5 cannot read api/AGENTS.md",
            "ERROR C7 cannot read api/AGENTS.md",
            "ERROR C8 cannot read api/AGENTS.md",
          ],
          cannotRead.repeat(4),
        );
        expectRun(
          run("bridge-check", ["verify"], node),
          2,
          ["ERROR volatile: cannot read api/AGENTS.md"],
          cannotRead,
        );
      },
    );

    it("a non-ASCII node is routed and read", () => {
      const fx = fixture({
        ...BASE,
        files: { ...BASE_FILES, "AGENTS.md": routed("é/AGENTS.md"), "é/AGENTS.md": STALE },
      });
      // (f) git quoted the path, so the old block printed a false `FAIL C2` and `FINDING C5` line for it.
      expectRun(run("agent-first", ["check"], fx), 0, []);
      expectRun(run("bridge-check", ["verify"], fx), 0, []);
    });
  },
);
