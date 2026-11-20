/**
 * The plan suites' implementation selector (#203, decision 3a).
 *
 * `PLAN_CLI_ENTRY` selects the implementation that every kind of plan test
 * runs: `plan.mjs` (the default) or `docks-kit`. The suites run once per
 * entry, so a port mistake shows as a difference between the two runs.
 *
 * 1. Spawned plan commands: `node plan.mjs <args>`, or the docks-kit test
 *    entry with `plan <args>`.
 * 2. The checkout helpers: `sh base-blob.sh` and `sh checkout-state.sh`, or
 *    `docks-kit plan base-blob` and `docks-kit plan checkout-state`.
 * 3. The skill snippets of the base-instructions tests: the bash blocks of the
 *    skill files at commit b169640, which call `sh <skill-dir>/scripts/base-blob.sh`, or the
 *    planned new form in `snippets/`, which calls `docks-kit plan base-blob`
 *    through a `docks-kit` shim on PATH.
 * 4. The pure modules: the exports of `plan.mjs`, or `cli/src/plan/records.ts`
 *    and `cli/src/plan/reviews.ts`.
 *
 * Step `callers` of #203 removes this selector, the `plan.mjs` mode, the shell
 * mode, and the snippet fixtures.
 */
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { delimiter, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { BUN_RUNTIME, cliEntry } from "../cliEntry";

export const PLAN_CLI_ENTRY_ENV = "PLAN_CLI_ENTRY";

export type PlanCliEntry = "plan.mjs" | "docks-kit";

function selectedEntry(): PlanCliEntry {
  const raw = process.env[PLAN_CLI_ENTRY_ENV];
  if (raw === undefined || raw === "" || raw === "plan.mjs") return "plan.mjs";
  if (raw === "docks-kit") return "docks-kit";
  throw new Error(`${PLAN_CLI_ENTRY_ENV} is '${raw}'; use 'plan.mjs' or 'docks-kit'`);
}

export const PLAN_CLI_ENTRY: PlanCliEntry = selectedEntry();

const REPO_DIR = resolve(import.meta.dirname, "..", "..", "..", "..");
const SKILLS_DIR = join(REPO_DIR, "SoT", ".omp", "plugin", "skills");
export const PLAN_MANAGER_DIR = join(SKILLS_DIR, "plan-manager");
export const CODE_REVIEW_DIR = join(SKILLS_DIR, "code-review");
const PLAN_MJS = join(PLAN_MANAGER_DIR, "scripts", "plan.mjs");
const SKIP_WAITS_HOOK = join(import.meta.dirname, "skipWaits.ts");
const SNIPPETS_DIR = join(import.meta.dirname, "snippets");
const PLAN_SOURCE_DIR = join(REPO_DIR, "cli", "src", "plan");

/**
 * The command word that a refusal or advice line uses for the helper
 * (decision 5a), as in `run \`<word> export 7\``.
 */
export const COMMAND_WORD = PLAN_CLI_ENTRY === "plan.mjs" ? "plan.mjs" : "docks-kit plan";

/** One process to spawn: the program, its arguments, and the variables it adds. */
export type Invocation = {
  readonly file: string;
  readonly args: ReadonlyArray<string>;
  readonly env: Readonly<Record<string, string>>;
};

/**
 * The docks-kit `plan` command skips its waits when this variable is `1`, and
 * appends each skipped timeout to the file that `PLAN_CLI_WAIT_LOG` names, as
 * the `plan.mjs` hook `skipWaits.ts` does.
 */
export const SKIP_WAITS_ENV = "PLAN_CLI_SKIP_WAITS";

/**
 * A plan command. With `skipWaits`, the waits of `reopen` and `archive`
 * return at once and each one is logged to `PLAN_CLI_WAIT_LOG`.
 */
export function planInvocation(
  args: ReadonlyArray<string>,
  options: { readonly skipWaits?: boolean } = {},
): Invocation {
  const skipWaits = options.skipWaits === true;
  if (PLAN_CLI_ENTRY === "plan.mjs") {
    const hook = skipWaits ? ["--import", pathToFileURL(SKIP_WAITS_HOOK).href] : [];
    return { file: "node", args: [...hook, PLAN_MJS, ...args], env: {} };
  }
  return {
    file: BUN_RUNTIME,
    args: [cliEntry(), "plan", ...args],
    env: skipWaits ? { [SKIP_WAITS_ENV]: "1" } : {},
  };
}

export type CheckoutHelper = "base-blob" | "checkout-state";

/** `base-blob <commit> <path>` or `checkout-state <checkout>`. */
export function checkoutHelperInvocation(
  helper: CheckoutHelper,
  args: ReadonlyArray<string>,
): Invocation {
  if (PLAN_CLI_ENTRY === "plan.mjs") {
    return {
      file: "sh",
      args: [join(PLAN_MANAGER_DIR, "scripts", `${helper}.sh`), ...args],
      env: {},
    };
  }
  return { file: BUN_RUNTIME, args: [cliEntry(), "plan", helper, ...args], env: {} };
}

export type SkillSnippet = "plan-manager" | "code-review";

const SNIPPETS: Record<SkillSnippet, { readonly skill: string; readonly marker: string }> = {
  "plan-manager": { skill: PLAN_MANAGER_DIR, marker: '-base-instructions"' },
  "code-review": { skill: CODE_REVIEW_DIR, marker: "git merge-base <fixed-point> HEAD" },
};

/**
 * The commit whose skill files still call `sh <skill-dir>/scripts/base-blob.sh`
 * (docks-kit 0.25.0). The live skill files use the `docks-kit plan` form.
 */
export const SNIPPET_BASELINE_COMMIT = "b169640";

/** The one bash block of `text` that contains `marker`; `source` names the text in an error. */
export function bashBlock(text: string, source: string, marker: string): string {
  const blocks = [...text.matchAll(/^```bash\n([\s\S]*?)^```$/gm)].map(([, code]) => code ?? "");
  const found = blocks.filter((code) => code.includes(marker));
  const [block] = found;
  if (found.length !== 1 || block === undefined) {
    throw new Error(`${source} has ${found.length} bash blocks with ${marker}; expected 1`);
  }
  return block;
}

/** The text of `SKILL.md` of the skill `kind` at `SNIPPET_BASELINE_COMMIT`. */
function baselineSkillText(kind: SkillSnippet): { readonly text: string; readonly source: string } {
  const source = `${SNIPPET_BASELINE_COMMIT}:SoT/.omp/plugin/skills/${kind}/SKILL.md`;
  const shown = spawnSync("git", ["show", source], {
    cwd: REPO_DIR,
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
  });
  if (shown.error !== undefined || shown.status !== 0) {
    const detail = shown.error?.message ?? shown.stderr.trim();
    throw new Error(
      `${PLAN_CLI_ENTRY_ENV}=plan.mjs reads the base-instructions snippets from commit ` +
        `${SNIPPET_BASELINE_COMMIT}, and git cannot read ${source} in ${REPO_DIR} (${detail}). ` +
        `Fetch that commit (a shallow clone lacks it), or run with ${PLAN_CLI_ENTRY_ENV}=docks-kit.`,
    );
  }
  return { text: shown.stdout, source };
}

/**
 * The shell text of a skill snippet, with its placeholders. In the `plan.mjs`
 * mode it comes from the skill file at `SNIPPET_BASELINE_COMMIT`; in the
 * `docks-kit` mode from the planned text in `snippets/`. `skillDir` is the
 * folder that replaces `<skill-dir>`.
 */
export function skillSnippet(kind: SkillSnippet): {
  readonly text: string;
  readonly skillDir: string;
} {
  const { skill, marker } = SNIPPETS[kind];
  if (PLAN_CLI_ENTRY === "plan.mjs") {
    const { text, source } = baselineSkillText(kind);
    return { text: bashBlock(text, source, marker), skillDir: skill };
  }
  const fixture = join(SNIPPETS_DIR, `${kind}.md`);
  return { text: bashBlock(readFileSync(fixture, "utf8"), fixture, marker), skillDir: skill };
}

/**
 * The variables that a skill snippet needs. In the `docks-kit` mode, a
 * `docks-kit` shim in `<root>/bin` runs the test entry, and PATH starts with
 * that folder; the `plan.mjs` mode needs nothing.
 */
export function snippetEnv(root: string): Readonly<Record<string, string>> {
  if (PLAN_CLI_ENTRY === "plan.mjs") return {};
  const bin = join(root, "bin");
  mkdirSync(bin, { recursive: true });
  const shim = join(bin, "docks-kit");
  const quote = (word: string): string => `'${word.replaceAll("'", `'\\''`)}'`;
  writeFileSync(shim, `#!/bin/sh\nexec ${quote(BUN_RUNTIME)} ${quote(cliEntry())} "$@"\n`);
  chmodSync(shim, 0o755);
  return { PATH: `${bin}${delimiter}${process.env["PATH"] ?? ""}` };
}

export type NormalizedPlan = {
  readonly body: string;
  readonly advice: ReadonlyArray<string>;
};

export type ParsedStep = {
  readonly display: string;
  readonly id: string;
  readonly task: string;
  readonly files: string;
  readonly depends: string;
  readonly effect: string;
  readonly status: string;
  readonly doneWhen: string;
};

export type ParsedPlan = {
  readonly steps: ReadonlyArray<ParsedStep>;
  readonly acceptance: ReadonlyArray<ReadonlyArray<string>>;
};

export type ReviewVerdict = { readonly kind: string; readonly verdict: string };

/** The pure functions that the record and property tests call. */
export type PlanRecords = {
  readonly normalizePlan: (
    text: string,
    options?: { readonly mode?: string; readonly marker?: string },
  ) => NormalizedPlan;
  readonly parsePlan: (text: string) => ParsedPlan;
  readonly parseReviewComment: (body: string) => ReviewVerdict | undefined;
};

async function importFunctions(
  file: string,
  names: ReadonlyArray<keyof PlanRecords>,
): Promise<Record<string, unknown>> {
  if (!existsSync(file)) {
    throw new Error(
      `${PLAN_CLI_ENTRY_ENV}=${PLAN_CLI_ENTRY} imports ${file}, which does not exist yet`,
    );
  }
  // PLAN_CLI_ENTRY selects the module at run time, and the docks-kit modules may not exist yet,
  // so a static import cannot work.
  const module: Record<string, unknown> = await import(pathToFileURL(file).href);
  for (const name of names) {
    if (typeof module[name] !== "function") throw new Error(`${file} does not export ${name}`);
  }
  return module;
}

/** The pure functions of the selected implementation. */
export async function planRecords(): Promise<PlanRecords> {
  if (PLAN_CLI_ENTRY === "plan.mjs") {
    const module = await importFunctions(PLAN_MJS, [
      "normalizePlan",
      "parsePlan",
      "parseReviewComment",
    ]);
    return module as PlanRecords;
  }
  const records = await importFunctions(join(PLAN_SOURCE_DIR, "records.ts"), [
    "normalizePlan",
    "parsePlan",
  ]);
  const reviews = await importFunctions(join(PLAN_SOURCE_DIR, "reviews.ts"), [
    "parseReviewComment",
  ]);
  return { ...records, ...reviews } as PlanRecords;
}
