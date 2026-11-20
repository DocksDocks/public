/**
 * The subcommands of `docks-kit plan`, one function each, and the dispatcher. Each port keeps the arguments, the
 * output lines, and the refusals of plan.mjs; a line that named `plan.mjs` names `docks-kit plan`.
 */
import path from "node:path";

import { Effect } from "effect";

import { baseBlob, checkoutState } from "./checkout";
import {
  associatedNodes,
  connectionNodes,
  createdLabelId,
  currentRepository,
  ghOutput,
  ghResult,
  graphql,
  graphqlData,
  ISSUE_SUMMARY_FIELDS,
  issueConnectionSelection,
  issueSummaries,
  linkSubIssue,
  ownedPreWriteIssue,
  parseJson,
  pullRequestNodes,
  readPullRequest,
  readRepositorySnapshot,
  readSnapshot,
  runGh,
  withBodyFile,
  writeIssueIfUnchanged,
  type PullRequestRead,
  type SnapshotOptions,
} from "./github";
import {
  ACCEPTANCE_HEADER,
  ACCEPTANCE_SEPARATOR,
  adviceLines,
  blankFencedRegions,
  bodyDigest,
  budgetAdvice,
  changedLines,
  contractVersion,
  dependencyStep,
  hasClosingKeyword,
  headerStrip,
  isPhaseLabel,
  labelsToRemove,
  LEGACY_MARKER,
  MARKER,
  normalizePlan,
  parentRowChildren,
  parseIssueNumber,
  parseOptions,
  parsePlan,
  PLAN_STATUSES,
  plannedWorkChanges,
  refuseMalformedSteps,
  refuseStuck,
  render,
  replaceTable,
  RESEARCH_PLACEHOLDER,
  researchFilled,
  scopeChanged,
  STEP_STATUSES,
  stepCells,
  stepId,
  STEPS_HEADER,
  STEPS_SEPARATOR,
  STUCK_ADVICE,
  stuckClosed,
  terminal,
  token,
  statusFromIssue as statusFromIssueOf,
  type NormalizeOptions,
  type ParsedPlan,
  type Step,
} from "./records";
import { argumentBytes, asBytes } from "./bytes";
import { reviewDirectory } from "./repository";
import {
  archiveKind,
  authorityEvents,
  cycleComments,
  grantState,
  landingRecord,
  parentRecord,
  recorded,
  reviewVerdicts,
  type GrantState,
} from "./reviews";
import { PlanFiles, PlanWaits, type PlanProcess, type PlanRepository } from "./services";
import {
  attempt,
  fail,
  field,
  GhError,
  GraphqlError,
  PlanRefusal,
  type Closer,
  type IssueSummary,
  type PlanFailure,
  type PlanIssue,
} from "./types";

export type PlanServices = PlanProcess | PlanRepository | PlanFiles | PlanWaits;

// `list` reads the newest plans first, as `gh issue list` did, so the 500-plan cap keeps the same plans.
const PLAN_LIST_ARGS =
  ',labels:["plan"],states:[OPEN,CLOSED],orderBy:{field:CREATED_AT,direction:DESC}';
const PLAN_LIST_LIMIT = 500;
// GitHub closes a plan for a merged pull request a while after the merge. `archive` reads an open plan up to
// CLOSE_WAIT_READS times until it reads closed, and `reopen` until GitHub records the close by that pull request.
// Between reads they pause for the next entry of CLOSE_WAIT_PAUSES_MS, and the last entry repeats: about 60 s in all.
// Once the close shows, `reopen` waits REOPEN_SETTLE_MS before it reads the plan again and writes. A reopen 1 s after
// GitHub closed a plan for a merged pull request raced that close and left the issue stuck closed with reason
// REOPENED (#90).
const CLOSE_WAIT_PAUSES_MS = [250, 500, 1000, 2000];
const CLOSE_WAIT_READS = 34;
const REOPEN_SETTLE_MS = 10_000;
// A child plan that closed as completed, not planned, or duplicate runs no more work.
const CHILD_TERMINAL_STATUSES: ReadonlySet<string> = new Set(["finished", "retired", "duplicate"]);
const USAGE =
  "usage: docks-kit plan <new|show|export|edit|status|step|list|archive|retire|reopen> ...";
const FILE_OPTION: ReadonlySet<string> = new Set(["--file"]);
// The provenance file of an export is the plan file with this suffix.
const ORIGIN_SUFFIX = Buffer.from(".origin");

/** Write domain output to stdout as is. */
const writeOut = (text: string | Uint8Array): Effect.Effect<void> =>
  Effect.sync(() => {
    process.stdout.write(text);
  });
const printLine = (line: string): Effect.Effect<void> => writeOut(`${line}\n`);
const printErrorLine = (line: string): Effect.Effect<void> =>
  Effect.sync(() => {
    process.stderr.write(`${line}\n`);
  });

const refuse = (message: string): PlanRefusal => new PlanRefusal({ message });

const printAdvice = Effect.fn("plan.printAdvice")(function* (
  text: string,
  status: string,
  extra: ReadonlyArray<string> = [],
  options: NormalizeOptions = {},
) {
  for (const message of yield* attempt(() => adviceLines(text, status, extra, options)))
    yield* printLine(`advice: ${message}`);
});

const isClosed = (issue: Pick<PlanIssue, "state">): boolean =>
  String(issue.state).toUpperCase() === "CLOSED";

/** A plan issue with its parsed body, its derived status, and the acting viewer of a write read. */
interface PlanRead {
  readonly issue: PlanIssue;
  readonly parsed: ParsedPlan;
  readonly status: string;
  readonly labelIds: ReadonlyMap<string, string | null> | undefined;
  readonly login: string | undefined;
  readonly viewerId: string | undefined;
}

const readPlanIssue = Effect.fn("plan.readPlanIssue")(function* (
  value: string | undefined,
  forWrite = false,
  connections: SnapshotOptions = {},
) {
  const number = yield* attempt(() => parseIssueNumber(value));
  const { issue, login, viewerId, labelIds } = yield* readSnapshot(number, {
    acting: forWrite,
    ...connections,
  });
  if (!contractVersion(issue.body))
    return yield* refuse(`unreadable plan contract: #${issue.number}`);
  if (forWrite) {
    const owners = issue.assignees.map((owner) => owner.login);
    const foreign = owners.find((owner) => owner !== login);
    if (foreign) return yield* refuse(`plan #${issue.number} is owned by ${foreign}`);
    // The write claims an unassigned plan for the acting viewer.
    if (!owners.length) issue.claimantId = viewerId;
  }
  const parsed = yield* attempt(() => parsePlan(issue.body));
  const read: PlanRead = {
    issue,
    parsed,
    status: statusFromIssueOf(issue),
    labelIds,
    login,
    viewerId,
  };
  return read;
});

function workStarted(issue: PlanIssue, recordStatus: string): boolean {
  if (recordStatus !== "drafting" && recordStatus !== "planned") return true;
  return issue.history.some((label) => token(label.name) === "plan:ongoing");
}

// A started v3 or v4 plan keeps the partial-pull-request flow, so each write keeps it at v4. Every other write
// writes v5 (E2).
const writeMarker = (issue: PlanIssue, status: string): string =>
  contractVersion(issue.body) === 5 || !workStarted(issue, status) ? MARKER : LEGACY_MARKER;

// A child plan needs a parent that the acting login owns alone and that is still open as a plan (E1).
function openPlanOf(issue: PlanIssue, login: string | undefined): boolean {
  return (
    contractVersion(issue.body) > 0 &&
    String(issue.state).toUpperCase() === "OPEN" &&
    PLAN_STATUSES.has(statusFromIssueOf(issue)) &&
    issue.assignees.length === 1 &&
    issue.assignees[0].login === login
  );
}

function describeCloser(closer: Closer | null | undefined): string {
  if (closer?.__typename === "PullRequest") return closer.url;
  if (closer?.__typename === "Commit") return `commit ${closer.oid}`;
  return "an unknown closer";
}

const exportPlan = Effect.fn("plan.export")(function* (args: ReadonlyArray<string>) {
  if (args.length !== 1) return yield* refuse("export requires one issue");
  const { issue } = yield* readPlanIssue(args[0]);
  // A byte string, one character per byte, so a folder whose path is not UTF-8 keeps its bytes.
  const directory = yield* reviewDirectory();
  const files = yield* PlanFiles;
  yield* files.ensurePrivateDirectory(Buffer.from(directory, "latin1"));
  const destination = path.join(directory, `plan-${issue.number}.md`);
  const destinationBytes = Buffer.from(destination, "latin1");
  const originBytes = Buffer.from(`${destination}.origin`, "latin1");
  yield* files.writeFile(destinationBytes, issue.body, 0o600);
  yield* files.writeFile(originBytes, `${bodyDigest(issue.body)}\n`, 0o600);
  yield* files.chmod(destinationBytes, 0o600);
  yield* files.chmod(originBytes, 0o600);
  yield* writeOut(Buffer.from(`${destination}\n`, "latin1"));
});

/**
 * The recorded digest of `<planFile>.origin`, or undefined when the file does not exist. `planFile` is the text of
 * the path for messages, and `planBytes` its bytes.
 */
const readOrigin = Effect.fn("plan.readOrigin")(function* (planFile: string, planBytes: Buffer) {
  const source = `${planFile}.origin`;
  const files = yield* PlanFiles;
  const read = yield* Effect.result(files.readFile(Buffer.concat([planBytes, ORIGIN_SUFFIX])));
  if (read._tag === "Failure") {
    if (read.failure.code === "ENOENT") return undefined;
    return yield* refuse(`unreadable export provenance: ${source}`);
  }
  const digest = read.success.trim();
  if (!/^[0-9a-f]{64}$/.test(digest))
    return yield* refuse(`unreadable export provenance: ${source}`);
  return digest;
});

const createPlan = Effect.fn("plan.new")(function* (args: ReadonlyArray<string>) {
  const options = yield* attempt(() =>
    parseOptions(
      args,
      new Set(["--title", "--goal", "--mode", "--label", "--parent"]),
      new Set(["--label"]),
    ),
  );
  const title = options.values.get("--title");
  const goal = options.values.get("--goal");
  const mode = options.values.get("--mode");
  const parentValue = options.values.get("--parent");
  if (!title?.trim() || goal === undefined || !goal.trim())
    return yield* refuse("new requires --title and --goal");
  const extras = options.lists.get("--label") ?? [];
  for (const label of extras)
    if (/^plan(?::|$)/i.test(label)) return yield* refuse(`reserved label namespace: ${label}`);
  const parent =
    parentValue === undefined
      ? undefined
      : yield* attempt(() => parseIssueNumber(parentValue, "parent issue"));
  const snapshotOptions = { acting: true, labelLookup: true };
  const { labelIds } =
    parent === undefined
      ? yield* readRepositorySnapshot(snapshotOptions)
      : yield* readSnapshot(parent, snapshotOptions).pipe(
          Effect.filterOrFail(
            (snapshot) => openPlanOf(snapshot.issue, snapshot.login),
            () => refuse(`parent #${parent} is not an open plan`),
          ),
        );
  const { nameWithOwner } = yield* currentRepository();
  for (const [label, id] of labelIds ?? [])
    if (id === null) yield* runGh(["label", "create", label, "--repo", nameWithOwner]);
  const goalLines = goal.split("\n");
  const goalText = blankFencedRegions(goal)
    .split("\n")
    .map((masked, index) => {
      const line = goalLines[index];
      return /^ {0,3}##[ \t]/.test(masked) ? line.replace(/^( {0,3})##/, "$1###") : line;
    })
    .join("\n");
  const source = `## Goal\n${goalText}\n## Research\n${RESEARCH_PLACEHOLDER}\n## Steps\n${STEPS_HEADER}\n${STEPS_SEPARATOR}\n## Acceptance\n${ACCEPTANCE_HEADER}\n${ACCEPTANCE_SEPARATOR}`;
  const { body } = yield* attempt(() => normalizePlan(source, { mode }));
  let linkByRest = false;
  const url = yield* withBodyFile(body, (file) =>
    Effect.gen(function* () {
      const argv = [
        "issue",
        "create",
        "--title",
        title.replaceAll("\u2014", " - ").replace(/ {2,}/g, " ").trim(),
        "--body-file",
        file,
        "--label",
        "plan",
        "--label",
        "plan:drafting",
        "--assignee",
        "@me",
        ...extras.flatMap((label) => ["--label", label]),
        "--repo",
        nameWithOwner,
      ];
      if (parent === undefined) return (yield* runGh(argv)).trim();
      const withParent = [...argv, "--parent", String(parent)];
      const result = yield* ghResult(withParent);
      // gh refuses an unknown flag before it creates anything, so the plain create runs once.
      linkByRest = result.status !== 0 && /unknown flag: --parent\b/.test(result.stderr);
      return (linkByRest ? yield* runGh(argv) : yield* ghOutput(withParent, result)).trim();
    }),
  );
  const number = /\/issues\/([1-9]\d*)\/?$/.exec(url)?.[1];
  if (!number)
    return yield* new GhError({ message: "gh issue create returned an invalid issue URL" });
  if (linkByRest && parent !== undefined) yield* linkSubIssue(parent, Number(number));
  yield* printLine(`plan created: #${number} ${url}`);
  yield* printAdvice(source, "drafting", [], { mode });
});

/** The `grant:` state of a plan, with the parent read when the grant rule needs it. */
const readGrantState = Effect.fn("plan.readGrantState")(function* (issue: PlanIssue, goal: string) {
  const { nameWithOwner } = yield* currentRepository();
  const first = grantState(issue, goal, nameWithOwner);
  if (!("readParent" in first)) return first;
  const parentRead = yield* Effect.result(readSnapshot(first.readParent, { comments: true }));
  const second = grantState(
    issue,
    goal,
    nameWithOwner,
    parentRead._tag === "Failure"
      ? { kind: "unreadable" }
      : { kind: "read", events: authorityEvents(parentRead.success.issue) },
  );
  const state: GrantState = "readParent" in second ? { line: "grant: none", advice: [] } : second;
  return state;
});

const showPlan = Effect.fn("plan.show")(function* (args: ReadonlyArray<string>) {
  const [value, ...flags] = args;
  if (!value || flags.length > 1 || flags.some((flag) => flag !== "--body"))
    return yield* refuse("show requires an issue and optional --body");
  const connections = { comments: true, closure: true, children: true, parent: true };
  const { issue, parsed, status } = yield* readPlanIssue(value, false, connections);
  const reviews = reviewVerdicts(issue);
  const grant = yield* readGrantState(issue, parsed.sections.get("Goal") ?? "");
  const metadata = [
    headerStrip(issue, status),
    `reviews: plan=${reviews.plan ?? "none"} code=${reviews.code ?? "none"}`,
    grant.line,
    ...issue.children.map(
      (child) => `child #${child.number} · ${statusFromIssueOf(child)} · ${child.title}`,
    ),
  ].join("\n");
  if (flags.length) {
    yield* printErrorLine(metadata);
    yield* writeOut(issue.body);
    return;
  }
  yield* printLine(metadata);
  const unfinished =
    status === "finished" ? parsed.steps.find((step) => !terminal(step.status)) : undefined;
  const extra = unfinished
    ? [
        `plan is closed as completed while step ${unfinished.id} is ${unfinished.status}; closed by ${describeCloser(issue.closer)}; reopen the issue if work remains`,
      ]
    : [];
  if (stuckClosed(issue)) extra.push(STUCK_ADVICE);
  if (status === "finished") extra.push(...closedChildAdvice(issue, parsed));
  extra.push(...budgetAdvice(issue.body, parsed, issue.comments.length), ...grant.advice);
  yield* printAdvice(issue.body, status, extra);
});

const childStatuses = (children: ReadonlyArray<IssueSummary>): Map<number, string> =>
  new Map(children.map((child) => [child.number, statusFromIssueOf(child)]));

// The children that the rows of a parent name, for the parent recovery rules. They apply only while the latest trusted
// archive record says that the plan was archived as a parent: a plan archived with its landing pull request, or one
// that no archive record names, landed or closed without the child proof, so these rules would misread it.
const parentRecoveryChildren = (issue: PlanIssue, parsed: ParsedPlan): Array<number> | undefined =>
  archiveKind(issue) === "parent" ? parentRowChildren(parsed) : undefined;

// Whether no named child is linked and finished. `statuses` maps each linked child to its status.
const noNamedChildFinished = (
  named: ReadonlyArray<number>,
  statuses: ReadonlyMap<number, string>,
): boolean => !named.some((child) => statuses.get(child) === "finished");

// The open work that `archive` reopens safely on a plan closed as completed (see openWork): a linked child that is not
// terminal and, on a parent that no merged pull request closed, a row that names a child that is not linked or rows
// that name no finished child.
function closedChildAdvice(issue: PlanIssue, parsed: ParsedPlan): Array<string> {
  const recovery = `run archive ${issue.number} again to reopen it safely`;
  const statuses = childStatuses(issue.children);
  const named = parentRecoveryChildren(issue, parsed);
  const advice: Array<string> = [];
  for (const [child, status] of statuses)
    if (!CHILD_TERMINAL_STATUSES.has(status))
      advice.push(`plan is closed as completed while child #${child} is ${status}; ${recovery}`);
  if (!named) return advice;
  for (const child of named)
    if (!statuses.has(child))
      advice.push(
        `plan names child #${child}, which is not linked; relink it or edit the row; ${recovery}`,
      );
  if (noNamedChildFinished(named, statuses))
    advice.push(`plan is closed as completed but no child finished; ${recovery}`);
  return advice;
}

// The edit rules once work started: each step keeps its id, display, Depends, Effect, and Status, and a new step
// appends as planned on an open plan.
function refuseFrozenChanges(
  issue: PlanIssue,
  parsed: ParsedPlan,
  incoming: ReadonlyArray<Step>,
): void {
  refuseMalformedSteps(parsed);
  const frozen = (detail: string): never =>
    fail(`step state is frozen once work starts: ${detail}`);
  const ids = new Set(parsed.steps.map((row) => row.id));
  const last = incoming.reduce((position, row, index) => (ids.has(row.id) ? index : position), -1);
  const frozenKeys = ["id", "display", "depends", "effect", "status"] as const;
  for (const row of parsed.steps) {
    const matches = incoming.filter((next) => next.id === row.id);
    if (matches.length !== 1) frozen(`step ${row.id} removed or duplicated`);
    for (const key of frozenKeys)
      if (matches[0][key] !== row[key]) frozen(`step ${row.id} ${key} changed`);
  }
  incoming.forEach((row, index) => {
    if (!ids.has(row.id) && (isClosed(issue) || row.status !== "planned" || index < last))
      frozen(`new step ${row.id} must append as planned on an open plan`);
  });
}

const editPlan = Effect.fn("plan.edit")(function* (args: ReadonlyArray<string>) {
  const [value, ...flags] = args;
  const file = (yield* attempt(() => parseOptions(flags, FILE_OPTION))).values.get("--file");
  if (!file) return yield* refuse("edit requires an issue and --file");
  // The bytes of the path from the command line; `file` is its text for messages.
  const flagBytes = yield* argumentBytes(flags);
  if (!flagBytes.ok) return yield* refuse(flagBytes.cause);
  const fileBytes = Buffer.from(
    (yield* attempt(() => parseOptions(flagBytes.value, FILE_OPTION))).values.get("--file") ??
      asBytes(file),
    "latin1",
  );
  const originBytes = Buffer.concat([fileBytes, ORIGIN_SUFFIX]);
  const { issue, parsed, status } = yield* readPlanIssue(value, true, {
    history: true,
    comments: true,
  });
  const origin = yield* readOrigin(file, fileBytes);
  if (!origin)
    return yield* refuse(
      `missing export provenance: ${file}.origin does not exist; run \`docks-kit plan export ${issue.number}\` and re-apply the edit`,
    );
  if (origin !== bodyDigest(issue.body))
    return yield* refuse(
      `stale export: ${file} was exported from a superseded body; run \`docks-kit plan export ${issue.number}\` and re-apply the edit`,
    );
  const files = yield* PlanFiles;
  const started = workStarted(issue, status);
  const source = yield* files.readFile(fileBytes);
  const { body } = yield* attempt(() =>
    normalizePlan(source, { marker: writeMarker(issue, status) }),
  );
  const incomingPlan = yield* attempt(() => parsePlan(body));
  const incoming = incomingPlan.steps;
  yield* attempt(() => refuseMalformedSteps(incomingPlan));
  const seenIds = new Set<string>();
  for (const row of incoming) {
    if (seenIds.has(row.id))
      return yield* refuse(`duplicate step id after normalization: ${row.id}`);
    seenIds.add(row.id);
  }
  if (started) yield* attempt(() => refuseFrozenChanges(issue, parsed, incoming));
  yield* files.writeFile(fileBytes, body);
  yield* writeIssueIfUnchanged(issue, { body });
  // Refresh provenance only after the remote write, so a failed write can be retried with the same file (#78).
  yield* files.writeFile(originBytes, `${bodyDigest(body)}\n`, 0o600);
  yield* files.chmod(originBytes, 0o600);
  const changes = changedLines(issue.body, body);
  yield* printLine(headerStrip(issue, status));
  yield* printLine(`changed: ${changes.length} line(s)`);
  for (const line of changes) yield* printLine(line);
  const changedWork =
    reviewVerdicts(issue).plan === "pass" ? plannedWorkChanges(parsed, incomingPlan) : [];
  const extra = changedWork.length
    ? [
        `plan review passed before this edit; changed sections: ${changedWork.join(", ")}; review all such edits in one plan-review round before code that depends on them or the next code-review round`,
      ]
    : [];
  if (started && contractVersion(issue.body) === 5 && scopeChanged(parsed, incomingPlan))
    extra.push(
      `check for new scope; move new work into a child plan (new --parent ${issue.number})`,
    );
  extra.push(...budgetAdvice(body, incomingPlan, issue.comments.length));
  yield* printAdvice(source, status, extra);
});

const setPlanStatus = Effect.fn("plan.status")(function* (args: ReadonlyArray<string>) {
  const [value, raw, ...flags] = args;
  const target = token(raw ?? "");
  const reason = (yield* attempt(() => parseOptions(flags, new Set(["--reason"])))).values.get(
    "--reason",
  );
  if (!PLAN_STATUSES.has(target)) return yield* refuse(`unknown plan status: ${target}`);
  if (target === "blocked" && (!reason?.trim() || /[\r\n]/.test(reason)))
    return yield* refuse("blocked status requires --reason as single-line text");
  const { issue, parsed, status, labelIds } = yield* readPlanIssue(value, true, {
    history: true,
    labelLookup: true,
  });
  if (isClosed(issue))
    return yield* refuse(`plan #${issue.number} is closed; status applies to open plans`);
  if (workStarted(issue, status) && !["ongoing", "blocked"].includes(target))
    return yield* refuse(`illegal plan status transition: ${status} -> ${target}`);
  if (["planned", "ongoing"].includes(target) && !researchFilled(parsed))
    return yield* refuse(`status ${target} requires a filled Research section`);
  const content = (parsed.sections.get("Open questions") ?? "").replace(
    /^Blocked:[^\n]*\n?\s*/i,
    "",
  );
  parsed.sections.set(
    "Open questions",
    `${target === "blocked" ? `Blocked: ${reason}\n\n` : ""}${content}`.trim(),
  );
  const source = render(parsed.sections);
  const { body } = yield* attempt(() =>
    normalizePlan(source, { marker: writeMarker(issue, status) }),
  );
  yield* writeIssueIfUnchanged(issue, {
    body,
    add: `plan:${target}`,
    remove: labelsToRemove(issue.labels, target),
    ...(labelIds === undefined ? {} : { labelIds }),
  });
  yield* printLine(`plan #${issue.number} status: ${status} -> ${target}`);
  yield* printAdvice(issue.body, target);
});

const setStepStatus = Effect.fn("plan.step")(function* (args: ReadonlyArray<string>) {
  if (args.length !== 3) return yield* refuse("step requires an issue, step id, and status");
  const [value, id, raw] = args;
  const target = token(raw);
  const { issue, parsed, status } = yield* readPlanIssue(value, true);
  if (!STEP_STATUSES.has(target)) return yield* refuse(`unknown step status: ${target}`);
  if (status !== "ongoing" && status !== "finished")
    return yield* refuse(`plan status is ${status}; expected ongoing`);
  yield* attempt(() => refuseMalformedSteps(parsed));
  const row = parsed.steps.find((step) => step.id === stepId(id));
  if (!row) return yield* refuse(`unknown step id: ${id}`);
  const current = row.status;
  if (status === "finished" && !terminal(target))
    return yield* refuse(
      `plan #${issue.number} is finished; reopen it before moving step ${row.id} to ${target}`,
    );
  if (status !== "finished" && terminal(current) && current !== target)
    return yield* refuse(`illegal step status transition: ${current} -> ${target}`);
  const advice = (yield* attempt(() => normalizePlan(issue.body))).advice.filter((message) =>
    message.startsWith("Mode defaulted"),
  );
  const unfinished = row.depends
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part !== "-" && !terminal(dependencyStep(parsed.steps, part)?.status));
  if (["in-flight", "done"].includes(target) && unfinished.length)
    advice.push(`step ${row.id} has unfinished dependency ${unfinished.join(", ")}`);
  row.status = target;
  replaceTable(
    parsed.sections,
    "Steps",
    STEPS_HEADER,
    STEPS_SEPARATOR,
    parsed.steps.map(stepCells),
  );
  const source = render(parsed.sections);
  const { body } = yield* attempt(() =>
    normalizePlan(source, { marker: writeMarker(issue, status) }),
  );
  yield* writeIssueIfUnchanged(issue, { body });
  yield* printLine(`plan #${issue.number} step ${row.id}: ${current} -> ${target}`);
  yield* printAdvice(source, status, advice);
});

const listPlans = Effect.fn("plan.list")(function* (args: ReadonlyArray<string>) {
  const selected = (yield* attempt(() => parseOptions(args, new Set(["--status"])))).values.get(
    "--status",
  );
  // One GraphQL query per 100 plans; like every snapshot, it names the repository through gh's {owner}/{repo}.
  const query = `query($owner:String!,$name:String!,$after:String){repository(owner:$owner,name:$name){${issueConnectionSelection("issues", ISSUE_SUMMARY_FIELDS, PLAN_LIST_ARGS, true)}}}`;
  const page = (variables: Readonly<Record<string, string>> = {}) =>
    graphql(query, variables).pipe(
      Effect.map((data) => field(field(data, "repository"), "issues")),
    );
  const nodes = yield* connectionNodes(
    yield* page(),
    "plan issues",
    (after) => page({ after }),
    PLAN_LIST_LIMIT,
  );
  const issues = yield* issueSummaries(nodes.slice(0, PLAN_LIST_LIMIT), "plan issues");
  issues.sort(
    (a, b) =>
      Number(a.state.toUpperCase() === "CLOSED") - Number(b.state.toUpperCase() === "CLOSED") ||
      a.number - b.number,
  );
  for (const issue of issues) {
    const status = statusFromIssueOf(issue);
    if (!selected || status === token(selected))
      yield* printLine(`${status}\t#${issue.number}\t${issue.title}`);
  }
  if (issues.length >= PLAN_LIST_LIMIT)
    yield* printLine("advice: list stopped at 500 plans; more plans may exist");
});

// GitHub closes a plan for its merged pull request a while after the merge, so an archive takes the plan open and
// ongoing as well as closed and finished. A plan finishes only after each of its child plans closed (E1).
function refuseUnarchivable(plan: PlanRead, codeReview = true): void {
  const { issue, parsed, status } = plan;
  refuseStuck(issue);
  if (status !== (isClosed(issue) ? "finished" : "ongoing"))
    fail(`archive requires ongoing or finished status, found ${status}`);
  refuseMalformedSteps(parsed);
  if (parsed.steps.length === 0) fail("archive refused: no Steps rows parsed");
  const unfinished = parsed.steps.find((row) => !terminal(row.status));
  if (unfinished) fail(`archive refused: non-terminal step ${unfinished.id}`);
  if (codeReview && reviewVerdicts(issue).code !== "pass")
    fail("archive requires Code-review: pass");
  const openChild = issue.children.find(
    (child) => !CHILD_TERMINAL_STATUSES.has(statusFromIssueOf(child)),
  );
  if (openChild)
    fail(`archive refused: child #${openChild.number} is ${statusFromIssueOf(openChild)}`);
}

interface ChildWork {
  readonly number: number;
  readonly status: string;
}

// The first child of the plan that has a new status in a fresh read: a new child, a child with another status, or a
// child that is no longer linked (status `unlinked`). Undefined when the children are as the snapshot read them.
const changedChild = Effect.fn("plan.changedChild")(function* (issue: PlanIssue) {
  const before = childStatuses(issue.children);
  const now = childStatuses((yield* readSnapshot(issue.number, { children: true })).issue.children);
  const number = [...now.keys(), ...before.keys()].find(
    (child) => before.get(child) !== now.get(child),
  );
  const work: ChildWork | undefined =
    number === undefined ? undefined : { number, status: now.get(number) ?? "unlinked" };
  return work;
});

// A rerun cannot take a close back, so the close runs only while the plan keeps the snapshot body, no other owner, and
// the snapshot children with their statuses: a child that reopened or a new child is open work.
const refuseChangedBeforeClose = Effect.fn("plan.refuseChangedBeforeClose")(function* (
  plan: PlanRead,
) {
  const current = yield* ownedPreWriteIssue(plan.issue.number, plan.login);
  if (current.body !== plan.issue.body || (yield* changedChild(plan.issue)))
    return yield* refuse("plan issue changed remotely; re-read and retry");
});

// The open work of a plan that reads closed as completed, as one child and its status, or undefined when it shows none.
// A child that is not terminal is open work on every plan. On a plan archived as a parent, after archive's own close,
// `snapshot` holds the children of its pre-close read, and a child that is new, a child that is no longer linked
// (status `unlinked`), or child rows that name no finished child count too. On such a plan without a snapshot, a row
// that names a child that is not linked, and rows that name no finished child, count too.
function openWork(
  { issue, parsed }: PlanRead,
  snapshot?: ReadonlyArray<IssueSummary>,
): ChildWork | undefined {
  const now = childStatuses(issue.children);
  const before = snapshot && childStatuses(snapshot);
  const named = parentRecoveryChildren(issue, parsed);
  const work = (number: number): ChildWork => ({ number, status: now.get(number) ?? "unlinked" });
  const open = [...now.keys()].find(
    (child) =>
      !CHILD_TERMINAL_STATUSES.has(now.get(child) ?? "") || (named && before?.has(child) === false),
  );
  if (open !== undefined) return work(open);
  if (!named) return undefined;
  const unlinked = (before ? [...before.keys()] : named).find((child) => !now.has(child));
  if (unlinked !== undefined) return work(unlinked);
  if (noNamedChildFinished(named, now))
    return work(named.find((child) => before?.get(child) === "finished") ?? named[0]);
  return undefined;
}

// The read of a plan for archive's recovery and close checks.
const archiveConnections: SnapshotOptions = {
  comments: true,
  children: true,
  closure: true,
  labelLookup: true,
};

// Archive found open `work` on `observed`, a plan that it closed or that reads closed as completed. It reopens the plan
// as `reopen` does, after the settle wait, while the settled read still shows the same close and open work, and then
// refuses with that work. A plan that someone reopened gets no write.
const reopenForOpenWork = Effect.fn("plan.reopenForOpenWork")(function* (
  observed: PlanRead,
  work: ChildWork,
  snapshot?: ReadonlyArray<IssueSummary>,
) {
  const { number } = observed.issue;
  if (isClosed(observed.issue))
    yield* settleAndReopen({
      observed,
      read: () => readPlanIssue(String(number), true, archiveConnections),
      command: "archive",
      stillReopenable: (plan) =>
        attempt(() => {
          refuseStuck(plan.issue);
          return openWork(plan, snapshot) !== undefined;
        }),
      comment: `Reopened: child #${work.number} changed while plan #${number} closed; work continues.`,
    });
  return yield* refuse(`archive refused: child #${work.number} is ${work.status}`);
});

// A close cannot see a child change that races it, so archive reads the plan again after its own close and compares
// the children with `snapshot`, the children of its pre-close read.
const checkAfterOwnClose = Effect.fn("plan.checkAfterOwnClose")(function* (
  number: number,
  snapshot: ReadonlyArray<IssueSummary>,
) {
  const after = yield* readPlanIssue(String(number), true, archiveConnections);
  const work = openWork(after, snapshot);
  if (work) return yield* reopenForOpenWork(after, work, snapshot);
  if (!isClosed(after.issue))
    return yield* refuse("plan issue changed remotely; re-read and retry");
});

// A parent holds one row per child plan, with Files `-` and Done when `child #<c> finished`, and every child has its
// row (E1). Any other plan with children landed work of its own, so it needs the proof of `--pr`.
function isParentPlan({ issue, parsed }: PlanRead): boolean {
  const children = new Set(issue.children.map((child) => child.number));
  const named = parentRowChildren(parsed);
  return (
    named !== undefined &&
    named.every((child) => children.has(child)) &&
    new Set(named).size === named.length &&
    named.length === children.size
  );
}

// An unassigned plan is claimed before archive closes it, so that the record of the close is a trusted comment when the
// read after the close needs it.
const claimBeforeClose = Effect.fn("plan.claimBeforeClose")(function* (plan: PlanRead) {
  if (plan.issue.claimantId === undefined) return;
  yield* writeIssueIfUnchanged(plan.issue);
  plan.issue.claimantId = undefined;
});

// Post the archive `record` on a plan that archive did not close itself, unless a rerun posted it already.
const postRecordOnce = Effect.fn("plan.postRecordOnce")(function* (plan: PlanRead, record: string) {
  if (recorded(plan.issue, record)) return;
  const { id } = yield* ownedPreWriteIssue(plan.issue.number, plan.login);
  yield* graphqlData([
    "-f",
    "query=mutation($issue:ID!,$body:String!){addComment(input:{subjectId:$issue,body:$body}){clientMutationId}}",
    "-f",
    `issue=${id}`,
    "-f",
    `body=${record}`,
  ]);
});

// The archive of a parent plan: its work landed through its child plans, so a child that closed as completed is the
// landing proof, and the parent needs no pull request and no code review (E1). A plan that reads closed as completed
// while its children show open work, such as after a failed read that followed the close, is reopened safely. The
// close posts the parent archive record.
const archiveParent = Effect.fn("plan.archiveParent")(function* (number: number) {
  const plan = yield* readPlanIssue(String(number), true, archiveConnections);
  const work = plan.status === "finished" ? openWork(plan) : undefined;
  if (work) return yield* reopenForOpenWork(plan, work);
  const { children } = plan.issue;
  if (children.length === 0) return yield* refuse("archive requires an issue and --pr");
  yield* attempt(() => refuseUnarchivable(plan, false));
  if (!isParentPlan(plan))
    return yield* refuse(
      `archive refused: plan #${number} has its own landing work; archive it with --pr`,
    );
  if (!children.some((child) => statusFromIssueOf(child) === "finished"))
    return yield* refuse(
      `archive refused: no child of plan #${number} finished; retire the parent`,
    );
  const record = parentRecord(children);
  if (!isClosed(plan.issue)) {
    yield* claimBeforeClose(plan);
    yield* refuseChangedBeforeClose(plan);
    // gh posts the comment before it closes, so the record of a close that failed after it is not posted again.
    const comment = recorded(plan.issue, record) ? [] : ["--comment", record];
    const { nameWithOwner } = yield* currentRepository();
    yield* runGh([
      "issue",
      "close",
      String(number),
      "--reason",
      "completed",
      ...comment,
      "--repo",
      nameWithOwner,
    ]);
    yield* checkAfterOwnClose(number, children);
  } else yield* postRecordOnce(plan, record);
  yield* writeIssueIfUnchanged(plan.issue, { remove: labelsToRemove(plan.issue.labels) });
  yield* printLine(`plan #${number} finished (all ${children.length} children finished)`);
});

// The archive of a plan whose work landed through the pull request that `--pr` names. That pull request is the landing
// proof: the latest close of the plan can come from a commit, another pull request, or a person.
const archivePlan = Effect.fn("plan.archive")(function* (args: ReadonlyArray<string>) {
  const [value, ...flags] = args;
  const pr = (yield* attempt(() => parseOptions(flags, new Set(["--pr"])))).values.get("--pr");
  if (!value) return yield* refuse("archive requires an issue and --pr");
  if (pr === undefined) return yield* archiveParent(yield* attempt(() => parseIssueNumber(value)));
  const number = yield* attempt(() => parseIssueNumber(value));
  const pullRequest = yield* readPullRequest(
    yield* attempt(() => parseIssueNumber(pr, "pull request")),
    number,
  );
  if (!pullRequest.merged)
    return yield* refuse(`pull request #${pullRequest.number} is not merged`);
  // Each read is a snapshot for the write: it checks ownership, decides the claim, and must still be archivable. A plan
  // that reads closed as completed while a child shows open work, such as after a failed read that followed archive's
  // close, is reopened safely before the archive refusals.
  const read = Effect.fn("plan.archive.read")(function* () {
    const plan = yield* readPlanIssue(String(number), true, {
      comments: true,
      defaultBranch: true,
      children: true,
      closure: true,
      labelLookup: true,
    });
    const work = plan.status === "finished" ? openWork(plan) : undefined;
    if (work) return yield* reopenForOpenWork(plan, work);
    yield* attempt(() => refuseUnarchivable(plan));
    return plan;
  });
  let observed = yield* read();
  const { nameWithOwner, defaultBranch } = yield* currentRepository();
  if (pullRequest.baseRefName !== defaultBranch)
    return yield* refuse(
      `pull request #${pullRequest.number} merged into ${pullRequest.baseRefName}; archive requires a merge into ${nameWithOwner}:${defaultBranch}`,
    );
  if (
    typeof pullRequest.body !== "string" ||
    !hasClosingKeyword(pullRequest.body, number, nameWithOwner)
  )
    return yield* refuse(
      `pull request #${pullRequest.number} has no closing keyword for plan #${number} in its description; ask the owner before you add \`Closes #${number}\` to the merged pull request, then run archive again`,
    );
  // A state change that races GitHub's own close for a merge can leave the plan stuck (#90), so an open plan gets the
  // waits of reopen before archive closes it.
  const waits = yield* PlanWaits;
  for (let reads = 1; !isClosed(observed.issue) && reads < CLOSE_WAIT_READS; reads += 1) {
    yield* waits.sleep(CLOSE_WAIT_PAUSES_MS[Math.min(reads, CLOSE_WAIT_PAUSES_MS.length) - 1]);
    observed = yield* read();
  }
  // The close comes before the label removal: a failed close leaves the plan ongoing and a failed removal leaves it
  // finished, so a rerun archives it either way. Without its phase label, an open plan would no longer be archivable.
  const record = landingRecord(pullRequest.number);
  if (!isClosed(observed.issue)) {
    yield* refuseChangedBeforeClose(observed);
    // One comment explains the close and holds the archive record.
    const comment = `Closed by archive: pull request #${pullRequest.number} merged into ${defaultBranch} and closes this plan, but GitHub left the plan open.\n\n${record}`;
    // gh posts the comment before it closes, so the comment of a close that failed after it is not posted again.
    const commented = cycleComments(observed.issue).some((entry) => entry.body === comment);
    yield* runGh([
      "issue",
      "close",
      String(number),
      "--reason",
      "completed",
      ...(commented ? [] : ["--comment", comment]),
      "--repo",
      nameWithOwner,
    ]);
    yield* checkAfterOwnClose(number, observed.issue.children);
  } else yield* postRecordOnce(observed, record);
  yield* writeIssueIfUnchanged(observed.issue, { remove: labelsToRemove(observed.issue.labels) });
  yield* printLine(`plan #${number} finished (closed by ${pullRequest.url})`);
});

const retirePlan = Effect.fn("plan.retire")(function* (args: ReadonlyArray<string>) {
  const [value, ...flags] = args;
  const reason = (yield* attempt(() => parseOptions(flags, new Set(["--reason"])))).values.get(
    "--reason",
  );
  if (reason === undefined || !reason.trim() || /[\r\n]/.test(reason))
    return yield* refuse("retire requires a single-line --reason");
  const { issue, status } = yield* readPlanIssue(value, true);
  if (isClosed(issue)) return yield* refuse(`cannot retire a ${status} plan`);
  yield* writeIssueIfUnchanged(issue, { remove: labelsToRemove(issue.labels) });
  const { nameWithOwner } = yield* currentRepository();
  yield* runGh([
    "issue",
    "close",
    String(issue.number),
    "--reason",
    "not planned",
    "--comment",
    reason.replaceAll("\u2014", " - ").replace(/ {2,}/g, " "),
    "--repo",
    nameWithOwner,
  ]);
  yield* printLine(`plan #${issue.number} retired`);
});

// Whether the latest close of the plan came from the merged pull request, directly or through a commit associated
// with it; false while that close predates the merge or the plan has none. Refuses a stuck plan and a close by
// another closer after the merge.
const closedByPullRequest = Effect.fn("plan.closedByPullRequest")(function* (
  issue: PlanIssue,
  pullRequest: PullRequestRead,
) {
  yield* attempt(() => refuseStuck(issue));
  if (
    issue.closedEventAt === undefined ||
    Date.parse(issue.closedEventAt) < Date.parse(String(pullRequest.mergedAt))
  )
    return false;
  const { closer } = issue;
  const { nameWithOwner } = yield* currentRepository();
  const isPullRequest = (candidate: {
    readonly number: number;
    readonly repository: { readonly nameWithOwner: string };
  }): boolean =>
    candidate.number === pullRequest.number && candidate.repository.nameWithOwner === nameWithOwner;
  const fromPullRequest =
    closer?.__typename === "PullRequest"
      ? isPullRequest(closer)
      : closer?.__typename === "Commit" &&
        (yield* pullRequestNodes(yield* associatedNodes(closer))).some(isPullRequest);
  if (!fromPullRequest)
    return yield* refuse(
      `plan #${issue.number} was closed by ${describeCloser(closer)} after pull request #${pullRequest.number} merged; reopen it by hand only if that close was a mistake`,
    );
  return true;
});

// One write request reopens the plan, posts `comment`, and claims an unassigned plan. It changes no label that the plan
// holds, so a label that someone adds meanwhile survives. Only when the read right before the write shows no phase
// label, as after a finished archive, does the same request add `plan:ongoing`. GitHub labels have no compare-and-set,
// so a phase label can still change around the write: the read after it must show an open plan with exactly one phase
// label. A plan that reads closed again was closed by someone after the write, and the refusal names `command`, whose
// rerun reads that close and decides again. An open plan with no phase label or with more than one is refused with the
// repair through `status`. A reopen compares no body, so the pre-write read is its last ownership check: an owner that
// appeared after the snapshot is refused, and the claim follows that read. The last field returns the stored state,
// which shows whether GitHub left the plan stuck.
const writeReopen = Effect.fn("plan.writeReopen")(function* (
  plan: PlanRead,
  comment: string,
  command: string,
) {
  const { issue, login, viewerId, labelIds } = plan;
  const { id, assignees } = yield* ownedPreWriteIssue(issue.number, login);
  const claims = assignees.length === 0;
  const restoresPhase = !(yield* readSnapshot(issue.number)).issue.labels.some((label) =>
    isPhaseLabel(label.name),
  );
  const phaseLabelId = restoresPhase
    ? (labelIds?.get("plan:ongoing") ?? (yield* createdLabelId("plan:ongoing")))
    : undefined;
  const stored = "{... on Issue{state stateReason}}";
  const fields = [
    "reopenIssue(input:{issueId:$issue}){clientMutationId}",
    ...(restoresPhase
      ? ["addLabelsToLabelable(input:{labelableId:$issue,labelIds:$labels}){clientMutationId}"]
      : []),
    `addComment(input:{subjectId:$issue,body:$body}){${claims ? "clientMutationId" : `subject${stored}`}}`,
  ];
  if (claims)
    fields.push(
      `addAssigneesToAssignable(input:{assignableId:$issue,assigneeIds:$assignees}){assignable${stored}}`,
    );
  const declarations = [
    "$issue:ID!",
    "$body:String!",
    ...(restoresPhase ? ["$labels:[ID!]!"] : []),
    ...(claims ? ["$assignees:[ID!]!"] : []),
  ];
  const data = yield* graphqlData([
    "-f",
    `query=mutation(${declarations.join(",")}){${fields.join(" ")}}`,
    "-f",
    `issue=${id}`,
    "-f",
    `body=${comment}`,
    ...(restoresPhase ? ["-f", `labels[]=${phaseLabelId}`] : []),
    ...(claims ? ["-f", `assignees[]=${viewerId}`] : []),
  ]).pipe(
    // GitHub answers the reopen of a stuck plan with "Could not reopen the issue." (#90); the request is not retried.
    Effect.tapError(() =>
      readSnapshot(issue.number).pipe(
        Effect.flatMap((snapshot) => attempt(() => refuseStuck(snapshot.issue))),
      ),
    ),
  );
  const payload = claims
    ? field(field(data, "addAssigneesToAssignable"), "assignable")
    : field(field(data, "addComment"), "subject");
  const state = field(payload, "state");
  const stateReason = field(payload, "stateReason");
  if (typeof state !== "string" || (stateReason !== null && typeof stateReason !== "string"))
    return yield* new GraphqlError({
      message: "gh api graphql returned malformed stored plan issue",
    });
  yield* attempt(() => refuseStuck({ number: issue.number, state, stateReason }));
  // The status comes from a fresh read, which must show an open plan with exactly one phase label.
  const current = (yield* readSnapshot(issue.number)).issue;
  const status = statusFromIssueOf(current);
  yield* attempt(() => refuseStuck(current));
  if (isClosed(current))
    return yield* refuse(
      `plan #${issue.number} closed again after the reopen; run ${command} again`,
    );
  if (!PLAN_STATUSES.has(status))
    return yield* refuse(
      `plan issue state differs after reopen; run status ${issue.number} ongoing to repair the phase labels`,
    );
  yield* printLine(`plan #${issue.number} reopened: ${status}`);
});

interface SettleOptions {
  readonly observed: PlanRead;
  readonly read: () => Effect.Effect<PlanRead, PlanFailure, PlanServices>;
  readonly command: string;
  readonly stillReopenable: (plan: PlanRead) => Effect.Effect<boolean, PlanFailure, PlanServices>;
  readonly comment: string;
}

// A reopen right after a close can leave the plan stuck closed with reason REOPENED (#90). So a reopen of `observed`, a
// plan that reads closed, waits REOPEN_SETTLE_MS and reads the plan again. It writes only while that read shows the
// same close as completed and `stillReopenable` accepts it. When someone reopened the plan during the wait, it writes
// nothing and returns that read.
const settleAndReopen = Effect.fn("plan.settleAndReopen")(function* ({
  observed,
  read,
  command,
  stillReopenable,
  comment,
}: SettleOptions) {
  yield* (yield* PlanWaits).sleep(REOPEN_SETTLE_MS);
  const current = yield* read();
  const sameClose =
    (yield* stillReopenable(current)) &&
    current.issue.closedEventAt === observed.issue.closedEventAt &&
    describeCloser(current.issue.closer) === describeCloser(observed.issue.closer);
  if (isClosed(current.issue) && (current.status !== "finished" || !sameClose))
    return yield* refuse(
      `plan #${current.issue.number} changed during the settle wait; run ${command} again`,
    );
  if (!isClosed(current.issue)) return current;
  yield* writeReopen(current, comment, command);
  return undefined;
});

// A v5 plan lands each pull request through a child plan with `Closes #<child>`, so a partial pull request never
// closes it (E2). The refusal comes before the pull request read, whatever the state of that pull request. `gh issue
// view` resolves the repository as the GraphQL reads do, and it is no GraphQL read of the plan, so the reads that the
// close waits count stay the same.
const refuseChildPlanReopen = Effect.fn("plan.refuseChildPlanReopen")(function* (number: number) {
  const viewed = yield* parseJson(
    yield* runGh(["issue", "view", String(number), "--json", "body"]),
    "gh issue view",
  );
  const body = field(viewed, "body");
  if (typeof body !== "string")
    return yield* new GhError({ message: "gh issue view returned malformed plan issue" });
  if (contractVersion(body) === 5)
    return yield* refuse(
      `plan #${number} uses child plans; a partial pull request is not allowed (open a child plan with new --parent ${number})`,
    );
});

// The reopen after a partial pull request closed the plan through its linked branch (#90).
const reopenPlan = Effect.fn("plan.reopen")(function* (args: ReadonlyArray<string>) {
  const [value, ...flags] = args;
  const pr = (yield* attempt(() => parseOptions(flags, new Set(["--pr"])))).values.get("--pr");
  if (!value || !pr) return yield* refuse("reopen requires an issue and --pr");
  const number = yield* attempt(() => parseIssueNumber(value));
  const prNumber = yield* attempt(() => parseIssueNumber(pr, "pull request"));
  yield* refuseChildPlanReopen(number);
  const pullRequest = yield* readPullRequest(prNumber, number);
  if (!pullRequest.merged)
    return yield* refuse(`pull request #${pullRequest.number} is not merged`);
  if (!pullRequest.closesPlan) {
    yield* printLine(
      `pull request #${pullRequest.number} does not close plan #${number}; nothing to reopen`,
    );
    return;
  }
  // Each read is a snapshot for the write: it checks ownership and decides the claim.
  const read = () => readPlanIssue(String(number), true, { closure: true, labelLookup: true });
  const waits = yield* PlanWaits;
  let observed = yield* read();
  for (let reads = 1; !(yield* closedByPullRequest(observed.issue, pullRequest)); reads += 1) {
    if (reads === CLOSE_WAIT_READS) {
      // GitHub cannot close a closed issue, so a plan that still reads closed by an earlier close never gets the
      // close from this merge; telling the caller to run reopen again would loop forever.
      if (isClosed(observed.issue))
        return yield* refuse(
          `plan #${number} was closed by ${describeCloser(observed.issue.closer)} before pull request #${pullRequest.number} merged; reopen it by hand only if that close was a mistake`,
        );
      return yield* refuse(
        `GitHub has not closed plan #${number} for pull request #${pullRequest.number} yet; run reopen again once it has`,
      );
    }
    yield* waits.sleep(CLOSE_WAIT_PAUSES_MS[Math.min(reads, CLOSE_WAIT_PAUSES_MS.length) - 1]);
    observed = yield* read();
  }
  // A plan that reads open was reopened after that close.
  if (!isClosed(observed.issue)) {
    yield* printLine(`plan #${number} is open: ${observed.status}`);
    return;
  }
  const current = yield* settleAndReopen({
    observed,
    read,
    command: "reopen",
    stillReopenable: (plan) => closedByPullRequest(plan.issue, pullRequest),
    comment: `Reopened: partial pull request #${pullRequest.number} closed this plan through its linked branch. Work continues.`,
  });
  if (current) yield* printLine(`plan #${number} is open: ${current.status}`);
});

const COMMANDS: Readonly<
  Record<string, (args: ReadonlyArray<string>) => Effect.Effect<unknown, PlanFailure, PlanServices>>
> = {
  new: createPlan,
  show: showPlan,
  export: exportPlan,
  edit: editPlan,
  status: setPlanStatus,
  step: setStepStatus,
  list: listPlans,
  archive: archivePlan,
  retire: retirePlan,
  reopen: reopenPlan,
};

const printFailure = (error: PlanFailure): Effect.Effect<number> =>
  printErrorLine(error.message).pipe(Effect.as(1));

/**
 * Run `docks-kit plan <args>` and return its exit code. A plan command prints a failure as its message on stderr and
 * exits 1, as plan.mjs did. `base-blob` and `checkout-state` keep the exit codes of their shell scripts.
 */
export const runPlan = Effect.fn("plan.run")(function* (args: ReadonlyArray<string>) {
  const [command, ...rest] = args;
  if (command === "base-blob")
    return yield* baseBlob(rest).pipe(
      Effect.catchTags({
        FileError: (error) => printErrorLine(error.message).pipe(Effect.as(2)),
        SpawnError: (error) => printErrorLine(error.message).pipe(Effect.as(2)),
      }),
    );
  if (command === "checkout-state") return yield* checkoutState(rest);
  const run =
    command !== undefined && Object.hasOwn(COMMANDS, command) ? COMMANDS[command] : undefined;
  const outcome = run === undefined ? Effect.fail(refuse(USAGE)) : run(rest);
  return yield* outcome.pipe(
    Effect.as(0),
    Effect.catchTags({
      PlanRefusal: printFailure,
      GhError: printFailure,
      GraphqlError: printFailure,
      GitError: printFailure,
      FileError: printFailure,
      SpawnError: printFailure,
    }),
  );
});
