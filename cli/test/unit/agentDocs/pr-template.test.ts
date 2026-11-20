import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  AGENT_DOCS_HOST_SUPPORTED,
  IS_ROOT,
  PR_ERROR,
  expectRun,
  expectUsage,
  fixture,
  run,
} from "../../lib/agentDocs/harness";
import { SPAWN_TIMEOUT_MS } from "../../lib/spawnTimeout";

const NOT_A_REPOSITORY = "fatal: not a git repository (or any of the parent directories): .git\n";
const cannotList = (folder: string): string =>
  `pr-template: cannot list the folder ${folder} (EACCES); make it readable and run the check again\n`;

describe.skipIf(!AGENT_DOCS_HOST_SUPPORTED)(
  "pr-template detect",
  { timeout: SPAWN_TIMEOUT_MS },
  () => {
    it("names each usable and unusable entry, by folder and then by byte order of the name", () => {
      const fx = fixture({
        files: {
          "pull_request_template.md": "## Checklist\n",
          "docs/PULL_REQUEST_TEMPLATE/a.md": "## A\n",
          "docs/pull_request_template.md.bak": "old\n",
          "tpl.txt": "text\n",
        },
        links: {
          PULL_REQUEST_TEMPLATE: "docs/PULL_REQUEST_TEMPLATE",
          "docs/pull_request_template.txt": "../tpl.txt",
          ".github/pull_request_template": "missing.md",
        },
        dirs: [".github/PULL_REQUEST_TEMPLATE", ".github/pull_request_template.md"],
      });
      const lines = [
        "pull-request template: ./PULL_REQUEST_TEMPLATE (symlink to folder)",
        "pull-request template: ./pull_request_template.md (file)",
        "pull-request template: docs/PULL_REQUEST_TEMPLATE (folder)",
        "pull-request template: docs/pull_request_template.txt (symlink to file)",
        "pull-request template: unusable .github/PULL_REQUEST_TEMPLATE (folder without a .md or .txt file)",
        "pull-request template: unusable .github/pull_request_template (broken symlink)",
        "pull-request template: unusable .github/pull_request_template.md (folder with a file name)",
      ];
      expectRun(run("pr-template", ["detect"], fx), 0, lines);
      expectRun(run("pr-template", ["detect"], fx, "docs"), 0, lines);
    });

    it("prints none when no usable entry exists, also after an unusable one", () => {
      const broken = fixture({ links: { ".github/pull_request_template.md": "missing.md" } });
      expectRun(run("pr-template", ["detect"], broken), 0, [
        "pull-request template: unusable .github/pull_request_template.md (broken symlink)",
        "pull-request template: none",
      ]);
      expectRun(run("pr-template", ["detect"], fixture()), 0, ["pull-request template: none"]);
    });

    it("outside git prints the ERROR line", () => {
      // (b) the old wrapper printed the same line and exited 0.
      expectRun(
        run("pr-template", ["detect"], fixture({ git: false })),
        2,
        [PR_ERROR],
        NOT_A_REPOSITORY,
      );
    });

    it("a symlinked docs or .github folder lists no entry", () => {
      const fx = fixture({
        files: {
          "real/pull_request_template.md": "## Checklist\n",
          "gh/pull_request_template.md": "## Checklist\n",
        },
        links: { docs: "real", ".github": "gh" },
      });
      expectRun(run("pr-template", ["detect"], fx), 0, ["pull-request template: none"]);
    });

    it.skipIf(IS_ROOT)("a folder that cannot be listed prints the ERROR line", () => {
      expectRun(
        run("pr-template", ["detect"], fixture({ dirs: ["docs"], modes: { docs: 0o000 } })),
        2,
        [PR_ERROR],
        cannotList("docs"),
      );
      const folder = ".github/PULL_REQUEST_TEMPLATE";
      expectRun(
        run("pr-template", ["detect"], fixture({ dirs: [folder], modes: { [folder]: 0o000 } })),
        2,
        [PR_ERROR],
        cannotList(`${folder}/`),
      );
    });

    it("an entry that is no file, folder, or symlink is not a regular file", () => {
      const fx = fixture({ dirs: [".github"] });
      const fifo = spawnSync("mkfifo", [join(fx.dir, ".github/pull_request_template.md")], {
        encoding: "utf8",
      });
      expect(fifo.status, `mkfifo: ${fifo.stderr}`).toBe(0);
      expectRun(run("pr-template", ["detect"], fx), 0, [
        "pull-request template: unusable .github/pull_request_template.md (not a regular file)",
        "pull-request template: none",
      ]);
    });
  },
);

describe.skipIf(!AGENT_DOCS_HOST_SUPPORTED)(
  "pr-template gate",
  { timeout: SPAWN_TIMEOUT_MS },
  () => {
    it("refuses an entry with a supported name at .github/pull_request_template.md in any letter case", () => {
      const broken = fixture({ links: { ".github/pull_request_template.md": "missing.md" } });
      expectRun(run("pr-template", ["gate"], broken), 0, ["target occupied: write nothing"]);
      const upper = fixture({ files: { ".github/PULL_REQUEST_TEMPLATE.md": "## Checklist\n" } });
      expectRun(run("pr-template", ["gate"], upper), 0, ["target occupied: write nothing"]);
    });

    it("frees the target when no usable template exists and .github is no symlink", () => {
      expectRun(run("pr-template", ["gate"], fixture()), 0, ["target free"]);
      expectRun(
        run("pr-template", ["gate"], fixture({ dirs: ["docs/PULL_REQUEST_TEMPLATE"] })),
        0,
        ["target free"],
      );
    });

    it("writes nothing next to a usable template or through a .github symlink", () => {
      const line = "no write: a usable template exists, or .github is a symlink";
      expectRun(
        run(
          "pr-template",
          ["gate"],
          fixture({ files: { "pull_request_template.md": "## Checklist\n" } }),
        ),
        0,
        [line],
      );
      expectRun(
        run(
          "pr-template",
          ["gate"],
          fixture({ files: { "gh/.keep": "" }, links: { ".github": "gh" } }),
        ),
        0,
        [line],
      );
    });

    it("outside git prints the ERROR line; an unknown command is a usage error", () => {
      const fx = fixture({ git: false });
      // (b) the old gate printed the same line and exited 0.
      expectRun(run("pr-template", ["gate"], fx), 2, [PR_ERROR], NOT_A_REPOSITORY);
      expectUsage(run("pr-template", ["bogus"], fx), "pr-template");
      expectUsage(run("pr-template", [], fx), "pr-template");
    });
  },
);
