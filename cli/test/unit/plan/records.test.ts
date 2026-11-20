import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { planRecords } from "../../lib/plan/entry";
import {
  PLAN_CLI_HOST_SUPPORTED,
  body,
  expectSuccess,
  planCliContext,
  refuse,
} from "../../lib/plan/harness";
import { SPAWN_TIMEOUT_MS } from "../../lib/spawnTimeout";

const { normalizePlan } = await planRecords();

const FIRST_ROW =
  "| 1 | fix_parser | Fix parser | src/parser.mjs | - | local | planned | Records round-trip |";

describe("plan records", () => {
  it.skipIf(!PLAN_CLI_HOST_SUPPORTED)(
    "new creates each missing plan label and keeps existing label metadata unchanged",
    () => {
      const { loadState, updateState, createPlan } = planCliContext();
      // Existing label metadata is not an input for new and must survive unchanged.
      const existingLabels = {
        plan: { color: "123456", description: "Keep this color" },
        "plan:drafting": { color: "abcdef", description: "Keep this description" },
      };
      updateState((state) => {
        state.labels = structuredClone(existingLabels);
      });
      createPlan("labels already present");
      expect(
        Object.fromEntries(
          Object.entries(loadState().labels).filter(([name]) => name in existingLabels),
        ),
        "new creates missing labels without changing existing metadata",
      ).toStrictEqual(existingLabels);
      expect(
        Object.keys(loadState().labels).sort(),
        "new creates each missing plan label",
      ).toStrictEqual(["plan", "plan:blocked", "plan:drafting", "plan:ongoing", "plan:planned"]);
      const allLabels = loadState().labels;
      createPlan("all labels already present");
      expect(
        loadState().labels,
        "repeating new leaves every existing label unchanged",
      ).toStrictEqual(allLabels);
    },
    SPAWN_TIMEOUT_MS,
  );

  it.skipIf(!PLAN_CLI_HOST_SUPPORTED)(
    "edit writes the normalized body to the remote issue and to the export provenance",
    () => {
      const { issue, createPlan, exported, edit } = planCliContext();
      // Normalization must reach the remote body, not just the local export.
      const irregular = body("Done")
        .replace("## Goal", "## goal")
        .replace("Mode: plan-and-implement\n", "")
        .replace("fix_parser", "Fix-Parser")
        .replace("| local |", "| Local |")
        .replace("Fix the parser.", "Fix the parser — preserve records.");
      const normalized = normalizePlan(irregular);
      expect(normalized.body).toMatch(/Mode: plan-only/);
      expect(normalized.body).toMatch(/## Goal\n/);
      expect(normalized.body).toMatch(/\| fix_parser \|/);
      expect(normalized.body).toMatch(/\| `?local`? \| `?done`? \|/);
      expect(normalized.body.includes("—")).toBe(false);
      expect(normalized.body).toMatch(/Fix the parser - preserve records\./);
      const normalization = createPlan("normalization", irregular);
      const normalizedEdit = edit(normalization);
      expectSuccess(normalizedEdit, "normalize edit");
      expect(issue(normalization).body).toBe(normalized.body);
      expect(normalizedEdit.stdout).toMatch(/^advice: .*mode/im);
      const normalizedFile = exported(normalization);
      expect(readFileSync(`${normalizedFile}.origin`, "utf8")).toBe(
        `${createHash("sha256").update(normalized.body).digest("hex")}\n`,
      );
    },
    SPAWN_TIMEOUT_MS,
  );

  it.skipIf(!PLAN_CLI_HOST_SUPPORTED)(
    "edit stores a body that quotes gh placeholder tokens unchanged, in one mutation request (#89)",
    () => {
      const { run, loadState, issue, createPlan, exported } = planCliContext();
      // The body travels as a gh `@file` field; gh would type-convert and placeholder-fill a plain -F value.
      const quoting = createPlan("placeholder tokens");
      const quoted =
        "Run `gh api repos/{owner}/{repo}/branches/{branch}` or `gh api repos/:owner/:repo`.";
      const file = exported(quoting);
      writeFileSync(file, readFileSync(file, "utf8").replace("Not run.", quoted));
      const callsBefore = loadState().calls.length;
      expectSuccess(
        run("edit", String(quoting), "--file", file),
        "edit a body that quotes placeholder tokens",
      );
      const editCalls = loadState().calls.slice(callsBefore);
      expect(
        editCalls.map((call) => call.slice(0, 2).join(" ")),
        "an edit sends the snapshot, the pre-write read, and one mutation request",
      ).toStrictEqual(["api graphql", "issue view", "api graphql"]);
      expect(issue(quoting).body, "the stored body keeps every token").toBe(
        body().replace("Not run.", quoted),
      );
      const shown = run("show", String(quoting), "--body");
      expectSuccess(shown, "show the body that quotes placeholder tokens");
      expect(shown.stdout, "show reads the stored body back unchanged").toBe(issue(quoting).body);
    },
    SPAWN_TIMEOUT_MS,
  );

  it("machine path advice names each distinct machine path and skips routes, portable paths, and slash text", () => {
    // Machine path advice names each distinct path into a home, a mount, a named temporary or runtime directory,
    // a Windows drive, or a network share. URL routes, portable system paths, and slash text get none (#71).
    const machinePathAdvice = (text: string): ReadonlyArray<string> =>
      normalizePlan(body().replace("The parser loses mixed-case records.", text)).advice.filter(
        (message) => message.startsWith("body contains an absolute machine path"),
      );
    const named = (...paths: ReadonlyArray<string>): ReadonlyArray<string> =>
      paths.map((found) => `body contains an absolute machine path: ${found}`);
    for (const [text, expected] of [
      ["Clone into /home/<user>/projects/x.", named("/home/<user>/projects/x")],
      ["Open `/Users/<user>/src`.", named("/Users/<user>/src")],
      ["Read /root/.ssh/config and /mnt/data/x", named("/root/.ssh/config", "/mnt/data/x")],
      [
        "Mounts /media/<user>/usb, /run/media/<user>/usb, /Volumes/Data/x",
        named("/media/<user>/usb", "/run/media/<user>/usb", "/Volumes/Data/x"),
      ],
      [
        "Scratch `/tmp/<name>`, /var/tmp/x, /private/tmp/x",
        named("/tmp/<name>", "/var/tmp/x", "/private/tmp/x"),
      ],
      [
        "Temp /var/folders/ab/cd/T/x and /private/var/folders/ab/T/x",
        named("/var/folders/ab/cd/T/x", "/private/var/folders/ab/T/x"),
      ],
      ["XDG_RUNTIME_DIR=/run/user/1000/bus", named("/run/user/1000/bus")],
      [
        "Windows C:\\Users\\<user>\\x, D:/work/x, \\\\server\\share\\x",
        named("C:\\Users\\<user>\\x", "D:/work/x", "\\\\server\\share\\x"),
      ],
      [
        "See [log](/home/<user>/log.txt) and file:///home/<user>/y",
        named("/home/<user>/log.txt", "/home/<user>/y"),
      ],
      ["Twice /home/a/x, /home/a/x then /tmp/y;", named("/home/a/x", "/tmp/y")],
      ["Routes /login/, `/wp-json/<namespace>/v1/items/123`, /search/transfer/user", []],
      ["TMPDIR=/tmp node t.mjs, /usr/bin/php8.5, #!/usr/bin/env node, x > /dev/null", []],
      ["Pick `A`/`B`, awk '/^## /{f=0}', __DIR__ . '/vendor/autoload.php'", []],
      ["URLs https://example.com/home/a and ssh://host/home/a", []],
      ["Portable ~/.local/state/docks/x, $HOME/x, bare /tmp, /tmp/ and /home/", []],
      ["Regex `'\\\\d+\\\\.'`", []],
    ] as const)
      expect(machinePathAdvice(text), text).toStrictEqual(expected);
  });

  it.skipIf(!PLAN_CLI_HOST_SUPPORTED)(
    "edit refuses step ids that collide after normalization and writes nothing",
    () => {
      const { issue, createPlan, edit } = planCliContext();
      // Ids that differ only by case or dash collapse after normalization; the write refuses the collision.
      const collision = createPlan("id-collision");
      const collisionEdit = edit(collision, (text) =>
        text.replace(
          FIRST_ROW,
          `${FIRST_ROW}\n| 2 | Fix-Parser | Second | src/other.mjs | - | local | planned | Also round-trips |`,
        ),
      );
      refuse(collisionEdit, "duplicate step id after normalization: fix_parser");
      expect(issue(collision).body, "a refused collision writes nothing").toBe(body());
    },
    SPAWN_TIMEOUT_MS,
  );

  it.skipIf(!PLAN_CLI_HOST_SUPPORTED)(
    "show reads a v3 record; the next edit writes v5 before work starts and v4 after",
    () => {
      const { run, issue, createPlan, updateIssue, edit } = planCliContext();
      // Old records stay readable. A plan whose work has not started moves to v5 on its next body write (E2).
      const legacyBody = body()
        .replace("plan-contract: v5", "plan-contract: v3")
        .replace(
          "## Verification Results",
          "## Review\n\nOld body review.\n\n## Verification Results",
        );
      const legacy = createPlan("legacy", legacyBody);
      const legacyShow = run("show", String(legacy), "--body");
      expectSuccess(legacyShow, "show v3");
      expect(legacyShow.stdout.trim()).toBe(issue(legacy).body.trim());
      expect(legacyShow.stderr).toMatch(/reviews: plan=none code=none/);
      expectSuccess(edit(legacy), "edit v3");
      expect(issue(legacy).body).toMatch(/^<!-- plan-contract: v5 -->/);
      expect(issue(legacy).body).not.toMatch(/^## Review$/m);
      // A started v3 plan keeps the partial-pull-request flow, so its next body write uses v4, and later writes keep v4.
      const started = createPlan("started legacy", legacyBody);
      updateIssue(started, (entry) => {
        entry.labels = ["plan", "plan:ongoing"];
      });
      expectSuccess(edit(started), "edit a started v3 plan");
      expect(issue(started).body).toMatch(/^<!-- plan-contract: v4 -->/);
      expectSuccess(
        run("step", String(started), "fix_parser", "in-flight"),
        "step on a started v4 plan",
      );
      expect(issue(started).body).toMatch(/^<!-- plan-contract: v4 -->/);
    },
    SPAWN_TIMEOUT_MS,
  );

  it.skipIf(!PLAN_CLI_HOST_SUPPORTED)(
    "dependency normalization resolves a numeric step id and a second pass changes nothing",
    () => {
      const { issue, createPlan, edit } = planCliContext();
      // Dependency normalization is idempotent even when a step id is a number.
      const numericId = createPlan("numeric step id");
      const numericRows = [
        "| 1 | prepare | Prepare | src/a.mjs | - | local | planned | Ready |",
        "| 2 | 1 | Numeric | src/b.mjs | - | local | planned | Ready |",
        "| 3 | finish | Finish | src/c.mjs | prepare | local | planned | Ready |",
      ].join("\n");
      expectSuccess(
        edit(numericId, (text) => text.replace(FIRST_ROW, numericRows)),
        "edit with numeric id",
      );
      const once = issue(numericId).body;
      expect(once, "prepare resolves to display 1").toMatch(
        /\| 3 \| finish \| Finish \| src\/c\.mjs \| 1 \|/,
      );
      expectSuccess(edit(numericId), "second normalization");
      expect(issue(numericId).body, "a second normalization changes nothing").toBe(once);
    },
    SPAWN_TIMEOUT_MS,
  );

  it.skipIf(!PLAN_CLI_HOST_SUPPORTED)(
    "edit advises on steps that share a path only when no Depends chain links them (#78)",
    () => {
      const { createPlan, edit } = planCliContext();
      // Steps that edit the same path need a Depends chain, or parallel work collides (#78).
      const sharedFiles = createPlan("shared files");
      const sharedRows = [
        FIRST_ROW,
        "| 2 | parse_dates | Parse dates | `src/parser.mjs`, src/dates.mjs | - | local | planned | Dates parse |",
        "| 3 | format_dates | Format dates | src/dates.mjs | parse_dates | local | planned | Dates format |",
        "| 4 | print_dates | Print dates | src/dates.mjs | format_dates | local | planned | Dates print |",
      ].join("\n");
      const sharedEdit = edit(sharedFiles, (text) => text.replace(FIRST_ROW, sharedRows));
      expectSuccess(sharedEdit, "edit with shared files");
      expect(
        sharedEdit.stdout.split("\n").filter((line) => line.includes(" share ")),
        "only steps without a Depends chain get shared-path advice",
      ).toStrictEqual([
        "advice: steps fix_parser and parse_dates share src/parser.mjs with no Depends link",
      ]);
    },
    SPAWN_TIMEOUT_MS,
  );

  it("shared-path advice matches a path inside a padded code span", () => {
    // A code span with inner spaces names the same path as the bare text.
    const rows = [
      FIRST_ROW,
      "| 2 | parse_dates | Parse dates | ` src/parser.mjs ` | - | local | planned | Dates parse |",
    ].join("\n");
    const { advice } = normalizePlan(body().replace(FIRST_ROW, rows));
    expect(advice.filter((message) => message.includes(" share "))).toStrictEqual([
      "steps fix_parser and parse_dates share src/parser.mjs with no Depends link",
    ]);
  });

  it("effect advice asks only for a non-local step that is not done or skipped", () => {
    // A done or skipped step does not run again; its ask reminder only adds noise to show and step output.
    const rows = [
      FIRST_ROW,
      "| 2 | push_fix | Push fix | - | 1 | push | done | Branch pushed |",
      "| 3 | release_fix | Release fix | - | 2 | release | skipped | Release cut |",
      "| 4 | probe_api | Probe API | - | - | probe | blocked | API answers |",
      "| 5 | deploy_fix | Deploy fix | - | 2 | deploy | planned | Deploy green |",
    ].join("\n");
    const { advice } = normalizePlan(body().replace(FIRST_ROW, rows));
    expect(advice.filter((message) => message.includes("in-session ask"))).toStrictEqual([
      "step probe_api Effect probe needs an in-session ask before it runs.",
      "step deploy_fix Effect deploy needs an in-session ask before it runs.",
    ]);
  });
});
