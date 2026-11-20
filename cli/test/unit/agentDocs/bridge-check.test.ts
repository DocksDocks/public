import { describe, it } from "vitest";

import {
  AGENT_DOCS_HOST_SUPPORTED,
  AUDIT_PATHS,
  NON_GIT,
  NO_PLUGIN,
  PR_ERROR,
  ROOT_AGENTS,
  STALE,
  TEST_SKILL,
  audit,
  expectRun,
  expectUsage,
  fixture,
  routed,
  run,
} from "../../lib/agentDocs/harness";
import { SPAWN_TIMEOUT_MS } from "../../lib/spawnTimeout";

const NOT_A_REPOSITORY = "fatal: not a git repository (or any of the parent directories): .git\n";

describe.skipIf(!AGENT_DOCS_HOST_SUPPORTED)(
  "bridge-check audit",
  { timeout: SPAWN_TIMEOUT_MS },
  () => {
    it("the four presence lines, then the legacy skills, legacy agents, and legacy settings lines of the root .claude folder, then legacy and personal paths, also when started in a subfolder", () => {
      const fx = fixture({
        files: {
          ".gitignore": "CLAUDE.local.md\ngen/\n",
          "AGENTS.md": ROOT_AGENTS,
          "CLAUDE.md": "rules\n",
          ".claude/CLAUDE.md": "rules\n",
          "CLAUDE.local.md": "mine\n",
          ".claude/agents/review.md": "# Review\n",
          ".claude/settings.json": "{}\n",
          ".agents/skills/x/SKILL.md": TEST_SKILL,
          "api/CLAUDE.md": "rules\n",
          "api/CLAUDE.local.md": "mine\n",
          "dist/CLAUDE.md": "built\n",
          "dist/CLAUDE.local.md": "built\n",
          "gen/CLAUDE.md": "generated\n",
          "node_modules/pkg/CLAUDE.md": "package\n",
        },
        links: { ".claude/skills/x": "../../.agents/skills/x" },
      });
      // (d) the old commands printed bare paths (personal ones with `./`, in find order) in separate blocks.
      const lines = [
        ...audit(...AUDIT_PATHS),
        "legacy skills: .claude/skills",
        "legacy agents: .claude/agents/review.md",
        "legacy settings: .claude/settings.json",
        "legacy: .claude/CLAUDE.md",
        "legacy: CLAUDE.md",
        "legacy: api/CLAUDE.md",
        "legacy: dist/CLAUDE.md",
        "personal: CLAUDE.local.md",
        "personal: api/CLAUDE.local.md",
        NO_PLUGIN,
      ];
      expectRun(run("bridge-check", ["audit"], fx), 0, lines);
      expectRun(run("bridge-check", ["audit"], fx, "api"), 0, lines);
    });

    it("an empty repository", () => {
      expectRun(run("bridge-check", ["audit"], fixture()), 0, [...audit(), NO_PLUGIN]);
    });

    it("a dangling CLAUDE.local.md or CLAUDE.md symlink is no file", () => {
      const links = { "CLAUDE.local.md": "missing.md", "api/CLAUDE.local.md": "missing.md" };
      expectRun(run("bridge-check", ["audit"], fixture({ links })), 0, [...audit(), NO_PLUGIN]);
      // Outside git, a dangling symlink resolves to no file either.
      const outside = fixture({
        git: false,
        files: { "api/CLAUDE.md": "rules\n" },
        links: { ...links, "CLAUDE.md": "missing.md" },
      });
      expectRun(run("bridge-check", ["audit"], outside), 0, [
        ...audit(),
        "legacy: api/CLAUDE.md",
        NO_PLUGIN,
      ]);
    });

    it("plugin author: yes for an omp plugin catalog or a package.json omp object, else no", () => {
      const catalog = fixture({ files: { ".omp-plugin/marketplace.json": '{"name":"m"}\n' } });
      expectRun(run("bridge-check", ["audit"], catalog), 0, [
        ...audit(),
        "plugin author: yes (.omp-plugin/marketplace.json)",
      ]);
      const manifest = fixture({
        files: { "package.json": '{"name":"p","omp":{"skills":["./skills"]}}\n' },
      });
      expectRun(run("bridge-check", ["audit"], manifest), 0, [
        ...audit(),
        "plugin author: yes (package.json omp object)",
      ]);
      for (const text of [
        '{"name":"p"}\n',
        '{"name":"p","omp":["./skills"]}\n',
        '{"name":"p","omp":null}\n',
        "{ no json\n",
      ]) {
        expectRun(run("bridge-check", ["audit"], fixture({ files: { "package.json": text } })), 0, [
          ...audit(),
          NO_PLUGIN,
        ]);
      }
    });

    it("a CLAUDE.md or .claude/CLAUDE.md link to the AGENTS.md of its folder is a legacy link; verify still reports it", () => {
      const fx = fixture({
        files: { "AGENTS.md": ROOT_AGENTS, "docs/AGENTS.md": STALE, "docs/other.md": "other\n" },
        links: {
          "CLAUDE.md": "AGENTS.md",
          ".claude/CLAUDE.md": "../AGENTS.md",
          "docs/CLAUDE.md": "other.md",
        },
      });
      expectRun(run("bridge-check", ["audit"], fx), 0, [
        ...audit("AGENTS.md", "CLAUDE.md (root)", ".claude/CLAUDE.md"),
        "legacy link: .claude/CLAUDE.md",
        "legacy link: CLAUDE.md",
        "legacy: docs/CLAUDE.md",
        NO_PLUGIN,
      ]);
      expectRun(run("bridge-check", ["verify"], fx), 0, [
        "BROKEN: legacy CLAUDE.md still present: .claude/CLAUDE.md",
        "BROKEN: legacy CLAUDE.md still present: CLAUDE.md",
        "BROKEN: legacy CLAUDE.md still present: docs/CLAUDE.md",
        "HANDOFF context-tree: unrouted node docs/AGENTS.md",
      ]);
    });

    it("outside git a nested CLAUDE.md symlink to a file is listed, a dangling one is not; verify reports the listed one", () => {
      const fx = fixture({
        git: false,
        files: { "AGENTS.md": routed("docs/AGENTS.md"), "docs/AGENTS.md": STALE },
        links: { "docs/CLAUDE.md": "AGENTS.md", "api/CLAUDE.md": "missing.md" },
      });
      expectRun(run("bridge-check", ["audit"], fx), 0, [
        ...audit("AGENTS.md"),
        "legacy link: docs/CLAUDE.md",
        NO_PLUGIN,
      ]);
      expectRun(run("bridge-check", ["verify"], fx), 0, [
        "BROKEN: legacy CLAUDE.md still present: docs/CLAUDE.md",
      ]);
    });
  },
);

describe.skipIf(!AGENT_DOCS_HOST_SUPPORTED)(
  "non-git prune sets",
  { timeout: SPAWN_TIMEOUT_MS },
  () => {
    it("dist/CLAUDE.md is legacy for agent-first-setup and pruned for claude-md-migration", () => {
      const fx = fixture(NON_GIT);
      // (c) each skill walks with its own prune set; (d) labeled paths without the `./` of find.
      expectRun(run("bridge-check", ["audit"], fx), 0, [
        ...audit("AGENTS.md", "CLAUDE.md (root)", "CLAUDE.local.md"),
        "legacy: CLAUDE.md",
        "personal: CLAUDE.local.md",
        NO_PLUGIN,
      ]);
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

    it("a walk lists whole paths in byte order, not in creation or folder order", () => {
      const names = ["é", "B", "😀", "a", "z", "_", "a-b", "ｚ"];
      const fx = fixture({
        git: false,
        files: Object.fromEntries(names.map((n) => [`${n}/CLAUDE.md`, "rules\n"])),
      });
      // `a-b/` sorts before `a/`, because `-` is below `/`, although a walk enters `a` first. UTF-16 order would put
      // 😀 (a surrogate pair) before ｚ (U+FF5A); byte order puts it last.
      const sorted = ["B", "_", "a-b", "a", "z", "é", "ｚ", "😀"];
      expectRun(run("bridge-check", ["audit"], fx), 0, [
        ...audit(),
        ...sorted.map((n) => `legacy: ${n}/CLAUDE.md`),
        NO_PLUGIN,
      ]);
    });
  },
);

describe.skipIf(!AGENT_DOCS_HOST_SUPPORTED)(
  "bridge-check verify",
  { timeout: SPAWN_TIMEOUT_MS },
  () => {
    it("a migrated repository prints nothing, also with .claude entries left in place, with and without --expect", () => {
      const fx = fixture({
        files: {
          "AGENTS.md": routed("api/AGENTS.md"),
          "api/AGENTS.md": STALE,
          ".agents/skills/x/SKILL.md": TEST_SKILL,
          ".claude/skills/plain/SKILL.md": TEST_SKILL,
          ".claude/agents/review.md": "# Review\n",
          ".claude/settings.json": "{}\n",
        },
        links: {
          ".claude/skills/x": "../../.agents/skills/x",
          ".claude/skills/gone": "../../.agents/skills/gone",
        },
      });
      expectRun(run("bridge-check", ["verify"], fx), 0, []);
      expectRun(
        run("bridge-check", ["verify", "--expect", "AGENTS.md", "--expect", "api/AGENTS.md"], fx),
        0,
        [],
      );
    });

    it("a missing AGENTS.md, legacy files, and missing --expect paths; no BROKEN line for a .claude/skills link", () => {
      const fx = fixture({
        files: {
          "CLAUDE.md": "rules\n",
          ".claude/CLAUDE.md": "rules\n",
          "api/CLAUDE.md": "rules\n",
          "api/AGENTS.md": "We currently ship.\n",
          "node_modules/pkg/CLAUDE.md": "package\n",
          "node_modules/pkg/AGENTS.md": "We recently shipped.\n",
        },
        links: {
          ".claude/skills/gone": "../../.agents/skills/gone",
          ".claude/skills/.dot": "../../.agents/skills/.dot",
        },
      });
      const head = [
        "BROKEN: AGENTS.md missing",
        "BROKEN: legacy CLAUDE.md still present: .claude/CLAUDE.md",
        "BROKEN: legacy CLAUDE.md still present: CLAUDE.md",
        "BROKEN: legacy CLAUDE.md still present: api/CLAUDE.md",
      ];
      const tail = [
        "HANDOFF context-tree: unrouted node api/AGENTS.md",
        "VOLATILE time-relative api/AGENTS.md:1",
      ];
      expectRun(run("bridge-check", ["verify"], fx), 0, [...head, ...tail]);
      // (e) one line per --expect path that is not a file; it replaces the three placeholder lines of the old block.
      expectRun(
        run("bridge-check", ["verify", "--expect", "docs/AGENTS.md", "--expect", "api"], fx),
        0,
        [...head, "BROKEN: docs/AGENTS.md missing", "BROKEN: api missing", ...tail],
      );
    });

    it("routing handoffs and volatile values; a bad argument is a usage error", () => {
      const fx = fixture({
        files: {
          "AGENTS.md": `${routed("api/AGENTS.md", "gone/AGENTS.md")}
We currently ship one tool.
The kit has 12 skills.
See src/app.ts:10 for the entry.
`,
          "src/app.ts": "export {};\n",
          "api/AGENTS.md": STALE,
          "lib/AGENTS.md": STALE,
        },
      });
      expectRun(run("bridge-check", ["verify"], fx), 0, [
        "HANDOFF context-tree: unrouted node lib/AGENTS.md",
        "HANDOFF context-tree: dead route gone/AGENTS.md",
        "VOLATILE time-relative AGENTS.md:14",
        "VOLATILE bare-count AGENTS.md:15",
        "VOLATILE line-anchor AGENTS.md:16 (src/app.ts exists)",
      ]);
      expectUsage(run("bridge-check", ["verify", "--expect"], fx), "bridge-check");
      expectUsage(run("bridge-check", ["verify", "--bogus"], fx), "bridge-check");
      expectUsage(run("bridge-check", ["bogus"], fx), "bridge-check");
    });

    it("outside git a symlinked node stays in the routing and volatile checks", () => {
      const fx = fixture({
        git: false,
        files: { "AGENTS.md": ROOT_AGENTS, "docs/api.md": "We currently ship.\n" },
        links: { "api/AGENTS.md": "../docs/api.md" },
      });
      expectRun(run("bridge-check", ["verify"], fx), 0, [
        "HANDOFF context-tree: unrouted node api/AGENTS.md",
        "VOLATILE time-relative api/AGENTS.md:1",
      ]);
    });
  },
);
