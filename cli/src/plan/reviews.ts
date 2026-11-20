/**
 * Review comments, trusted comments, archive records, and delegation grants. Pure: no process, file, or GitHub
 * access.
 */
import { liveGoalLines, YOLO_DELEGATION_LINE } from "./records";
import type { IssueComment, ParentLink } from "./types";

export type ReviewKind = "plan" | "code";
export type Verdict = "pass" | "repair" | "fixes-required" | "blocked";

/** The fields of a plan issue that the trust rule reads. */
export interface CommentSource {
  readonly assignees: ReadonlyArray<{ readonly login: string }>;
  readonly comments: ReadonlyArray<IssueComment>;
}

// Reviewers write Markdown: read review keywords through emphasis, code marks, quotes, and list markers (#49).
function reviewText(line: string): string {
  return line
    .replace(/[*_`]/g, "")
    .trim()
    .replace(/^(?:>\s*)+/, "")
    .replace(/^(?:[-+]|\d+[.)])\s+/, "")
    .trim();
}
const REVIEW_HEADING = /^(?:#+\s*)?(plan|code) review/i;
const REVIEW_VERDICT = /^(plan|code)[- ]review:\s*([a-z]+(?:-[a-z]+)*)/i;
const severeFinding = (text: string): boolean =>
  /\[(?:critical|high)\]/i.test(text) ||
  /^(?:critical|high)\s*:/i.test(text) ||
  /^severity\s*:\s*(?:critical|high)\b/i.test(text);
// One comment can hold several blocks of the same kind, such as the lens blocks of one code-review round (#98).
// A block starts at the first line or at a later Markdown heading line that names the comment's review kind. A
// quoted or list-item heading is prose, so a block that quotes an earlier round cannot open a block of its own. A
// block's verdict is its first verdict line of that kind; later verdict-like lines are prose, such as a quoted
// verdict of an earlier round. The most severe block verdict wins, so no block can hide another's failure.
// A heading line has `#` after at most three spaces, so a `*` list marker is not emphasis here; only the title after
// the `#` markers is read through emphasis and code marks.
function blockHeadingKind(rawLine: string): string | undefined {
  const heading = /^ {0,3}#+(.*)$/.exec(rawLine);
  if (!heading) return undefined;
  return /^\s*(plan|code) review/i.exec(heading[1].replace(/[*_`]/g, ""))?.[1].toLowerCase();
}
const VERDICT_SEVERITY: Readonly<Record<Verdict, number>> = {
  pass: 0,
  repair: 1,
  "fixes-required": 1,
  blocked: 2,
};
function verdictFor(kind: ReviewKind, alias: string): Verdict | undefined {
  if (["pass", "ok", "approved"].includes(alias)) return "pass";
  if (["repair", "changes", "fixes-required"].includes(alias))
    return kind === "plan" ? "repair" : "fixes-required";
  return alias === "blocked" ? "blocked" : undefined;
}
// The manager's response to round k follows the review blocks of round k+1 in the same comment (E5). The response
// quotes findings, so the parser reads no block heading, verdict, or severity from its heading line to the end.
const MANAGER_RESPONSE_HEADING = /^ {0,3}#### Manager response to round \d+[ \t]*$/;

export function parseReviewComment(
  body: unknown,
): { kind: ReviewKind; verdict: Verdict } | undefined {
  if (typeof body !== "string") return undefined;
  const commentLines = body.trim().split(/\r?\n/);
  const response = commentLines.findIndex(
    (line, index) => index > 0 && MANAGER_RESPONSE_HEADING.test(line),
  );
  const rawLines = response < 0 ? commentLines : commentLines.slice(0, response);
  const lines = rawLines.map(reviewText);
  const heading = REVIEW_HEADING.exec(lines[0]);
  if (!heading) return undefined;
  const kind: ReviewKind = heading[1].toLowerCase() === "plan" ? "plan" : "code";
  const blocks: Array<Array<string>> = [[]];
  for (const [index, line] of lines.entries()) {
    if (index === 0) continue;
    if (blockHeadingKind(rawLines[index]) === kind) blocks.push([]);
    else blocks[blocks.length - 1].push(line);
  }
  const firstVerdict = (block: ReadonlyArray<string>): RegExpExecArray | undefined =>
    block
      .map((line) => REVIEW_VERDICT.exec(line))
      .find((match) => match?.[1].toLowerCase() === kind) ?? undefined;
  // A later block without a verdict line is a heading inside the previous block; the first block needs a verdict.
  const matches = blocks.map(firstVerdict).filter((match, index) => match || index === 0);
  const verdicts: Array<Verdict> = [];
  for (const match of matches) {
    if (!match) return undefined;
    const verdict = verdictFor(kind, match[2].toLowerCase());
    if (verdict === undefined) return undefined;
    verdicts.push(verdict);
  }
  let verdict = verdicts.reduce((worst, next) =>
    VERDICT_SEVERITY[next] > VERDICT_SEVERITY[worst] ? next : worst,
  );
  if (kind === "code" && verdict === "pass" && lines.some(severeFinding))
    verdict = "fixes-required";
  return { kind, verdict };
}

// The comments that the trust rule accepts, oldest first: the issue has one assignee, and that assignee wrote them.
export function trustedComments(issue: CommentSource): Array<IssueComment> {
  const owners = issue.assignees;
  if (owners.length !== 1) return [];
  return issue.comments
    .map((comment, index) => ({ comment, index }))
    .sort(
      (a, b) =>
        Date.parse(a.comment.createdAt) - Date.parse(b.comment.createdAt) || a.index - b.index,
    )
    .map(({ comment }) => comment)
    .filter((comment) => comment.author?.login === owners[0].login);
}

export function reviewVerdicts(issue: CommentSource): Partial<Record<ReviewKind, Verdict>> {
  const verdicts: Partial<Record<ReviewKind, Verdict>> = {};
  for (const comment of trustedComments(issue)) {
    const review = parseReviewComment(comment.body);
    if (review) verdicts[review.kind] = review.verdict;
  }
  return verdicts;
}

// The archive record that `archive` posts with each successful archive, so that a later recovery knows which archive
// rule finished the plan (E1). A reopen comment ends the record of the archive before it.
export const parentRecord = (children: ReadonlyArray<{ readonly number: number }>): string =>
  `Archived as parent: children ${children.map((child) => `#${child.number}`).join(", ")}`;
export const landingRecord = (pr: number): string => `Archived with landing pull request #${pr}`;
// A reopen comment of `reopen` or `archive` ends the archive cycle before it.
const isReopenComment = (comment: IssueComment): boolean =>
  comment.body.trim().startsWith("Reopened: ");

export function archiveKind(issue: CommentSource): "parent" | "landing" | undefined {
  let kind: "parent" | "landing" | undefined;
  for (const comment of trustedComments(issue)) {
    const lines = comment.body.split(/\r?\n/).map((line) => line.trim());
    if (isReopenComment(comment)) kind = undefined;
    if (lines.some((line) => /^Archived as parent: children #\d+(?:, #\d+)*$/.test(line)))
      kind = "parent";
    if (lines.some((line) => /^Archived with landing pull request #\d+$/.test(line)))
      kind = "landing";
  }
  return kind;
}

// The trusted comments of the current archive cycle: the ones after the latest trusted reopen comment.
export function cycleComments(issue: CommentSource): Array<IssueComment> {
  const trusted = trustedComments(issue);
  let reopened = -1;
  trusted.forEach((comment, index) => {
    if (isReopenComment(comment)) reopened = index;
  });
  return trusted.slice(reopened + 1);
}

// Whether the current archive cycle already holds a trusted comment with the line `record`, so that a rerun does not
// post the record again, while the archive after a reopen gets its own record.
export const recorded = (issue: CommentSource, record: string): boolean =>
  cycleComments(issue).some((comment) =>
    comment.body.split(/\r?\n/).some((line) => line.trim() === record),
  );

// Authority events (contract, Delegated decisions). The parsing is not symmetric because each misreading must fail
// closed: a wrong `in force` gives the agent authority that the user did not give, and a wrong end only sends the
// questions back to the user. So a grant's first line must be exact, and a quoted or decorated grant is no event;
// a revocation's first line is read through emphasis, code marks, and case, so a hand-typed revocation still ends
// the grant; and a parent that the helper cannot read or check gives no grant.
const GRANT_EVENT = /^Delegation grant: (?:(yolo): )?(.*\S)$/;
const PARENT_EVENT = /^Parent event:(.*)$/;
const DELEGATED_LINE =
  /^Delegated: the user delegated the design and tradeoff decisions to the agent\. User: (.*)$/;

export type AuthorityEvent =
  | { readonly id: string; readonly createdAt: string; readonly kind: "revocation" }
  | {
      readonly id: string;
      readonly createdAt: string;
      readonly kind: "yolo" | "delegated";
      readonly quote: string;
      readonly parentEvent: string | undefined;
    };

// A quote compares after trimming and without one pair of surrounding double quotes.
function delegationQuote(quote: string): string {
  const text = quote.trim();
  return /^".*"$/s.test(text) ? text.slice(1, -1) : text;
}

function authorityEvent(comment: IssueComment): AuthorityEvent | undefined {
  const { fullDatabaseId: id, createdAt, body } = comment;
  const revocation = body.trim().split(/\r?\n/)[0].replace(/[*_`]/g, "").trim().toLowerCase();
  if (revocation === "delegation revoked") return { id, createdAt, kind: "revocation" };
  const [first, second = ""] = body.split(/\r?\n/);
  const grant = GRANT_EVENT.exec(first);
  if (!grant) return undefined;
  // A malformed `Parent event:` value still counts as a link, and it never matches a parent event.
  const parentEvent = PARENT_EVENT.exec(second)?.[1].trim();
  return {
    id,
    createdAt,
    kind: grant[1] ? "yolo" : "delegated",
    quote: grant[2],
    parentEvent,
  };
}

export const authorityEvents = (issue: CommentSource): Array<AuthorityEvent> =>
  trustedComments(issue).flatMap((comment) => authorityEvent(comment) ?? []);

export interface GrantState {
  readonly line: string;
  readonly advice: ReadonlyArray<string>;
}

/** The plan fields that the grant rule reads. */
export interface GrantSource extends CommentSource {
  readonly parent: ParentLink | null | undefined;
}

/** The read of the parent plan: its authority events, or a read that failed. */
export type ParentRead =
  | { readonly kind: "read"; readonly events: ReadonlyArray<AuthorityEvent> }
  | { readonly kind: "unreadable" };

// The `grant:` line of `show` and its advice. The plan's latest trusted event decides. A child's grant then holds only
// while its parent allows it, and the parent is read only for a child whose latest event is a grant. Last, the one
// live delegation line of Goal must match the deciding event in kind and quote. When the rule needs the parent and
// `parentRead` is undefined, the result names the parent to read; the caller reads it and calls again.
export function grantState(
  issue: GrantSource,
  goal: string,
  repositoryName: string,
  parentRead?: ParentRead,
): GrantState | { readonly readParent: number } {
  const latest = authorityEvents(issue).at(-1);
  const lines = liveGoalLines(goal)
    .map(({ text }) => text)
    .filter((text) => text === YOLO_DELEGATION_LINE || DELEGATED_LINE.test(text));
  const none = (reason?: string): GrantState => ({
    line: reason ? `grant: none; ${reason}` : "grant: none",
    advice: [],
  });
  if (!latest)
    return none(
      lines.length ? "the Goal delegation line has no trusted authority event" : undefined,
    );
  if (latest.kind === "revocation")
    return { line: `grant: ended by revocation comment ${latest.id}`, advice: [] };
  const { parent } = issue;
  if (!parent && latest.parentEvent !== undefined)
    return none(`comment ${latest.id} names a parent event, but the plan has no parent`);
  if (parent) {
    if (parent.repository.nameWithOwner !== repositoryName)
      return none(
        `parent #${parent.number} is in another repository (${parent.repository.nameWithOwner})`,
      );
    if (parentRead === undefined) return { readParent: parent.number };
    if (parentRead.kind === "unreadable") return none(`parent #${parent.number} cannot be read`);
    const parentLatest = parentRead.events.at(-1);
    // A linked grant holds only while the named event is the parent's latest, whatever the timestamps say; an
    // unlinked grant ends at any parent event that is not older than it. Equal timestamps cannot prove the order, so
    // a parent event with the same time ends the grant too (fail closed).
    const ended =
      latest.parentEvent === undefined
        ? parentLatest !== undefined &&
          Date.parse(parentLatest.createdAt) >= Date.parse(latest.createdAt)
        : parentLatest?.id !== latest.parentEvent;
    if (ended && !parentLatest)
      return none(`parent #${parent.number} has no trusted authority event`);
    if (ended && parentLatest)
      return {
        line: `grant: ended by parent #${parent.number} comment ${parentLatest.id}`,
        advice: lines.length
          ? [
              `parent #${parent.number} comment ${parentLatest.id} ended the grant; remove the delegation line from Goal, with no new event`,
            ]
          : [],
      };
  }
  if (lines.length !== 1)
    return none(
      lines.length
        ? `the Goal has ${lines.length} delegation lines for comment ${latest.id}`
        : `the Goal has no delegation line for comment ${latest.id}`,
    );
  const quote = DELEGATED_LINE.exec(lines[0])?.[1];
  const matches =
    latest.kind === "yolo"
      ? lines[0] === YOLO_DELEGATION_LINE
      : quote !== undefined && delegationQuote(quote) === delegationQuote(latest.quote);
  if (!matches) return none(`the Goal delegation line does not match comment ${latest.id}`);
  return { line: `grant: in force (${latest.kind}) by comment ${latest.id}`, advice: [] };
}
