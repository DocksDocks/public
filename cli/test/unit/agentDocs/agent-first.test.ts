import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "vitest";

import {
  AGENT_DOCS_HOST_SUPPORTED,
  BASE,
  BASE_FILES,
  C1,
  C10_ERROR,
  C10_NONE,
  C3_ALONE,
  C3_CLAUDE_FOLDER,
  C3_LINK,
  C3_NEXT_TO,
  C3_PERSONAL,
  C4,
  C9_NO_SKILL,
  IS_ROOT,
  MARKED_SKILL,
  MARKS,
  NON_GIT,
  PR_ERROR,
  ROOT_AGENTS,
  STALE,
  VERIFY_SKILL,
  expectRun,
  expectUsage,
  fixture,
  routed,
  run,
  skill,
} from "../../lib/agentDocs/harness";
import { SPAWN_TIMEOUT_MS } from "../../lib/spawnTimeout";

const NOT_A_REPOSITORY = "fatal: not a git repository (or any of the parent directories): .git\n";

describe.skipIf(!AGENT_DOCS_HOST_SUPPORTED)(
  "agent-first detect",
  { timeout: SPAWN_TIMEOUT_MS },
  () => {
    it("prints the Step 0 lines with the legacy skills, agents, and settings lines and no .claude/skills or verify link line, from the root and from a subfolder", () => {
      const fx = fixture({
        files: {
          "AGENTS.md": ROOT_AGENTS,
          ".gitignore": "CLAUDE.local.md\ngen/\n",
          "CLAUDE.md": "@AGENTS.md\n",
          ".claude/CLAUDE.md": "Use the review agent.\n",
          ".claude/agents/review.md": "---\nname: review\n---\n",
          ".claude/agents/locked.md": "---\nname: locked\n---\n",
          ".claude/agents/notes.txt": "not an agent\n",
          ".claude/settings.json": "{}\n",
          ".claude/settings.local.json": "{}\n",
          "CLAUDE.local.md": "my notes\n",
          "api/AGENTS.md": STALE,
          "api/CLAUDE.md": "@AGENTS.md\n",
          "gen/AGENTS.md": STALE,
          "gen/CLAUDE.md": "generated\n",
          ".agents/skills/verify/SKILL.md": VERIFY_SKILL,
          ".claude/skills/local/SKILL.md": skill("local", '"Use when testing."'),
          ".github/pull_request_template.md": "## Checklist\n",
        },
        links: { ".claude/skills/verify": "../../.agents/skills/verify" },
      });
      const lines = [
        fx.dir,
        "root AGENTS.md: present",
        ".agents/skills: present",
        "legacy skills: .claude/skills",
        "legacy agents: .claude/agents/locked.md",
        "legacy agents: .claude/agents/review.md",
        "legacy settings: .claude/settings.json",
        "legacy settings: .claude/settings.local.json",
        "legacy: .claude/CLAUDE.md",
        "legacy: CLAUDE.md",
        "legacy: api/CLAUDE.md",
        "personal: CLAUDE.local.md",
        "node: api/AGENTS.md",
        "not-a-symlink: .claude/skills/local",
        "pull-request template: .github/pull_request_template.md (file)",
        "verify skill: present",
      ];
      expectRun(run("agent-first", ["detect"], fx), 0, lines);
      expectRun(run("agent-first", ["detect"], fx, "api"), 0, lines);
    });

    it("an empty repository", () => {
      const fx = fixture();
      expectRun(run("agent-first", ["detect"], fx), 0, [
        fx.dir,
        "root AGENTS.md: missing",
        ".agents/skills: missing",
        "pull-request template: none",
        "verify skill: missing",
      ]);
    });

    it("an AGENTS.md under node_modules is no node", () => {
      const fx = fixture({
        ...BASE,
        files: { ...BASE_FILES, "node_modules/pkg/AGENTS.md": "We currently ship.\n" },
      });
      // (a) the old block also printed `node: node_modules/pkg/AGENTS.md`.
      expectRun(run("agent-first", ["detect"], fx), 0, [
        fx.dir,
        "root AGENTS.md: present",
        ".agents/skills: present",
        "pull-request template: .github/pull_request_template.md (file)",
        "verify skill: present",
      ]);
    });

    it("outside git walks the tree and prints the pull-request ERROR line", () => {
      const fx = fixture(NON_GIT);
      // (c) the find replacement of Step 0 with the agent-first-setup prune set (.git, node_modules, vendor),
      // without the `./` prefix of find; (b) exit 2 for the ERROR line.
      expectRun(
        run("agent-first", ["detect"], fx),
        2,
        [
          fx.dir,
          "root AGENTS.md: present",
          ".agents/skills: missing",
          "legacy: CLAUDE.md",
          "legacy: dist/CLAUDE.md",
          "personal: CLAUDE.local.md",
          "node: sub/AGENTS.md",
          PR_ERROR,
          "verify skill: missing",
        ],
        NOT_A_REPOSITORY,
      );
    });
  },
);

describe.skipIf(!AGENT_DOCS_HOST_SUPPORTED)(
  "agent-first check",
  { timeout: SPAWN_TIMEOUT_MS },
  () => {
    it("an agent-first repository prints nothing, also when started in a subfolder", () => {
      const fx = fixture(BASE);
      expectRun(run("agent-first", ["check"], fx), 0, []);
      expectRun(run("agent-first", ["check"], fx, ".github"), 0, []);
    });

    it("C1 a missing root AGENTS.md, and one that names no test or lint command", () => {
      expectRun(run("agent-first", ["check"], fixture()), 0, [
        "FAIL C1 root AGENTS.md missing",
        C9_NO_SKILL,
        C10_NONE,
      ]);
      const words = fixture({
        ...BASE,
        files: { ...BASE_FILES, "AGENTS.md": "# Repo\n\nRun make build.\n" },
      });
      expectRun(run("agent-first", ["check"], words), 0, [
        C1("test"),
        C1("lint"),
        "FINDING C5 no stale-tolerance line: AGENTS.md",
      ]);
      const parts = fixture({
        ...BASE,
        files: {
          ...BASE_FILES,
          "AGENTS.md": `# Repo\n\nThe builder tests each linter.\n\n${STALE}`,
        },
      });
      // `grep -w`: a kind inside a longer word names no command.
      expectRun(run("agent-first", ["check"], parts), 0, [C1("build"), C1("test"), C1("lint")]);
    });

    it("C2 an unrouted node and a dead route; @ and ./ prefixes of a row are stripped", () => {
      const fx = fixture({
        ...BASE,
        files: {
          ...BASE_FILES,
          "AGENTS.md": routed("api/AGENTS.md", "@./web/AGENTS.md", "gone/AGENTS.md"),
          "api/AGENTS.md": STALE,
          "web/AGENTS.md": STALE,
          "lib/AGENTS.md": STALE,
        },
      });
      expectRun(run("agent-first", ["check"], fx), 0, [
        "FAIL C2 node not routed from root: lib/AGENTS.md",
        "FAIL C2 dead route in root table: gone/AGENTS.md",
      ]);
    });

    it("C3 a CLAUDE.md next to an AGENTS.md and each .claude/CLAUDE.md fail, a lone CLAUDE.md and a CLAUDE.local.md are findings, and no node is hidden", () => {
      const fx = fixture({
        files: {
          ...BASE_FILES,
          "AGENTS.md": routed(
            "api/AGENTS.md",
            "docs/AGENTS.md",
            "lib/AGENTS.md",
            "pkg/AGENTS.md",
            "web/AGENTS.md",
          ),
          ".gitignore": "CLAUDE.local.md\ngen/\n",
          "CLAUDE.md": "@AGENTS.md\n",
          ".claude/CLAUDE.md": "@../AGENTS.md\n\nUse the review agent.\n",
          "CLAUDE.local.md": "my notes\n",
          "gen/CLAUDE.md": "generated\n",
          "api/AGENTS.md": STALE,
          "api/.claude/CLAUDE.md": "@../AGENTS.md\n",
          "docs/AGENTS.md": STALE,
          "docs/CLAUDE.md": "# Docs rules\n",
          "lib/AGENTS.md": STALE,
          "pkg/AGENTS.md": STALE,
          "tools/CLAUDE.md": "# Tool rules\n",
          "web/AGENTS.md": STALE,
          "web/CLAUDE.md": "@AGENTS.md\n",
        },
        links: { "pkg/CLAUDE.md": "AGENTS.md" },
      });
      expectRun(run("agent-first", ["check"], fx), 0, [
        C3_CLAUDE_FOLDER(".claude/CLAUDE.md"),
        C3_PERSONAL("CLAUDE.local.md"),
        C3_NEXT_TO("CLAUDE.md"),
        C3_CLAUDE_FOLDER("api/.claude/CLAUDE.md"),
        C3_NEXT_TO("docs/CLAUDE.md"),
        C3_LINK("pkg/CLAUDE.md"),
        C3_ALONE("tools/CLAUDE.md"),
        C3_NEXT_TO("web/CLAUDE.md"),
      ]);
    });

    it("C4 a finding for each .claude/skills entry (link or folder, broken or not), each .claude/agents/*.md file, and each settings file; dot names are skipped", () => {
      const fx = fixture({
        files: {
          ...BASE_FILES,
          ".claude/skills/local/SKILL.md": skill("local", '"Use when testing."'),
          "ext/skill/SKILL.md": skill("skill", '"Use when testing."'),
          ".claude/agents/review.md": "---\nname: review\n---\n",
          ".claude/agents/notes.txt": "not an agent\n",
          ".claude/settings.json": "{}\n",
          ".claude/settings.local.json": "{}\n",
        },
        links: {
          ".claude/skills/verify": "../../.agents/skills/verify",
          ".claude/skills/ext": "../../ext/skill",
          ".claude/skills/gone": "../../.agents/skills/gone",
        },
        dirs: [".claude/skills/.hidden"],
      });
      expectRun(run("agent-first", ["check"], fx), 0, [
        C4(".claude/skills/ext"),
        C4(".claude/skills/gone"),
        C4(".claude/skills/local"),
        C4(".claude/skills/verify"),
        C4(".claude/agents/review.md"),
        C4(".claude/settings.json"),
        C4(".claude/settings.local.json"),
      ]);
    });

    it("C5 time, count, and anchor findings outside fences, URLs, spans, and quotes; a node without the stale line", () => {
      const fx = fixture({
        ...BASE,
        files: {
          ...BASE_FILES,
          "AGENTS.md": `${routed("lib/AGENTS.md")}
We currently ship one tool.
The kit has 12 skills.
The kit has 12 skills (verify: ls .agents/skills | wc -l).
The word \`currently\` sits in a code span.
"It now has 3 files" is a quoted example.
Step 3 files are listed below.
See https://example.com/recently for news.
See src/app.ts:10 for the entry.
See \`src/app.ts:12\` in a code span.
See demo/fake.ts:3 for a fictional path.

\`\`\`text
recently 4 tests
\`\`\`
“We currently ship 3 files” in curly quotes.
`,
          "src/app.ts": "export {};\n",
          "lib/AGENTS.md": "# Lib\n",
          ".agents/skills/demo/SKILL.md": skill("demo", '"Use when demoing."'),
          ".agents/skills/demo/references/notes.md": "See ../SKILL.md:2 for the header.\n",
        },
      });
      expectRun(run("agent-first", ["check"], fx), 0, [
        "FINDING C5 line-anchor .agents/skills/demo/references/notes.md:1 (../SKILL.md exists)",
        "FINDING C5 time-relative AGENTS.md:13",
        "FINDING C5 bare-count AGENTS.md:14",
        "FINDING C5 line-anchor AGENTS.md:20 (src/app.ts exists)",
        "FINDING C5 line-anchor AGENTS.md:21 (src/app.ts exists)",
        "FINDING C5 no stale-tolerance line: lib/AGENTS.md",
      ]);
    });

    it("C6 descriptions, block scalars included; C7 eager imports; C8 node size", () => {
      const fx = fixture({
        ...BASE,
        files: {
          ...BASE_FILES,
          "AGENTS.md": `${routed("lib/AGENTS.md")}
Read @docs/guide.md first.
Then read @missing.md too.
The row \`@docs/guide.md\` is a code span.
`,
          "docs/guide.md": "one\ntwo\n",
          "lib/AGENTS.md": `${STALE}${"x\n".repeat(500)}`,
          ".agents/skills/plain/SKILL.md": skill("plain", "Does a thing."),
          ".agents/skills/folded/SKILL.md": skill("folded", ">-\n  Use when folding text."),
          ".agents/skills/literal/SKILL.md": skill("literal", "|\n  Lists things."),
          ".agents/skills/quoted/SKILL.md": skill("quoted", "'Use when quoting.'"),
        },
      });
      expectRun(run("agent-first", ["check"], fx), 0, [
        "FAIL C6 description does not start with 'Use when': .agents/skills/literal/SKILL.md",
        "FAIL C6 description does not start with 'Use when': .agents/skills/plain/SKILL.md",
        "FINDING C7 eager import AGENTS.md:13: @docs/guide.md (./docs/guide.md, 2 lines, omp expands it when this file loads)",
        "FINDING C7 eager import AGENTS.md:14: @missing.md (no file at ./missing.md)",
        "FINDING C8 over the 500-line kit policy: lib/AGENTS.md (501 lines)",
      ]);
    });

    it("C7 imports from the home folder and from absolute paths", () => {
      const fx = fixture({
        ...BASE,
        files: { ...BASE_FILES, "home/notes.md": "one\n", "abs/target.md": "a\nb\nc\n" },
      });
      const home = join(fx.dir, "home");
      fx.env["HOME"] = home;
      const absolute = join(fx.dir, "abs/target.md");
      const missing = "/nonexistent-agent-docs/x.md";
      const imports = `Read @~/notes.md first.\nRead @${absolute} next.\nRead @${missing} last.\n`;
      writeFileSync(join(fx.dir, "AGENTS.md"), `${ROOT_AGENTS}${imports}`);
      expectRun(run("agent-first", ["check"], fx), 0, [
        `FINDING C7 eager import AGENTS.md:6: @~/notes.md (${home}/notes.md, 1 lines, omp expands it when this file loads)`,
        `FINDING C7 eager import AGENTS.md:7: @${absolute} (${absolute}, 3 lines, omp expands it when this file loads)`,
        `FINDING C7 eager import AGENTS.md:8: @${missing} (no file at ${missing})`,
      ]);
    });

    it("C9 a missing skill and unverified commands; a skill without a .claude/skills/verify link passes", () => {
      const noSkill = fixture({
        files: { ...BASE_FILES, ".agents/skills/verify/SKILL.md": undefined },
      });
      expectRun(run("agent-first", ["check"], noSkill), 0, [C9_NO_SKILL]);
      expectRun(run("agent-first", ["check"], fixture({ files: BASE_FILES })), 0, []);
      const marked = fixture({
        ...BASE,
        files: { ...BASE_FILES, ".agents/skills/verify/SKILL.md": MARKED_SKILL },
      });
      expectRun(
        run("agent-first", ["check"], marked),
        0,
        MARKS.map(
          (m) =>
            `FAIL C9 unverified command (rerun every command in Step 2b): .agents/skills/verify/SKILL.md:${m}`,
        ),
      );
    });

    it.skipIf(IS_ROOT)(
      "C9 an unreadable skill prints the ERROR line, and C5 and C6 cannot read it either",
      () => {
        const fx = fixture({ ...BASE, modes: { ".agents/skills/verify/SKILL.md": 0o000 } });
        // (b) the old block printed the C9 line and exited 0; (f) it read the skill as empty for C5 and C6, and printed
        // `FAIL C6 description does not start with 'Use when'` for it.
        // C5 and C6 read the skill through agent-docs, C9 through verify-skill.
        const cannotRead =
          "agent-docs: cannot read .agents/skills/verify/SKILL.md (EACCES); make it readable and run the check again\n";
        const verifyCannotRead =
          "verify-skill: cannot read .agents/skills/verify/SKILL.md (EACCES); make it readable and run detect again\n";
        expectRun(
          run("agent-first", ["check"], fx),
          2,
          [
            "ERROR C5 cannot read .agents/skills/verify/SKILL.md",
            "ERROR C6 cannot read .agents/skills/verify/SKILL.md",
            "ERROR C9 cannot read .agents/skills/verify/SKILL.md",
          ],
          `${cannotRead}${cannotRead}${verifyCannotRead}`,
        );
      },
    );

    it("C10 each unusable entry, and no usable template", () => {
      const broken = fixture({
        files: { ...BASE_FILES, ".github/pull_request_template.md": undefined },
        links: { ".github/pull_request_template.md": "missing.md" },
      });
      expectRun(run("agent-first", ["check"], broken), 0, [
        "FINDING C10 unusable pull-request template: .github/pull_request_template.md (broken symlink)",
        C10_NONE,
      ]);
      const unusable = fixture({ ...BASE, dirs: ["docs/PULL_REQUEST_TEMPLATE"] });
      expectRun(run("agent-first", ["check"], unusable), 0, [
        "FINDING C10 unusable pull-request template: docs/PULL_REQUEST_TEMPLATE (folder without a .md or .txt file)",
      ]);
    });

    it("an AGENTS.md under node_modules is no node for C2 to C8", () => {
      const fx = fixture({
        ...BASE,
        files: { ...BASE_FILES, "node_modules/pkg/AGENTS.md": "We currently ship.\n" },
      });
      // (a) the old block printed `FAIL C2 node not routed from root: node_modules/pkg/AGENTS.md`,
      // `FINDING C5 time-relative node_modules/pkg/AGENTS.md:1`, and `FINDING C5 no stale-tolerance line: node_modules/pkg/AGENTS.md`.
      expectRun(run("agent-first", ["check"], fx), 0, []);
    });

    it("outside git walks the tree and prints the C10 ERROR line; an unknown command is a usage error", () => {
      const fx = fixture({
        git: false,
        files: {
          "AGENTS.md": ROOT_AGENTS,
          "dist/CLAUDE.md": "built\n",
          "vendor/CLAUDE.md": "vendored\n",
          "node_modules/pkg/AGENTS.md": "We currently ship.\n",
        },
      });
      // (c) ls_repo replaced by a walk with the agent-first-setup prune set; (b) exit 2 for the ERROR line.
      expectRun(
        run("agent-first", ["check"], fx),
        2,
        [C3_ALONE("dist/CLAUDE.md"), C9_NO_SKILL, C10_ERROR],
        NOT_A_REPOSITORY,
      );
      expectUsage(run("agent-first", ["bogus"], fx), "agent-first");
    });
  },
);
