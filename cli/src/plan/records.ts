/**
 * Plan records: parse, normalize, and render a plan body, the export provenance digest, the line diff, the status
 * derivation, and the advice that depends only on the body. Pure: no process, file, or GitHub access.
 */
import { createHash } from "node:crypto";

import { fail, type NamedLabel, type StatusSource } from "./types";

export const PLAN_STATUSES: ReadonlySet<string> = new Set([
  "drafting",
  "planned",
  "ongoing",
  "blocked",
]);
export const STEP_STATUSES: ReadonlySet<string> = new Set([
  "planned",
  "in-flight",
  "done",
  "blocked",
  "skipped",
]);
const STEP_EFFECTS: ReadonlySet<string> = new Set([
  "local",
  "probe",
  "production_access",
  "publish",
  "push",
  "release",
  "deploy",
]);
export const STEPS_HEADER = "| # | Id | Task | Files | Depends | Effect | Status | Done when |";
export const STEPS_SEPARATOR = "|---:|---|---|---|---|---|---|---|";
export const ACCEPTANCE_HEADER = "| ID | Command | Expected |";
export const ACCEPTANCE_SEPARATOR = "|---|---|---|";
export const PLAN_LABELS = [
  "plan",
  "plan:drafting",
  "plan:planned",
  "plan:ongoing",
  "plan:blocked",
] as const;
// A machine path points into a user or root home, a mount, a named temporary or runtime directory,
// a Windows drive, or a network share. URL routes, slash prose, and portable system paths such as
// /usr/bin/env or a bare /tmp do not match (#71). The match runs to the next space or delimiter.
const MACHINE_PATH =
  /(?<=^|[\s("'`[{=:;,>]|file:\/\/)(?:\/(?:home|Users|root|mnt|media|Volumes|run\/(?:user|media))\/[^\s/`'")]|\/(?:private\/)?(?:tmp|var\/tmp)\/[^\s/`'")]|\/(?:private\/)?var\/folders\/|[A-Za-z]:[\\/]|\\\\[\w.$-]+\\[\w.$-])[^\s`'"()[\]{}|,;]*/gm;
const SECTIONS = [
  "Goal",
  "Research",
  "Steps",
  "Acceptance",
  "Do not touch",
  "Open questions",
  "Verification Results",
];
export const MARKER = "<!-- plan-contract: v5 -->";
export const LEGACY_MARKER = "<!-- plan-contract: v4 -->";
// Budgets above the largest plan of this repository (41,607 characters, 17 steps, 22 comments). A plan that passes
// one gets the advice to split into child plans (E4).
const BODY_BYTE_BUDGET = 50_000;
const STEP_BUDGET = 20;
const COMMENT_BUDGET = 60;
const RETIRED_SECTIONS: ReadonlySet<string> = new Set(["review"]);
// A drafted plan holds this placeholder until research is published (#78).
export const RESEARCH_PLACEHOLDER = "_Not researched yet._";
// A plan-review pass covers the body that the reviewer read (#78). In a yolo plan, the Mode line and the
// delegation line record what the yolo invocation decided, not reviewed work, so they need no new round (#111).
const PLANNED_WORK_SECTIONS = ["Goal", "Research", "Steps", "Acceptance", "Do not touch"];
export const YOLO_DELEGATION_LINE =
  "Yolo: the user delegated every decision except the merge to the agent.";
const CONTRACT_MARKER = /^\s*<!-- plan-contract: v([345]) -->/i;
// A reopen that races GitHub's close can leave an issue closed with reason REOPENED, and GitHub then refuses every
// state change on it, also in the web page (#90). The derived status stays `unreadable`.
export const STUCK_ADVICE =
  "GitHub left this issue closed with reason REOPENED and refuses every state change; ask GitHub Support to repair it, and record step results in an issue comment until then";
// The Done when cell of a parent row (E1).
const CHILD_ROW = /^child #([1-9]\d*) finished$/;

/** One row of the Steps table, with its cells in table order. */
export interface Step {
  display: string;
  id: string;
  task: string;
  files: string;
  depends: string;
  effect: string;
  status: string;
  doneWhen: string;
}

export interface ParsedPlan {
  readonly sections: Map<string, string>;
  readonly malformedSteps: ReadonlyArray<{ readonly line: number; readonly cells: number }>;
  readonly steps: Array<Step>;
  readonly acceptance: Array<Array<string>>;
}

export interface NormalizeOptions {
  readonly mode?: string | undefined;
  readonly marker?: string;
}

export function blankFencedRegions(text: string): string {
  let fence: string | undefined;
  return text
    .split("\n")
    .map((line) => {
      const openingFence = fence ? undefined : /^ {0,3}(`{3,}|~{3,})/.exec(line);
      if (openingFence) fence = openingFence[1];
      else if (!fence) return line;
      else if (new RegExp(`^ {0,3}${fence[0]}{${fence.length},}[ \\t]*$`).test(line))
        fence = undefined;
      return line.replace(/[^\r]/g, " ");
    })
    .join("\n");
}

export function unquoteCode(value: string): string {
  return /^`[^`]+`$/.test(value) ? value.slice(1, -1) : value;
}

export const token = (value: string): string => unquoteCode(value.trim()).trim().toLowerCase();
export const stepId = (value: string): string => token(value).replaceAll("-", "_");
export const terminal = (status: string | undefined): boolean =>
  status === "done" || status === "skipped";
const trimBlankLines = (text: string): string =>
  text.replace(/^(?:[ \t]*\n)+/, "").replace(/\s+$/, "");

export function labelNames(labels: ReadonlyArray<NamedLabel> | undefined): Array<string> {
  return (labels ?? []).map((label) => token(label.name));
}

export const contractVersion = (body: string): number =>
  Number(CONTRACT_MARKER.exec(body)?.[1] ?? 0);

function sectionMap(body: string): Map<string, string> {
  const headings = [...blankFencedRegions(body).matchAll(/^ {0,3}##[ \t]+([^\n]+)$/gm)];
  const sections = new Map<string, string>();
  headings.forEach((heading, index) => {
    const title = heading[1].trim();
    const name = SECTIONS.find((known) => known.toLowerCase() === title.toLowerCase());
    if (!name && !RETIRED_SECTIONS.has(title.toLowerCase()))
      fail(
        `unknown section heading: ${title}; use only ${SECTIONS.join(", ")} or write it below an existing section as ### or plain text`,
      );
    const key = name ?? title;
    if (sections.has(key)) fail(`duplicate section heading: ${key}`);
    const start = (heading.index ?? 0) + heading[0].length;
    sections.set(key, trimBlankLines(body.slice(start, headings[index + 1]?.index ?? body.length)));
  });
  return sections;
}

// Split a table row on pipes that are not escaped; a pipe is escaped only when an odd
// run of backslashes precedes it, so `\\|` is a literal backslash followed by a delimiter.
function splitCells(row: string): Array<string> {
  const cells: Array<string> = [];
  let cell = "";
  let backslashes = 0;
  for (const char of row) {
    if (char === "|" && backslashes % 2 === 0) {
      cells.push(cell);
      cell = "";
    } else cell += char;
    backslashes = char === "\\" ? backslashes + 1 : 0;
  }
  cells.push(cell);
  if (cells.length > 1 && cells[0].trim() === "") cells.shift();
  if (cells.length > 1 && (cells.at(-1) ?? "").trim() === "") cells.pop();
  return cells;
}

interface Table {
  readonly lines: Array<string>;
  readonly start: number;
  readonly end: number;
  readonly rows: Array<Array<string>>;
}

function table(text: string, header: string): Table {
  const lines = text.split("\n");
  const scan = blankFencedRegions(text)
    .split("\n")
    .map((line) => (/^(?: {4}|\t)/.test(line) ? "" : line));
  const cells = (line: string): Array<string> => splitCells(line.trim()).map((cell) => cell.trim());
  const headerKey = cells(header).map(token).join("|");
  const start = scan.findIndex((line) => cells(line).map(token).join("|") === headerKey);
  if (start < 0) return { lines, start, end: start, rows: [] };
  const isSeparator = (line: string): boolean => cells(line).every((cell) => /^:?-+:?$/.test(cell));
  const first = start + 1 + (scan[start + 1] !== undefined && isSeparator(scan[start + 1]) ? 1 : 0);
  let end = first;
  while (end < scan.length && scan[end].trim().startsWith("|")) end++;
  return { lines, start, end, rows: lines.slice(first, end).map(cells) };
}

export const render = (sections: ReadonlyMap<string, string>, marker = MARKER): string =>
  `${marker}\n\n${SECTIONS.map((name) => `## ${name}\n\n${sections.get(name) ?? ""}`.trimEnd()).join("\n\n")}\n`;

export function replaceTable(
  sections: Map<string, string>,
  name: string,
  header: string,
  separator: string,
  rows: ReadonlyArray<ReadonlyArray<string>>,
): void {
  const parsed = table(sections.get(name) ?? "", header);
  if (parsed.start < 0) return;
  parsed.lines.splice(
    parsed.start,
    parsed.end - parsed.start,
    header,
    separator,
    ...rows.map((cells) => `| ${cells.join(" | ")} |`),
  );
  sections.set(name, parsed.lines.join("\n"));
}

/** The cells of a step in table order. */
export const stepCells = (step: Step): Array<string> => [
  step.display,
  step.id,
  step.task,
  step.files,
  step.depends,
  step.effect,
  step.status,
  step.doneWhen,
];

interface StepRef {
  readonly display: string;
  readonly id: string;
}

// Returns the step that a Depends entry names. An entry is a display, or a step id: normalizePlan keeps the id when
// the display holds a comma. A display match wins, as in normalizePlan. `steps` holds objects with display and id.
export const dependencyStep = <S extends StepRef>(
  steps: ReadonlyArray<S>,
  entry: string,
): S | undefined =>
  steps.find((step) => step.display === entry) ?? steps.find((step) => step.id === stepId(entry));

// The paths of a Files cell.
export const filePaths = (cell: string): Set<string> =>
  new Set(
    cell
      .split(",")
      .map((part) => unquoteCode(part.trim()).trim())
      .filter((part) => part && part !== "-"),
  );

// Steps that edit the same path need a Depends order, or parallel work collides (#78).
function sharedFilesAdvice(rows: ReadonlyArray<ReadonlyArray<string>>): Array<string> {
  const paths = rows.map((row) => filePaths(row[3]));
  const steps = rows.map(([display, id]) => ({ display, id }));
  const dependencies = new Map(
    rows.map((row) => [
      row[0],
      row[4] === "-"
        ? []
        : row[4]
            .split(",")
            .map((part) => dependencyStep(steps, part.trim())?.display ?? part.trim()),
    ]),
  );
  const reaches = (from: string, to: string, seen = new Set<string>()): boolean => {
    if (seen.has(from)) return false;
    seen.add(from);
    return (dependencies.get(from) ?? []).some((next) => next === to || reaches(next, to, seen));
  };
  const advice: Array<string> = [];
  rows.forEach((row, index) => {
    for (let other = index + 1; other < rows.length; other += 1) {
      const shared = [...paths[index]].filter((entry) => paths[other].has(entry));
      if (shared.length && !reaches(row[0], rows[other][0]) && !reaches(rows[other][0], row[0]))
        advice.push(
          `steps ${row[1]} and ${rows[other][1]} share ${shared.join(", ")} with no Depends link`,
        );
    }
  });
  return advice;
}

export function normalizePlan(
  text: string,
  { mode: explicitMode, marker = MARKER }: NormalizeOptions = {},
): { body: string; advice: Array<string> } {
  const advice: Array<string> = [];
  const cleaned = text
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((line) =>
      (line.includes("\u2014")
        ? line.replaceAll("\u2014", " - ").replace(/ {2,}/g, " ")
        : line
      ).trimEnd(),
    )
    .join("\n");
  const sections = sectionMap(cleaned);
  const goal = sections.get("Goal") ?? "";
  const goalLines = goal.split("\n");
  const modeLines = blankFencedRegions(goal)
    .split("\n")
    .map((line, index) => (/^ {0,3}Mode:/i.test(line) ? index : -1))
    .filter((index) => index >= 0);
  const mode = modeLines.length
    ? /^ {0,3}Mode:\s*(.*?)\s*$/i.exec(goalLines[modeLines[modeLines.length - 1]])
    : undefined;
  const value = (explicitMode ?? mode?.[1] ?? "").toLowerCase();
  const valid = ["plan-only", "plan-and-implement"].includes(value);
  if (!valid) advice.push("Mode defaulted to plan-only; implementation needs an explicit mode.");
  const goalWithoutMode = goalLines.filter((_, index) => !modeLines.includes(index)).join("\n");
  sections.set(
    "Goal",
    trimBlankLines(`${trimBlankLines(goalWithoutMode)}\n\nMode: ${valid ? value : "plan-only"}`),
  );
  const rows = table(sections.get("Steps") ?? "", STEPS_HEADER).rows;
  for (const row of rows) {
    if (row.length !== 8) continue;
    row[1] = stepId(row[1]);
    row[5] = token(row[5]);
    row[6] = token(row[6]);
    if (!STEP_EFFECTS.has(row[5])) advice.push(`unknown Effect: ${row[5]}`);
    if (!STEP_STATUSES.has(row[6])) advice.push(`unknown Status: ${row[6]}`);
    // A done or skipped step does not run again, so it needs no ask.
    if (row[5] !== "local" && !terminal(row[6]))
      advice.push(`step ${row[1]} Effect ${row[5]} needs an in-session ask before it runs.`);
  }
  const numbers = new Map(rows.filter((row) => row.length === 8).map((row) => [row[1], row[0]]));
  const displays = new Set(numbers.values());
  const dependency = (part: string): string => {
    const trimmed = part.trim();
    if (displays.has(trimmed)) return trimmed;
    // Depends is a comma-separated list, so a display that holds a comma cannot replace an id: the next pass would
    // split it into new parts, and the cell would change again.
    const display = numbers.get(stepId(trimmed));
    return display === undefined || display.includes(",") ? trimmed : display;
  };
  for (const row of rows)
    if (row.length === 8)
      row[4] = row[4] === "-" ? "-" : row[4].split(",").map(dependency).join(", ");
  advice.push(...sharedFilesAdvice(rows.filter((row) => row.length === 8)));
  replaceTable(sections, "Steps", STEPS_HEADER, STEPS_SEPARATOR, rows);
  replaceTable(
    sections,
    "Acceptance",
    ACCEPTANCE_HEADER,
    ACCEPTANCE_SEPARATOR,
    table(sections.get("Acceptance") ?? "", ACCEPTANCE_HEADER).rows,
  );
  const machinePaths = new Set(
    Array.from(cleaned.matchAll(MACHINE_PATH), ([match]) => match.replace(/[.:]+$/, "")),
  );
  for (const machinePath of machinePaths)
    advice.push(`body contains an absolute machine path: ${machinePath}`);
  return { body: render(sections, marker), advice };
}

export function parsePlan(text: string): ParsedPlan {
  const { body } = normalizePlan(text);
  const sections = sectionMap(body);
  const steps = table(sections.get("Steps") ?? "", STEPS_HEADER).rows;
  return {
    sections,
    malformedSteps: steps
      .map((row, index) => ({ line: index + 1, cells: row.length }))
      .filter((row) => row.cells !== 8),
    steps: steps
      .filter((row) => row.length === 8)
      .map(([display, id, task, files, depends, effect, status, doneWhen]) => ({
        display,
        id,
        task,
        files,
        depends,
        effect,
        status,
        doneWhen,
      })),
    acceptance: table(sections.get("Acceptance") ?? "", ACCEPTANCE_HEADER).rows,
  };
}

// Compare the whole section: research prose may quote the placeholder.
export function researchFilled(plan: ParsedPlan): boolean {
  const research = (plan.sections.get("Research") ?? "").trim();
  return research !== "" && research !== RESEARCH_PLACEHOLDER;
}

/** The advice lines that `printAdvice` of plan.mjs prints, without the `advice: ` prefix. */
export function adviceLines(
  text: string,
  status: string,
  extra: ReadonlyArray<string> = [],
  options: NormalizeOptions = {},
): Array<string> {
  const result = normalizePlan(text, options);
  if (status !== "drafting" && !researchFilled(parsePlan(text)))
    result.advice.push("Research is not filled after drafting.");
  return [...result.advice, ...extra];
}

// The trimmed live lines of Goal text with their indexes: a fenced or indented code line is example text.
export const liveGoalLines = (
  goal: string,
): Array<{ readonly index: number; readonly text: string }> =>
  blankFencedRegions(goal)
    .split("\n")
    .flatMap((line, index) => (/^(?: {4}|\t)/.test(line) ? [] : [{ index, text: line.trim() }]));
// The indexes of the live delegation lines of Goal text. A fenced or indented code line that quotes the delegation
// line is example text, so it stays reviewed work.
const liveDelegationLines = (goal: string): Set<number> =>
  new Set(
    liveGoalLines(goal).flatMap(({ index, text }) =>
      text === YOLO_DELEGATION_LINE ? [index] : [],
    ),
  );
// Normalization ends Goal with its one canonical Mode line. The comparison removes each live delegation line with the
// blank line that separated it from the text before it, the blank lines that a leading delegation line leaves at the
// start, and the blank lines at the end. Every other blank line and indentation stays, because example text can
// depend on them.
function goalWork(goal: string): string {
  const lines = goal.replace(/(?:^|\n)Mode: [^\n]*$/, "").split("\n");
  const live = liveDelegationLines(lines.join("\n"));
  const kept: Array<string> = [];
  let removedAtStart = false;
  lines.forEach((line, index) => {
    if (live.has(index)) {
      if (kept.length === 0) removedAtStart = true;
      else if (kept[kept.length - 1].trim() === "" && (lines[index + 1] ?? "").trim() === "")
        kept.pop();
    } else if (!(removedAtStart && kept.length === 0 && line.trim() === "")) kept.push(line);
  });
  return kept.join("\n").trimEnd();
}

export function plannedWorkChanges(before: ParsedPlan, after: ParsedPlan): Array<string> {
  const yoloGoal = liveDelegationLines(after.sections.get("Goal") ?? "").size > 0;
  return PLANNED_WORK_SECTIONS.filter((name) => {
    const was = before.sections.get(name) ?? "";
    const now = after.sections.get(name) ?? "";
    return name === "Goal" && yoloGoal ? goalWork(was) !== goalWork(now) : was !== now;
  });
}

export function bodyDigest(body: string): string {
  return createHash("sha256").update(body, "utf8").digest("hex");
}

export function changedLines(before: string, after: string): Array<string> {
  const left = before.split("\n");
  const right = after.split("\n");
  const lengths = Array.from({ length: left.length + 1 }, () => new Uint32Array(right.length + 1));
  for (let i = left.length - 1; i >= 0; i -= 1) {
    for (let j = right.length - 1; j >= 0; j -= 1) {
      lengths[i][j] =
        left[i] === right[j]
          ? lengths[i + 1][j + 1] + 1
          : Math.max(lengths[i + 1][j], lengths[i][j + 1]);
    }
  }
  const changes: Array<string> = [];
  let i = 0;
  let j = 0;
  while (i < left.length || j < right.length) {
    if (i < left.length && j < right.length && left[i] === right[j]) {
      i += 1;
      j += 1;
    } else if (i < left.length && (j === right.length || lengths[i + 1][j] >= lengths[i][j + 1])) {
      changes.push(`-${left[i]}`);
      i += 1;
    } else {
      changes.push(`+${right[j]}`);
      j += 1;
    }
  }
  return changes;
}

export function parseIssueNumber(value: string | undefined, kind = "plan issue"): number {
  const match = /^#?([1-9]\d*)$/.exec(String(value ?? ""));
  if (!match) return fail(`invalid ${kind}: ${value ?? "(missing)"}`);
  return Number(match[1]);
}

/** The flag values of `args`, read in pairs. A repeatable flag collects a list. */
export interface ParsedOptions {
  readonly values: ReadonlyMap<string, string>;
  readonly lists: ReadonlyMap<string, ReadonlyArray<string>>;
}

export function parseOptions(
  args: ReadonlyArray<string>,
  allowed: ReadonlySet<string>,
  repeatable: ReadonlySet<string> = new Set(),
): ParsedOptions {
  const values = new Map<string, string>();
  const lists = new Map<string, Array<string>>();
  for (let index = 0; index < args.length; index += 2) {
    const flag = args[index];
    const value = args[index + 1];
    if (!allowed.has(flag) || value === undefined || (!repeatable.has(flag) && values.has(flag))) {
      fail(`invalid option: ${flag ?? "(missing)"}`);
    }
    if (repeatable.has(flag)) {
      const list = lists.get(flag) ?? [];
      list.push(value);
      lists.set(flag, list);
    } else values.set(flag, value);
  }
  return { values, lists };
}

function statusFromLabels(labels: ReadonlyArray<NamedLabel>): string {
  const statuses = labelNames(labels)
    .filter((label) => label.startsWith("plan:") && PLAN_STATUSES.has(label.slice(5)))
    .map((label) => label.slice(5));
  if (statuses.length === 0) return "unlabelled";
  return statuses.length === 1 ? statuses[0] : "unreadable";
}

export function statusFromIssue(issue: StatusSource): string {
  if (String(issue.state).toUpperCase() !== "CLOSED") return statusFromLabels(issue.labels);
  switch (String(issue.stateReason).toUpperCase()) {
    case "COMPLETED":
      return "finished";
    case "NOT_PLANNED":
      return "retired";
    case "DUPLICATE":
      return "duplicate";
    default:
      return "unreadable";
  }
}

export function stuckClosed(issue: Pick<StatusSource, "state" | "stateReason">): boolean {
  return (
    String(issue.state).toUpperCase() === "CLOSED" &&
    String(issue.stateReason).toUpperCase() === "REOPENED"
  );
}

export function refuseStuck(
  issue: Pick<StatusSource, "state" | "stateReason"> & { readonly number: number },
): void {
  if (stuckClosed(issue))
    fail(
      `GitHub left plan #${issue.number} closed with reason REOPENED and refuses every state change; ask GitHub Support to repair it`,
    );
}

/** The `plan:` labels to remove, all but `plan:<target>` when a target is given. */
export function labelsToRemove(labels: ReadonlyArray<NamedLabel>, target?: string): Array<string> {
  return labels
    .map((label) => label.name)
    .filter(
      (label) => token(label).startsWith("plan:") && (!target || token(label) !== `plan:${target}`),
    );
}

// Whether a label is a phase label: `plan:` and a plan status.
export const isPhaseLabel = (name: string): boolean =>
  token(name).startsWith("plan:") && PLAN_STATUSES.has(token(name).slice(5));

export function headerStrip(
  issue: { readonly number: number; readonly title: string; readonly url: string },
  status: string,
): string {
  return `#${issue.number} · ${status} · ${issue.title} · ${issue.url}`;
}

// Each budget that a plan passes gets one advice line (E4).
export function budgetAdvice(body: string, plan: ParsedPlan, comments: number): Array<string> {
  const bytes = Buffer.byteLength(body, "utf8");
  const steps = plan.steps.length + plan.malformedSteps.length;
  const reasons: Array<string> = [];
  if (bytes > BODY_BYTE_BUDGET) reasons.push(`body is ${bytes} bytes (budget ${BODY_BYTE_BUDGET})`);
  if (steps > STEP_BUDGET) reasons.push(`${steps} steps (budget ${STEP_BUDGET})`);
  if (comments > COMMENT_BUDGET) reasons.push(`${comments} comments (budget ${COMMENT_BUDGET})`);
  return reasons.map((reason) => `split into child plans: ${reason}`);
}

// The helper cannot tell new scope from a repair, so each change of this shape on a started v5 plan gets the advice to
// move new work into a child plan: a new step, a new path in the Files cell of a step, or a changed Task or Done when.
export function scopeChanged(before: ParsedPlan, after: ParsedPlan): boolean {
  return after.steps.some((row) => {
    const was = before.steps.find((step) => step.id === row.id);
    if (!was) return true;
    const paths = filePaths(was.files);
    return (
      row.task !== was.task ||
      row.doneWhen !== was.doneWhen ||
      [...filePaths(row.files)].some((entry) => !paths.has(entry))
    );
  });
}

export function refuseMalformedSteps(plan: ParsedPlan): void {
  const [first] = plan.malformedSteps;
  if (first)
    fail(
      `Steps row ${first.line} has ${first.cells} cells; expected 8. Escape a literal pipe as \\| so the row is preserved.`,
    );
}

// The children that the Steps rows of a parent name: every row has Files `-` and Done when `child #<c> finished` (E1).
// Undefined for a plan without rows or with a row of its own landing work.
export function parentRowChildren(parsed: ParsedPlan): Array<number> | undefined {
  const named = parsed.steps.map((step) =>
    unquoteCode(step.files.trim()).trim() === "-"
      ? Number(CHILD_ROW.exec(step.doneWhen)?.[1])
      : Number.NaN,
  );
  return named.length > 0 && named.every((child) => !Number.isNaN(child)) ? named : undefined;
}

export function hasClosingKeyword(body: string, number: number, nameWithOwner: string): boolean {
  const repo = nameWithOwner.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(
    String.raw`\b(?:close|closes|closed|fix|fixes|fixed|resolve|resolves|resolved):?[ \t]+(?:#|${repo}#)${number}(?![A-Za-z0-9_])`,
    "i",
  ).test(body);
}
