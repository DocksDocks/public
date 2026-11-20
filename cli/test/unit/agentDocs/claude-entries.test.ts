import { symlinkSync } from "node:fs";
import { basename, join } from "node:path";
import { describe, it } from "vitest";

import {
  AGENT_DOCS_HOST_SUPPORTED,
  BASE,
  BASE_FILES,
  C3_ALONE,
  C3_CLAUDE_FOLDER,
  C3_LINK,
  C3_NEXT_TO,
  C4,
  C4_EXTERNAL,
  C4_OTHER,
  type Fixture,
  IS_ROOT,
  NO_PLUGIN,
  ROOT_AGENTS,
  STALE,
  TEST_SKILL,
  audit,
  expectRun,
  fixture,
  routed,
  run,
} from "../../lib/agentDocs/harness";
import { SPAWN_TIMEOUT_MS } from "../../lib/spawnTimeout";

const PR_FILE = "pull-request template: .github/pull_request_template.md (file)";
const C2_UNROUTED = (node: string): string => `FAIL C2 node not routed from root: ${node}`;

/** The detect lines of a fixture with the base files: `lines` sit between the Step 0 head and tail. */
const baseDetect = (fx: Fixture, ...lines: ReadonlyArray<string>): Array<string> => [
  fx.dir,
  "root AGENTS.md: present",
  ".agents/skills: present",
  ...lines,
  PR_FILE,
  "verify skill: present",
];

/** The audit lines: the presence lines of `present`, then `lines`, then the plugin line. */
const auditLines = (
  present: ReadonlyArray<string>,
  ...lines: ReadonlyArray<string>
): Array<string> => [...audit(...present), ...lines, NO_PLUGIN];

describe.skipIf(!AGENT_DOCS_HOST_SUPPORTED)(
  ".claude entries and root context files in detect, check, and audit",
  { timeout: SPAWN_TIMEOUT_MS },
  () => {
    it("a .claude, .claude/skills, or .claude/agents link to a place outside the repository is reported with its target as read and nothing below it", () => {
      const outside = fixture({
        git: false,
        files: {
          "CLAUDE.md": "rules\n",
          "skills/x/SKILL.md": TEST_SKILL,
          "agents/rev.md": "# Rev\n",
          "settings.json": "{}\n",
          "commands/deploy.md": "# Deploy\n",
        },
      });
      const whole = fixture({ ...BASE, links: { ".claude": outside.dir } });
      const external = `legacy external: .claude -> ${outside.dir}`;
      expectRun(run("agent-first", ["detect"], whole), 0, baseDetect(whole, external));
      expectRun(run("agent-first", ["check"], whole), 0, [C4_EXTERNAL(".claude")]);
      expectRun(
        run("bridge-check", ["audit"], whole),
        0,
        auditLines(["AGENTS.md", ".claude/CLAUDE.md"], external),
      );

      const agentsTarget = `../../${basename(outside.dir)}/agents`;
      const parts = fixture({
        ...BASE,
        files: { ...BASE_FILES, ".claude/settings.json": "{}\n" },
        links: { ".claude/skills": join(outside.dir, "skills"), ".claude/agents": agentsTarget },
      });
      const partsLines = [
        `legacy external: .claude/skills -> ${join(outside.dir, "skills")}`,
        `legacy external: .claude/agents -> ${agentsTarget}`,
        "legacy settings: .claude/settings.json",
      ];
      expectRun(run("agent-first", ["detect"], parts), 0, baseDetect(parts, ...partsLines));
      expectRun(run("agent-first", ["check"], parts), 0, [
        C4_EXTERNAL(".claude/skills"),
        C4_EXTERNAL(".claude/agents"),
        C4(".claude/settings.json"),
      ]);
      expectRun(run("bridge-check", ["audit"], parts), 0, auditLines(["AGENTS.md"], ...partsLines));

      // A link that stays inside the repository is no external entry: its entries are listed.
      const inside = fixture({
        ...BASE,
        files: { ...BASE_FILES, "claude-agents/rev.md": "# Rev\n" },
        links: { ".claude": "claude-config", "claude-config/agents": "../claude-agents" },
        dirs: ["claude-config/skills/local"],
      });
      expectRun(
        run("agent-first", ["detect"], inside),
        0,
        baseDetect(
          inside,
          "legacy skills: .claude/skills",
          "legacy agents: .claude/agents/rev.md",
          "not-a-symlink: .claude/skills/local",
        ),
      );
      expectRun(run("agent-first", ["check"], inside), 0, [
        C4(".claude/skills/local"),
        C4(".claude/agents/rev.md"),
      ]);
      expectRun(
        run("bridge-check", ["audit"], inside),
        0,
        auditLines(
          ["AGENTS.md"],
          "legacy skills: .claude/skills",
          "legacy agents: .claude/agents/rev.md",
        ),
      );
    });

    it("each other .claude entry, dot names too, is a legacy other entry that is only reported", () => {
      const fx = fixture({
        ...BASE,
        files: {
          ...BASE_FILES,
          ".claude/commands/deploy.md": "# Deploy\n",
          ".claude/.mcp.json": "{}\n",
          ".claude/settings.json": "{}\n",
        },
      });
      const lines = [
        "legacy settings: .claude/settings.json",
        "legacy other: .claude/.mcp.json",
        "legacy other: .claude/commands",
      ];
      expectRun(run("agent-first", ["detect"], fx), 0, baseDetect(fx, ...lines));
      expectRun(run("agent-first", ["check"], fx), 0, [
        C4(".claude/settings.json"),
        C4_OTHER(".claude/.mcp.json"),
        C4_OTHER(".claude/commands"),
      ]);
      expectRun(run("bridge-check", ["audit"], fx), 0, auditLines(["AGENTS.md"], ...lines));
    });

    it.skipIf(IS_ROOT)(
      "an unreadable .claude/agents prints the legacy entries ERROR line in detect and audit, and ERROR C4 in check",
      () => {
        const fx = fixture({
          ...BASE,
          files: { ...BASE_FILES, ".claude/settings.json": "{}\n" },
          dirs: [".claude/agents"],
          modes: { ".claude/agents": 0o000 },
        });
        const entries = "ERROR legacy entries: file listing failed (see the message above)";
        const cannotList =
          "agent-docs: cannot list the folder .claude/agents (EACCES); make it readable and run the check again\n";
        // Each `git ls-files` of a check warns about the folder it cannot enter.
        const gitWarning =
          "warning: could not open directory '.claude/agents/': Permission denied\n";
        expectRun(
          run("agent-first", ["detect"], fx),
          2,
          baseDetect(fx, entries),
          `${cannotList}${gitWarning.repeat(3)}`,
        );
        expectRun(
          run("agent-first", ["check"], fx),
          2,
          ["ERROR C4 file listing failed (see the message above)"],
          // Three listings run before C4 lists .claude/agents, and five after it.
          `${gitWarning.repeat(3)}${cannotList}${gitWarning.repeat(5)}`,
        );
        // The CLAUDE.local.md walk of audit enters every folder, so it cannot finish either.
        expectRun(
          run("bridge-check", ["audit"], fx),
          2,
          auditLines(
            ["AGENTS.md"],
            entries,
            "ERROR personal: file listing failed (see the message above)",
          ),
          `${cannotList}${gitWarning}${cannotList}`,
        );
      },
    );

    it("a root CLAUDE.md and .claude/CLAUDE.md count also when git ignores them; a nested ignored one does not", () => {
      const fx = fixture({
        ...BASE,
        files: {
          ...BASE_FILES,
          ".gitignore": "CLAUDE.md\n.claude/\n",
          "CLAUDE.md": "rules\n",
          ".claude/CLAUDE.md": "rules\n",
          "api/CLAUDE.md": "rules\n",
        },
      });
      const lines = ["legacy: .claude/CLAUDE.md", "legacy: CLAUDE.md"];
      expectRun(run("agent-first", ["detect"], fx), 0, baseDetect(fx, ...lines));
      expectRun(run("agent-first", ["check"], fx), 0, [
        C3_CLAUDE_FOLDER(".claude/CLAUDE.md"),
        C3_NEXT_TO("CLAUDE.md"),
      ]);
      expectRun(
        run("bridge-check", ["audit"], fx),
        0,
        auditLines(["AGENTS.md", "CLAUDE.md (root)", ".claude/CLAUDE.md"], ...lines),
      );
      expectRun(run("bridge-check", ["verify"], fx), 0, [
        "BROKEN: legacy CLAUDE.md still present: .claude/CLAUDE.md",
        "BROKEN: legacy CLAUDE.md still present: CLAUDE.md",
      ]);
    });

    it("C3 a CLAUDE.md or .claude/CLAUDE.md link to the AGENTS.md of its folder; a link to another AGENTS.md is no such link", () => {
      const fx = fixture({
        ...BASE,
        files: { ...BASE_FILES, "AGENTS.md": routed("docs/AGENTS.md"), "docs/AGENTS.md": STALE },
        links: {
          "CLAUDE.md": "AGENTS.md",
          ".claude/CLAUDE.md": "../AGENTS.md",
          "docs/CLAUDE.md": "../AGENTS.md",
        },
      });
      expectRun(
        run("agent-first", ["detect"], fx),
        0,
        baseDetect(
          fx,
          "legacy: .claude/CLAUDE.md",
          "legacy: CLAUDE.md",
          "legacy: docs/CLAUDE.md",
          "node: docs/AGENTS.md",
        ),
      );
      expectRun(run("agent-first", ["check"], fx), 0, [
        C3_LINK(".claude/CLAUDE.md"),
        C3_LINK("CLAUDE.md"),
        C3_NEXT_TO("docs/CLAUDE.md"),
      ]);
      expectRun(
        run("bridge-check", ["audit"], fx),
        0,
        auditLines(
          ["AGENTS.md", "CLAUDE.md (root)", ".claude/CLAUDE.md"],
          "legacy link: .claude/CLAUDE.md",
          "legacy link: CLAUDE.md",
          "legacy: docs/CLAUDE.md",
        ),
      );
    });

    // Removing such a CLAUDE.md would leave the AGENTS.md that links to it dangling.
    it("C3 a CLAUDE.md or .claude/CLAUDE.md that the AGENTS.md of its folder links to is no link to that AGENTS.md", () => {
      const noAgents = { ...BASE_FILES, "AGENTS.md": undefined };
      const cases: ReadonlyArray<{
        readonly files: Readonly<Record<string, string | undefined>>;
        readonly links: Readonly<Record<string, string>>;
        readonly legacy: string;
        readonly c3: (file: string) => string;
        readonly present: ReadonlyArray<string>;
      }> = [
        {
          files: { ...noAgents, "rules.md": ROOT_AGENTS },
          links: { "AGENTS.md": "CLAUDE.md", "CLAUDE.md": "rules.md" },
          legacy: "CLAUDE.md",
          c3: C3_NEXT_TO,
          present: ["AGENTS.md", "CLAUDE.md (root)"],
        },
        {
          files: { ...noAgents, "CLAUDE.md": ROOT_AGENTS },
          links: { "AGENTS.md": "CLAUDE.md" },
          legacy: "CLAUDE.md",
          c3: C3_NEXT_TO,
          present: ["AGENTS.md", "CLAUDE.md (root)"],
        },
        {
          files: { ...noAgents, "rules.md": ROOT_AGENTS },
          links: { "AGENTS.md": ".claude/CLAUDE.md", ".claude/CLAUDE.md": "../rules.md" },
          legacy: ".claude/CLAUDE.md",
          c3: C3_CLAUDE_FOLDER,
          present: ["AGENTS.md", ".claude/CLAUDE.md"],
        },
      ];
      for (const { files, links, legacy, c3, present } of cases) {
        const fx = fixture({ files, links });
        expectRun(run("agent-first", ["detect"], fx), 0, baseDetect(fx, `legacy: ${legacy}`));
        expectRun(run("agent-first", ["check"], fx), 0, [c3(legacy)]);
        expectRun(run("bridge-check", ["audit"], fx), 0, auditLines(present, `legacy: ${legacy}`));
      }
    });

    // Each hop resolves against the real folder of its link, as the kernel resolves it, not against the path as written.
    it("C3 an absolute link through a symlinked folder to the AGENTS.md of its folder is a link to it", () => {
      const fx = fixture({ ...BASE, links: { alias: "." } });
      symlinkSync(join(fx.dir, "alias", "AGENTS.md"), join(fx.dir, "CLAUDE.md"));
      expectRun(run("agent-first", ["detect"], fx), 0, baseDetect(fx, "legacy: CLAUDE.md"));
      expectRun(run("agent-first", ["check"], fx), 0, [C3_LINK("CLAUDE.md")]);
      expectRun(
        run("bridge-check", ["audit"], fx),
        0,
        auditLines(["AGENTS.md", "CLAUDE.md (root)"], "legacy link: CLAUDE.md"),
      );
    });

    // `.claude` is a symlink, so `../../AGENTS.md` of its CLAUDE.md starts at config/claude: the root AGENTS.md.
    it("C3 a .claude/CLAUDE.md in a symlinked .claude folder that reaches the root AGENTS.md is a link to it", () => {
      const fx = fixture({
        ...BASE,
        dirs: ["config/claude"],
        links: { ".claude": "config/claude", "config/claude/CLAUDE.md": "../../AGENTS.md" },
      });
      expectRun(
        run("agent-first", ["detect"], fx),
        0,
        baseDetect(fx, "legacy: .claude/CLAUDE.md", "legacy: config/claude/CLAUDE.md"),
      );
      expectRun(run("agent-first", ["check"], fx), 0, [
        C3_LINK(".claude/CLAUDE.md"),
        C3_ALONE("config/claude/CLAUDE.md"),
      ]);
      expectRun(
        run("bridge-check", ["audit"], fx),
        0,
        auditLines(
          ["AGENTS.md", ".claude/CLAUDE.md"],
          "legacy link: .claude/CLAUDE.md",
          "legacy: config/claude/CLAUDE.md",
        ),
      );
    });

    // Here `../AGENTS.md` starts at nested/sub: it reaches nested/AGENTS.md, which is not the root AGENTS.md.
    it("C3 a .claude/CLAUDE.md in a symlinked .claude folder that reaches another AGENTS.md is no link", () => {
      const fx = fixture({
        ...BASE,
        files: { ...BASE_FILES, "nested/AGENTS.md": STALE },
        links: { ".claude": "nested/sub", "nested/sub/CLAUDE.md": "../AGENTS.md" },
      });
      const lines = ["legacy: .claude/CLAUDE.md", "legacy: nested/sub/CLAUDE.md"];
      expectRun(
        run("agent-first", ["detect"], fx),
        0,
        baseDetect(fx, ...lines, "node: nested/AGENTS.md"),
      );
      expectRun(run("agent-first", ["check"], fx), 0, [
        C2_UNROUTED("nested/AGENTS.md"),
        C3_CLAUDE_FOLDER(".claude/CLAUDE.md"),
        C3_ALONE("nested/sub/CLAUDE.md"),
      ]);
      expectRun(
        run("bridge-check", ["audit"], fx),
        0,
        auditLines(["AGENTS.md", ".claude/CLAUDE.md"], ...lines),
      );
    });

    // `alias` is a symlink to nested/sub, so the kernel reads `alias/..` as nested: both links reach nested/AGENTS.md,
    // not the root AGENTS.md that a lexical `..` gives.
    it("C3 a CLAUDE.md or .claude/CLAUDE.md link through alias/.. that reaches another AGENTS.md is no link", () => {
      const fx = fixture({
        ...BASE,
        files: { ...BASE_FILES, "nested/AGENTS.md": STALE },
        dirs: ["nested/sub"],
        links: {
          alias: "nested/sub",
          "CLAUDE.md": "alias/../AGENTS.md",
          ".claude/CLAUDE.md": "../alias/../AGENTS.md",
        },
      });
      const lines = ["legacy: .claude/CLAUDE.md", "legacy: CLAUDE.md"];
      expectRun(
        run("agent-first", ["detect"], fx),
        0,
        baseDetect(fx, ...lines, "node: nested/AGENTS.md"),
      );
      expectRun(run("agent-first", ["check"], fx), 0, [
        C2_UNROUTED("nested/AGENTS.md"),
        C3_CLAUDE_FOLDER(".claude/CLAUDE.md"),
        C3_NEXT_TO("CLAUDE.md"),
      ]);
      expectRun(
        run("bridge-check", ["audit"], fx),
        0,
        auditLines(["AGENTS.md", "CLAUDE.md (root)", ".claude/CLAUDE.md"], ...lines),
      );
    });

    it("C3 a chain of two links from a CLAUDE.md to the AGENTS.md of its folder is a link to it", () => {
      const fx = fixture({ ...BASE, links: { "CLAUDE.md": "x.md", "x.md": "AGENTS.md" } });
      expectRun(run("agent-first", ["detect"], fx), 0, baseDetect(fx, "legacy: CLAUDE.md"));
      expectRun(run("agent-first", ["check"], fx), 0, [C3_LINK("CLAUDE.md")]);
      expectRun(
        run("bridge-check", ["audit"], fx),
        0,
        auditLines(["AGENTS.md", "CLAUDE.md (root)"], "legacy link: CLAUDE.md"),
      );
    });

    // A CLAUDE.md and an AGENTS.md that link to each other make a loop: the AGENTS.md is no file, so there is no link.
    it("C3 a CLAUDE.md in a loop with the AGENTS.md of its folder is no link to it", () => {
      const fx = fixture({
        ...BASE,
        files: { ...BASE_FILES, "AGENTS.md": undefined },
        links: { "CLAUDE.md": "AGENTS.md", "AGENTS.md": "CLAUDE.md" },
      });
      expectRun(run("agent-first", ["detect"], fx), 0, [
        fx.dir,
        "root AGENTS.md: missing",
        ".agents/skills: present",
        "legacy: CLAUDE.md",
        PR_FILE,
        "verify skill: present",
      ]);
      expectRun(run("bridge-check", ["audit"], fx), 0, auditLines([], "legacy: CLAUDE.md"));
      // The check cannot read the AGENTS.md (ELOOP), so it also prints ERROR lines of other checks and exits 2.
      const cannotRead = (file: string): string =>
        `agent-docs: cannot read ${file} (ELOOP); make it readable and run the check again\n`;
      expectRun(
        run("agent-first", ["check"], fx),
        2,
        [
          "FAIL C1 root AGENTS.md missing",
          `ERROR C2 cannot read ${join(fx.dir, "AGENTS.md")}`,
          C3_ALONE("CLAUDE.md"),
          "ERROR C5 cannot read AGENTS.md",
          "ERROR C7 cannot read AGENTS.md",
          "ERROR C8 cannot read AGENTS.md",
        ],
        `${cannotRead(join(fx.dir, "AGENTS.md"))}${cannotRead("AGENTS.md").repeat(4)}`,
      );
    });
  },
);
