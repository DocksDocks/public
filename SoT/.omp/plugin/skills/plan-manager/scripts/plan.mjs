#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const PLAN_STATUSES = new Set(['drafting', 'planned', 'ongoing', 'blocked']);
const STEP_STATUSES = new Set(['planned', 'in-flight', 'done', 'blocked', 'skipped']);
const STEP_EFFECTS = new Set(['local', 'probe', 'production_access', 'publish', 'push', 'release', 'deploy']);
const STEPS_HEADER = '| # | Id | Task | Files | Depends | Effect | Status | Done when |';
const STEPS_SEPARATOR = '|---:|---|---|---|---|---|---|---|';
const ACCEPTANCE_HEADER = '| ID | Command | Expected |';
const ACCEPTANCE_SEPARATOR = '|---|---|---|';
const PLAN_LABELS = ['plan', 'plan:drafting', 'plan:planned', 'plan:ongoing', 'plan:blocked'];
const ACTING_LOGIN_ERROR = 'cannot resolve the acting GitHub login (the GraphQL viewer.login lookup returned nothing)';
const PAGE_INFO = 'pageInfo{hasNextPage endCursor}';
const PULL_REQUEST_FIELDS = 'number url state mergedAt baseRefName repository{nameWithOwner}';
const PULL_REQUEST_CONNECTION = `nodes{${PULL_REQUEST_FIELDS}} ${PAGE_INFO}`;
const REPOSITORY_LABELS = PLAN_LABELS.map((name) => `${name.split(':').at(-1)}:label(name:"${name}"){name id}`).join(
  ' ',
);
// The pre-write read returns the body to compare and the node ids that the write mutation needs.
const PRE_WRITE_FIELDS = 'id,body,updatedAt,assignees';
// The last field of a write mutation returns the stored state that the post-write checks read.
const STORED_ISSUE_FIELDS = `body labels(first:100){nodes{name} ${PAGE_INFO}}`;
// `list` reads the newest plans first, as `gh issue list` did, so the 500-plan cap keeps the same plans.
const PLAN_LIST_ARGS = ',labels:["plan"],states:[OPEN,CLOSED],orderBy:{field:CREATED_AT,direction:DESC}';
// A plan list row and a sub-issue row: enough to derive the status of each issue.
const ISSUE_SUMMARY_FIELDS = `number title state stateReason labels(first:100){nodes{name} ${PAGE_INFO}}`;
const GH_MAX_BUFFER_MIB = 256;
const PLAN_LIST_LIMIT = 500;
// GitHub closes a plan for a merged pull request a while after the merge. `archive` reads an open plan up to
// CLOSE_WAIT_READS times until it reads closed, and `reopen` until GitHub records the close by that pull request.
// Between reads they pause for the next entry of CLOSE_WAIT_PAUSES_MS, and the last entry repeats: about 60 s in all.
// Once the close shows, `reopen` waits REOPEN_SETTLE_MS before it reads the plan again and writes (see sleep).
const CLOSE_WAIT_PAUSES_MS = [250, 500, 1000, 2000];
const CLOSE_WAIT_READS = 34;
const REOPEN_SETTLE_MS = 10_000;
// A machine path points into a user or root home, a mount, a named temporary or runtime directory,
// a Windows drive, or a network share. URL routes, slash prose, and portable system paths such as
// /usr/bin/env or a bare /tmp do not match (#71). The match runs to the next space or delimiter.
const MACHINE_PATH =
  /(?<=^|[\s("'`[{=:;,>]|file:\/\/)(?:\/(?:home|Users|root|mnt|media|Volumes|run\/(?:user|media))\/[^\s/`'")]|\/(?:private\/)?(?:tmp|var\/tmp)\/[^\s/`'")]|\/(?:private\/)?var\/folders\/|[A-Za-z]:[\\/]|\\\\[\w.$-]+\\[\w.$-])[^\s`'"()[\]{}|,;]*/gm;
function fail(message) {
  throw new Error(message);
}
function blankFencedRegions(text) {
  let fence;
  return text
    .split('\n')
    .map((line) => {
      const openingFence = fence ? undefined : /^ {0,3}(`{3,}|~{3,})/.exec(line);
      if (openingFence) fence = openingFence[1];
      else if (!fence) return line;
      else if (new RegExp(`^ {0,3}${fence[0]}{${fence.length},}[ \\t]*$`).test(line)) fence = undefined;
      return line.replace(/[^\r]/g, ' ');
    })
    .join('\n');
}
function unquoteCode(value) {
  return /^`[^`]+`$/.test(value) ? value.slice(1, -1) : value;
}
function labelNames(labels) {
  return (labels ?? []).map((label) => token(typeof label === 'string' ? label : label.name));
}
// Start gh and refuse only when it cannot run, so that a caller can read a failed exit.
function ghResult(argv) {
  const result = spawnSync('gh', argv, { encoding: 'utf8', maxBuffer: GH_MAX_BUFFER_MIB * 1024 * 1024 });
  if (result.error?.code === 'ENOENT') fail('gh is not installed or not on PATH');
  if (result.error?.code === 'ENOBUFS')
    fail(`gh ${argv.slice(0, 2).join(' ')} output exceeded ${GH_MAX_BUFFER_MIB} MiB`);
  if (result.error) fail(`gh ${argv.slice(0, 2).join(' ')} failed: ${result.error.message}`);
  return result;
}
function ghOutput(argv, result) {
  if (result.status !== 0) {
    const detail = result.stderr.trim() || `exit ${result.status}`;
    fail(`gh ${argv.slice(0, 2).join(' ')} failed: ${detail}`);
  }
  return result.stdout;
}
function runGh(argv) {
  return ghOutput(argv, ghResult(argv));
}
// Run `gh api graphql` with the given fields and return the response data.
function graphqlData(fields) {
  const response = parseJson(runGh(['api', 'graphql', ...fields]), 'gh api graphql');
  if (!response || (response.errors !== undefined && (!Array.isArray(response.errors) || response.errors.length))) {
    fail(`gh api graphql returned errors: ${response?.errors?.[0]?.message ?? 'malformed errors'}`);
  }
  if (!response.data || typeof response.data !== 'object') fail('gh api graphql returned missing data');
  return response.data;
}
function graphql(query, variables = {}) {
  const fields = ['-f', `query=${query}`, '-F', 'owner={owner}', '-F', 'name={repo}'];
  for (const [key, value] of Object.entries(variables)) fields.push('-F', `${key}=${value}`);
  return graphqlData(fields);
}
function parseJson(output, command) {
  try {
    return JSON.parse(output);
  } catch {
    fail(`${command} returned invalid JSON`);
  }
}
// The snapshot pages every issue label with its node id, so a write removes labels from the complete list.
const ISSUE_LABEL_FIELDS = 'name id';
const ASSIGNEE_FIELDS = '... on Actor{login}';
// `fullDatabaseId` is the number after `#issuecomment-` in the comment URL, the id that an authority event names.
const COMMENT_FIELDS = 'fullDatabaseId body createdAt author{login}';
const LABELED_EVENT_FIELDS = '... on LabeledEvent{label{name}}';
const CLOSED_EVENT_FIELDS = `... on ClosedEvent{createdAt closer{__typename ... on PullRequest{${PULL_REQUEST_FIELDS}} ... on Commit{oid associatedPullRequests(first:100){${PULL_REQUEST_CONNECTION}}}}}`;

function issueConnectionSelection(field, nodeFields, extraArgs = '', after = false) {
  return `${field}(first:100${after ? ',after:$after' : ''}${extraArgs}){nodes{${nodeFields}} ${PAGE_INFO}}`;
}

function connectionNodes(initial, name, nextPage, limit = Infinity) {
  const nodes = [];
  const seen = new Set();
  let connection = initial;
  for (;;) {
    if (
      !connection ||
      !Array.isArray(connection.nodes) ||
      !connection.pageInfo ||
      typeof connection.pageInfo.hasNextPage !== 'boolean' ||
      !Object.hasOwn(connection.pageInfo, 'endCursor') ||
      (connection.pageInfo.endCursor !== null && typeof connection.pageInfo.endCursor !== 'string') ||
      connection.nodes.some((node) => !node || typeof node !== 'object')
    )
      fail(`gh api graphql returned malformed ${name}`);
    nodes.push(...connection.nodes);
    if (!connection.pageInfo.hasNextPage || nodes.length >= limit) return nodes;
    const cursor = connection.pageInfo.endCursor;
    if (typeof cursor !== 'string' || !cursor || seen.has(cursor))
      fail(`gh api graphql returned malformed ${name} cursor`);
    seen.add(cursor);
    connection = nextPage(cursor);
  }
}

function pullRequestNodes(nodes) {
  if (
    nodes.some(
      (pr) =>
        !Number.isInteger(pr.number) ||
        pr.number < 1 ||
        typeof pr.url !== 'string' ||
        typeof pr.state !== 'string' ||
        (pr.mergedAt !== null && typeof pr.mergedAt !== 'string') ||
        typeof pr.baseRefName !== 'string' ||
        typeof pr.repository?.nameWithOwner !== 'string',
    )
  )
    fail('gh api graphql returned malformed closing pull requests');
  return nodes;
}

function hasClosingKeyword(body, number, nameWithOwner) {
  const repo = nameWithOwner.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(
    String.raw`\b(?:close|closes|closed|fix|fixes|fixed|resolve|resolves|resolved):?[ \t]+(?:#|${repo}#)${number}(?![A-Za-z0-9_])`,
    'i',
  ).test(body);
}

function issueNodes(issueNumber, initial, field, nodeFields, extraArgs = '') {
  const name = field.includes(':') ? field.split(':')[0] : field;
  const selection = issueConnectionSelection(field, nodeFields, extraArgs, true);
  const query = `query($owner:String!,$name:String!,$number:Int!,$after:String!){repository(owner:$owner,name:$name){issue(number:$number){${selection}}}}`;
  return connectionNodes(
    initial,
    name,
    (after) => graphql(query, { number: issueNumber, after }).repository?.issue?.[name],
  );
}

function associatedNodes(commit) {
  if (typeof commit.oid !== 'string' || !commit.oid) fail('gh api graphql returned malformed closing commit');
  const query = `query($owner:String!,$name:String!,$oid:String!,$after:String!){repository(owner:$owner,name:$name){commit:object(expression:$oid){... on Commit{associatedPullRequests(first:100,after:$after){${PULL_REQUEST_CONNECTION}}}}}}`;
  return connectionNodes(
    commit.associatedPullRequests,
    'associated pull requests',
    (after) => graphql(query, { oid: commit.oid, after }).repository?.commit?.associatedPullRequests,
  );
}

// Issue rows read through ISSUE_SUMMARY_FIELDS, with every label page as a plain list, as a plan's own labels are read.
function issueSummaries(nodes, name) {
  if (
    nodes.some(
      (issue) =>
        !Number.isInteger(issue.number) ||
        typeof issue.title !== 'string' ||
        typeof issue.state !== 'string' ||
        (issue.stateReason !== null && typeof issue.stateReason !== 'string'),
    )
  )
    fail(`gh api graphql returned malformed ${name}`);
  return nodes.map((issue) => {
    const labels = issueNodes(issue.number, issue.labels, 'labels', 'name');
    if (labels.some((label) => typeof label.name !== 'string')) fail(`gh api graphql returned malformed ${name}`);
    return { ...issue, labels };
  });
}

function readSnapshot(
  number,
  {
    acting = false,
    labelLookup = false,
    comments = false,
    history = false,
    defaultBranch = false,
    closure = false,
    children = false,
    parent = false,
  } = {},
) {
  const issueFields =
    number === undefined
      ? ''
      : [
          'number title body state stateReason url createdAt updatedAt',
          issueConnectionSelection('labels', ISSUE_LABEL_FIELDS),
          issueConnectionSelection('assignedActors', ASSIGNEE_FIELDS),
          comments ? issueConnectionSelection('comments', COMMENT_FIELDS) : '',
          history
            ? issueConnectionSelection('history:timelineItems', LABELED_EVENT_FIELDS, ',itemTypes:[LABELED_EVENT]')
            : '',
          closure ? `latestClosure:timelineItems(last:1,itemTypes:[CLOSED_EVENT]){nodes{${CLOSED_EVENT_FIELDS}}}` : '',
          children ? issueConnectionSelection('subIssues', ISSUE_SUMMARY_FIELDS) : '',
          parent ? 'parent{number repository{nameWithOwner}}' : '',
        ].join(' ');
  const query = `query($owner:String!,$name:String!${number === undefined ? '' : ',$number:Int!'}){${acting ? 'viewer{login id}' : ''} repository(owner:$owner,name:$name){nameWithOwner visibility ${defaultBranch ? 'defaultBranchRef{name}' : ''} ${labelLookup ? REPOSITORY_LABELS : ''} ${number === undefined ? '' : `issue(number:$number){${issueFields}}`}}}`;
  const data = graphql(query, number === undefined ? {} : { number });
  const repo = data.repository;
  if (
    !repo ||
    typeof repo.nameWithOwner !== 'string' ||
    !/^[^/]+\/[^/]+$/.test(repo.nameWithOwner) ||
    typeof repo.visibility !== 'string'
  )
    fail('gh api graphql returned malformed repository');
  if (defaultBranch && typeof repo.defaultBranchRef?.name !== 'string')
    fail('gh api graphql returned malformed default branch');
  repository = repo;
  const login = data.viewer?.login;
  const viewerId = data.viewer?.id;
  if (acting && (typeof login !== 'string' || !login.trim())) fail(ACTING_LOGIN_ERROR);
  if (acting && (typeof viewerId !== 'string' || !viewerId)) fail('gh api graphql returned malformed viewer');
  // Each plan label name maps to its node id, or to null when the repository lacks the label.
  let labelIds;
  if (labelLookup) {
    labelIds = new Map();
    for (const name of PLAN_LABELS) {
      const label = repo[name.split(':').at(-1)];
      if (
        label === undefined ||
        (label !== null &&
          (typeof label.name !== 'string' || token(label.name) !== name || typeof label.id !== 'string' || !label.id))
      )
        fail('gh api graphql returned malformed repository labels');
      labelIds.set(name, label?.id ?? null);
    }
  }
  if (number === undefined) return { labelIds };
  const issue = repo.issue;
  if (
    !issue ||
    issue.number !== number ||
    typeof issue.title !== 'string' ||
    typeof issue.body !== 'string' ||
    typeof issue.state !== 'string' ||
    (issue.stateReason !== null && typeof issue.stateReason !== 'string') ||
    typeof issue.url !== 'string' ||
    typeof issue.createdAt !== 'string' ||
    typeof issue.updatedAt !== 'string'
  )
    fail('gh api graphql returned malformed plan issue');
  issue.labels = issueNodes(number, issue.labels, 'labels', ISSUE_LABEL_FIELDS);
  issue.assignees = issueNodes(number, issue.assignedActors, 'assignedActors', ASSIGNEE_FIELDS);
  if (
    issue.labels.some((label) => typeof label.name !== 'string' || typeof label.id !== 'string' || !label.id) ||
    issue.assignees.some((owner) => typeof owner.login !== 'string' || !owner.login)
  )
    fail('gh api graphql returned malformed plan issue labels or assignees');
  if (comments) {
    issue.comments = issueNodes(number, issue.comments, 'comments', COMMENT_FIELDS);
    if (
      issue.comments.some(
        (comment) =>
          typeof comment.body !== 'string' ||
          !Number.isFinite(Date.parse(comment.createdAt)) ||
          typeof comment.fullDatabaseId !== 'string' ||
          !/^[1-9]\d*$/.test(comment.fullDatabaseId) ||
          (comment.author !== null && typeof comment.author?.login !== 'string'),
      )
    )
      fail('gh api graphql returned malformed issue comments');
  }
  if (history) {
    issue.history = issueNodes(
      number,
      issue.history,
      'history:timelineItems',
      LABELED_EVENT_FIELDS,
      ',itemTypes:[LABELED_EVENT]',
    );
    if (issue.history.some((event) => typeof event.label?.name !== 'string'))
      fail('gh api graphql returned malformed label history');
  }
  if (closure) {
    if (!Array.isArray(issue.latestClosure?.nodes)) fail('gh api graphql returned malformed latest closure');
    const latest = issue.latestClosure.nodes.at(-1);
    const closer = latest?.closer;
    if (
      issue.latestClosure.nodes.length > 1 ||
      (issue.latestClosure.nodes.length &&
        (closer === undefined ||
          (closer !== null && !closer.__typename) ||
          !Number.isFinite(Date.parse(latest.createdAt))))
    )
      fail('gh api graphql returned malformed latest closure');
    if (closer?.__typename === 'PullRequest') pullRequestNodes([closer]);
    if (closer?.__typename === 'Commit' && (typeof closer.oid !== 'string' || !closer.oid))
      fail('gh api graphql returned malformed closing commit');
    issue.closer = closer;
    issue.closedEventAt = latest?.createdAt;
  }
  if (children)
    issue.children = issueSummaries(
      issueNodes(number, issue.subIssues, 'subIssues', ISSUE_SUMMARY_FIELDS),
      'sub-issues',
    );
  if (
    parent &&
    issue.parent !== null &&
    (!Number.isInteger(issue.parent?.number) || typeof issue.parent.repository?.nameWithOwner !== 'string')
  )
    fail('gh api graphql returned malformed parent issue');
  return { issue, login, viewerId, labelIds };
}
function parseIssueNumber(value, kind = 'plan issue') {
  const match = /^#?([1-9]\d*)$/.exec(String(value ?? ''));
  if (!match) fail(`invalid ${kind}: ${value ?? '(missing)'}`);
  return Number(match[1]);
}
function workStarted(issue, recordStatus) {
  if (recordStatus !== 'drafting' && recordStatus !== 'planned') return true;
  return issue.history.some((event) => token(event.label.name) === 'plan:ongoing');
}
const CONTRACT_MARKER = /^\s*<!-- plan-contract: v([345]) -->/i;
const contractVersion = (body) => Number(CONTRACT_MARKER.exec(body)?.[1] ?? 0);
// A started v3 or v4 plan keeps the partial-pull-request flow, so each write keeps it at v4. Every other write
// writes v5 (E2).
const writeMarker = (issue, status) =>
  contractVersion(issue.body) === 5 || !workStarted(issue, status) ? MARKER : LEGACY_MARKER;
function stateDirectory() {
  const base = process.env.XDG_STATE_HOME || path.join(process.env.HOME || os.homedir(), '.local', 'state');
  const directory = path.join(base, 'docks', 'plan');
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  fs.chmodSync(directory, 0o700);
  return directory;
}
function withBodyFile(body, callback) {
  const temporary = path.join(stateDirectory(), `body-${process.pid}-${randomUUID()}.md`);
  let descriptor;
  try {
    descriptor = fs.openSync(temporary, 'wx', 0o600);
    fs.writeFileSync(descriptor, body, 'utf8');
    fs.closeSync(descriptor);
    descriptor = undefined;
    return callback(temporary);
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor);
    fs.rmSync(temporary, { force: true });
  }
}
// The pre-write read: the issue as GitHub stores it now, with the node ids that the write mutation needs.
function preWriteIssue(number) {
  const current = parseJson(
    runGh(['issue', 'view', String(number), '--json', PRE_WRITE_FIELDS, '--repo', repository.nameWithOwner]),
    'gh issue view',
  );
  const hasId = (node) => typeof node?.id === 'string' && node.id !== '';
  if (
    !hasId(current) ||
    typeof current.body !== 'string' ||
    !Array.isArray(current.assignees) ||
    !current.assignees.every(hasId)
  )
    fail('gh issue view returned malformed plan issue');
  return current;
}
// The pre-write read before a state change that a rerun cannot take back: an owner that appeared after the snapshot
// is refused.
function ownedPreWriteIssue(number, login) {
  const current = preWriteIssue(number);
  if (current.assignees.some((owner) => typeof owner.login !== 'string' || !owner.login))
    fail('gh issue view returned malformed plan issue');
  const foreign = current.assignees.find((owner) => owner.login !== login);
  if (foreign) fail(`plan #${number} is owned by ${foreign.login}`);
  return current;
}
// A status write can target a phase label that the repository lacks: create it as `new` does, then read its id.
function createdLabelId(name) {
  runGh(['label', 'create', name, '--repo', repository.nameWithOwner]);
  const query = `query($owner:String!,$name:String!){repository(owner:$owner,name:$name){label(name:${JSON.stringify(name)}){name id}}}`;
  const label = graphql(query).repository?.label;
  if (typeof label?.name !== 'string' || token(label.name) !== name || typeof label.id !== 'string' || !label.id)
    fail('gh api graphql returned malformed repository labels');
  return label.id;
}
// A write is the pre-write read plus one GraphQL request (#89). GitHub runs its mutation fields in order:
// updateIssue first, so the body and the claim of an unassigned plan land in one write; then discrete label
// additions and removals, so a label that someone else adds meanwhile survives. The last field returns the
// stored state, which the post-write checks read.
function writeIssueIfUnchanged(issue, { body, add, remove = [], labelIds } = {}) {
  const claims = issue.claimantId !== undefined;
  if (body === undefined && !add && remove.length === 0 && !claims) return;
  const current = preWriteIssue(issue.number);
  if (current.body !== issue.body) fail('plan issue changed remotely; re-read and retry');
  // A claim follows the pre-write read: an owner that appeared after the snapshot is refused before any write.
  const foreign = claims ? current.assignees.find((owner) => owner.id !== issue.claimantId) : undefined;
  if (foreign) fail(`plan #${issue.number} is owned by ${foreign.login}`);
  const idLists = [];
  const fields = [];
  if (body !== undefined || claims) {
    const input = ['id:$issue'];
    if (body !== undefined) input.push('body:$body');
    if (claims) {
      idLists.push(['assignees', [...new Set([...current.assignees.map((owner) => owner.id), issue.claimantId])]]);
      input.push('assigneeIds:$assignees');
    }
    fields.push({ mutation: 'updateIssue', input: input.join(','), payload: 'issue' });
  }
  if (add) {
    idLists.push(['add', [labelIds.get(add) ?? createdLabelId(add)]]);
    fields.push({ mutation: 'addLabelsToLabelable', input: 'labelableId:$issue,labelIds:$add', payload: 'labelable' });
  }
  const removed = new Set(remove.map(token));
  const removeIds = issue.labels.filter((label) => removed.has(token(label.name))).map((label) => label.id);
  if (removeIds.length) {
    idLists.push(['remove', removeIds]);
    fields.push({
      mutation: 'removeLabelsFromLabelable',
      input: 'labelableId:$issue,labelIds:$remove',
      payload: 'labelable',
    });
  }
  const declarations = [
    '$issue:ID!',
    ...(body === undefined ? [] : ['$body:String!']),
    ...idLists.map(([name]) => `$${name}:[ID!]!`),
  ];
  const selections = fields.map(({ mutation, input, payload }, index) => {
    const stored =
      payload === 'issue' ? `issue{${STORED_ISSUE_FIELDS}}` : `labelable{... on Issue{${STORED_ISSUE_FIELDS}}}`;
    return `${mutation}(input:{${input}}){${index === fields.length - 1 ? stored : 'clientMutationId'}}`;
  });
  const send = (bodyFile) =>
    graphqlData([
      '-f',
      `query=mutation(${declarations.join(',')}){${selections.join(' ')}}`,
      '-f',
      `issue=${current.id}`,
      // gh passes an @file field byte for byte; any other -F value gets type conversion and placeholder filling.
      ...(bodyFile === undefined ? [] : ['-F', `body=@${bodyFile}`]),
      ...idLists.flatMap(([name, ids]) => ids.flatMap((id) => ['-f', `${name}[]=${id}`])),
    ]);
  const data = body === undefined ? send() : withBodyFile(body, send);
  const last = fields.at(-1);
  const stored = data[last.mutation]?.[last.payload];
  if (typeof stored?.body !== 'string' || !Array.isArray(stored.labels?.nodes))
    fail('gh api graphql returned malformed stored plan issue');
  if (body !== undefined && stored.body !== body) fail('plan issue body differs after edit');
  if (!add && remove.length === 0) return;
  const storedLabels = issueNodes(issue.number, stored.labels, 'labels', 'name');
  if (storedLabels.some((label) => typeof label.name !== 'string')) fail('gh api graphql returned malformed labels');
  const labels = labelNames(storedLabels);
  if ((add && !labels.includes(add)) || remove.some((label) => labels.includes(token(label))))
    fail('plan issue labels differ after edit');
}
function parseOptions(args, allowed, repeatable = new Set()) {
  const options = {};
  for (let index = 0; index < args.length; index += 2) {
    const flag = args[index];
    if (
      !allowed.has(flag) ||
      args[index + 1] === undefined ||
      (!repeatable.has(flag) && Object.hasOwn(options, flag))
    ) {
      fail(`invalid option: ${flag ?? '(missing)'}`);
    }
    if (repeatable.has(flag)) {
      options[flag] ??= [];
      options[flag].push(args[index + 1]);
    } else options[flag] = args[index + 1];
  }
  return options;
}
function statusFromLabels(labels) {
  const statuses = labelNames(labels)
    .filter((label) => label.startsWith('plan:') && PLAN_STATUSES.has(label.slice(5)))
    .map((label) => label.slice(5));
  if (statuses.length === 0) return 'unlabelled';
  return statuses.length === 1 ? statuses[0] : 'unreadable';
}
export function statusFromIssue(issue) {
  if (String(issue.state).toUpperCase() !== 'CLOSED') return statusFromLabels(issue.labels);
  switch (String(issue.stateReason).toUpperCase()) {
    case 'COMPLETED':
      return 'finished';
    case 'NOT_PLANNED':
      return 'retired';
    case 'DUPLICATE':
      return 'duplicate';
    default:
      return 'unreadable';
  }
}
// A reopen that races GitHub's close can leave an issue closed with reason REOPENED, and GitHub then refuses every
// state change on it, also in the web page (#90). The derived status stays `unreadable`.
const STUCK_ADVICE =
  'GitHub left this issue closed with reason REOPENED and refuses every state change; ask GitHub Support to repair it, and record step results in an issue comment until then';
function stuckClosed(issue) {
  return String(issue.state).toUpperCase() === 'CLOSED' && String(issue.stateReason).toUpperCase() === 'REOPENED';
}
function refuseStuck(issue) {
  if (stuckClosed(issue))
    fail(
      `GitHub left plan #${issue.number} closed with reason REOPENED and refuses every state change; ask GitHub Support to repair it`,
    );
}
function labelsToRemove(issue, target) {
  const names = (issue.labels ?? []).map((label) => (typeof label === 'string' ? label : label.name));
  return names.filter((label) => token(label).startsWith('plan:') && (!target || token(label) !== `plan:${target}`));
}
function headerStrip(issue, status) {
  return `#${issue.number} · ${status} · ${issue.title} · ${issue.url}`;
}
function reviewDirectory() {
  const result = spawnSync('git', ['rev-parse', '--git-path', 'docks-review'], { encoding: 'utf8' });
  if (result.error?.code === 'ENOENT') fail('git is not installed or not on PATH');
  if (result.error) fail(`git rev-parse failed: ${result.error.message}`);
  if (result.status !== 0) fail(`git rev-parse failed: ${result.stderr.trim() || `exit ${result.status}`}`);
  const gitPath = result.stdout.trim();
  if (!gitPath) fail('git rev-parse failed: empty git path');
  return path.resolve(process.cwd(), gitPath);
}
function exportPlan(args) {
  if (args.length !== 1) fail('export requires one issue');
  const { issue } = readPlanIssue(args[0]);
  const directory = reviewDirectory();
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  fs.chmodSync(directory, 0o700);
  const destination = path.join(directory, `plan-${issue.number}.md`);
  fs.writeFileSync(destination, issue.body, { encoding: 'utf8', mode: 0o600 });
  fs.writeFileSync(originFile(destination), `${bodyDigest(issue.body)}\n`, { encoding: 'utf8', mode: 0o600 });
  fs.chmodSync(destination, 0o600);
  fs.chmodSync(originFile(destination), 0o600);
  console.log(destination);
}
function bodyDigest(body) {
  return createHash('sha256').update(body, 'utf8').digest('hex');
}
function originFile(planFile) {
  return `${planFile}.origin`;
}
function readOrigin(planFile) {
  const source = originFile(planFile);
  let recorded;
  try {
    recorded = fs.readFileSync(source, 'utf8').trim();
  } catch (error) {
    if (error.code === 'ENOENT') return undefined;
    fail(`unreadable export provenance: ${source}`);
  }
  if (!/^[0-9a-f]{64}$/.test(recorded)) fail(`unreadable export provenance: ${source}`);
  return recorded;
}
function changedLines(before, after) {
  const left = before.split('\n');
  const right = after.split('\n');
  const lengths = Array.from({ length: left.length + 1 }, () => new Uint32Array(right.length + 1));
  for (let i = left.length - 1; i >= 0; i -= 1) {
    for (let j = right.length - 1; j >= 0; j -= 1) {
      lengths[i][j] = left[i] === right[j] ? lengths[i + 1][j + 1] + 1 : Math.max(lengths[i + 1][j], lengths[i][j + 1]);
    }
  }
  const changes = [];
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
const SECTIONS = ['Goal', 'Research', 'Steps', 'Acceptance', 'Do not touch', 'Open questions', 'Verification Results'];
const MARKER = '<!-- plan-contract: v5 -->';
const LEGACY_MARKER = '<!-- plan-contract: v4 -->';
// Budgets above the largest plan of this repository (41,607 characters, 17 steps, 22 comments). A plan that passes
// one gets the advice to split into child plans (E4).
const BODY_BYTE_BUDGET = 50_000;
const STEP_BUDGET = 20;
const COMMENT_BUDGET = 60;
let repository;
const token = (value) => unquoteCode(value.trim()).trim().toLowerCase();
const stepId = (value) => token(value).replaceAll('-', '_');
const terminal = (status) => ['done', 'skipped'].includes(status);
const trimBlankLines = (text) => text.replace(/^(?:[ \t]*\n)+/, '').replace(/\s+$/, '');
const RETIRED_SECTIONS = new Set(['review']);
function sectionMap(body) {
  const headings = [...blankFencedRegions(body).matchAll(/^ {0,3}##[ \t]+([^\n]+)$/gm)];
  const sections = new Map();
  headings.forEach((heading, index) => {
    const title = heading[1].trim();
    const name = SECTIONS.find((known) => known.toLowerCase() === title.toLowerCase());
    if (!name && !RETIRED_SECTIONS.has(title.toLowerCase()))
      fail(
        `unknown section heading: ${title}; use only ${SECTIONS.join(', ')} or write it below an existing section as ### or plain text`,
      );
    const key = name ?? title;
    if (sections.has(key)) fail(`duplicate section heading: ${key}`);
    sections.set(
      key,
      trimBlankLines(body.slice(heading.index + heading[0].length, headings[index + 1]?.index ?? body.length)),
    );
  });
  return sections;
}
// Split a table row on pipes that are not escaped; a pipe is escaped only when an odd
// run of backslashes precedes it, so `\\|` is a literal backslash followed by a delimiter.
function splitCells(row) {
  const cells = [];
  let cell = '',
    backslashes = 0;
  for (const char of row) {
    if (char === '|' && backslashes % 2 === 0) {
      cells.push(cell);
      cell = '';
    } else cell += char;
    backslashes = char === '\\' ? backslashes + 1 : 0;
  }
  cells.push(cell);
  if (cells.length > 1 && cells[0].trim() === '') cells.shift();
  if (cells.length > 1 && cells.at(-1).trim() === '') cells.pop();
  return cells;
}
function table(text, header) {
  const lines = text.split('\n'),
    scan = blankFencedRegions(text)
      .split('\n')
      .map((line) => (/^(?: {4}|\t)/.test(line) ? '' : line)),
    cells = (line) => splitCells(line.trim()).map((cell) => cell.trim());
  const start = scan.findIndex((line) => cells(line).map(token).join('|') === cells(header).map(token).join('|'));
  if (start < 0) return { lines, start, end: start, rows: [] };
  const isSeparator = (line) => cells(line).every((cell) => /^:?-+:?$/.test(cell));
  const first = start + 1 + (scan[start + 1] !== undefined && isSeparator(scan[start + 1]) ? 1 : 0);
  let end = first;
  while (end < scan.length && scan[end].trim().startsWith('|')) end++;
  return { lines, start, end, rows: lines.slice(first, end).map(cells) };
}
const render = (sections, marker = MARKER) =>
  `${marker}\n\n${SECTIONS.map((name) => `## ${name}\n\n${sections.get(name) ?? ''}`.trimEnd()).join('\n\n')}\n`;
function replaceTable(sections, name, header, separator, rows) {
  const parsed = table(sections.get(name) ?? '', header);
  if (parsed.start < 0) return;
  parsed.lines.splice(
    parsed.start,
    parsed.end - parsed.start,
    header,
    separator,
    ...rows.map((cells) => `| ${cells.join(' | ')} |`),
  );
  sections.set(name, parsed.lines.join('\n'));
}
// Returns the step that a Depends entry names. An entry is a display, or a step id: normalizePlan keeps the id when
// the display holds a comma. A display match wins, as in normalizePlan. `steps` holds objects with display and id.
const dependencyStep = (steps, entry) =>
  steps.find((step) => step.display === entry) ?? steps.find((step) => step.id === stepId(entry));
// The paths of a Files cell.
const filePaths = (cell) =>
  new Set(
    cell
      .split(',')
      .map((part) => unquoteCode(part.trim()).trim())
      .filter((part) => part && part !== '-'),
  );
// Steps that edit the same path need a Depends order, or parallel work collides (#78).
function sharedFilesAdvice(rows) {
  const paths = rows.map((row) => filePaths(row[3]));
  const steps = rows.map(([display, id]) => ({ display, id }));
  const dependencies = new Map(
    rows.map((row) => [
      row[0],
      row[4] === '-' ? [] : row[4].split(',').map((part) => dependencyStep(steps, part.trim())?.display ?? part.trim()),
    ]),
  );
  const reaches = (from, to, seen = new Set()) => {
    if (seen.has(from)) return false;
    seen.add(from);
    return (dependencies.get(from) ?? []).some((next) => next === to || reaches(next, to, seen));
  };
  const advice = [];
  rows.forEach((row, index) => {
    for (let other = index + 1; other < rows.length; other += 1) {
      const shared = [...paths[index]].filter((entry) => paths[other].has(entry));
      if (shared.length && !reaches(row[0], rows[other][0]) && !reaches(rows[other][0], row[0]))
        advice.push(`steps ${row[1]} and ${rows[other][1]} share ${shared.join(', ')} with no Depends link`);
    }
  });
  return advice;
}
export function normalizePlan(text, { mode: explicitMode, marker = MARKER } = {}) {
  const advice = [];
  const cleaned = text
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((line) => (line.includes('\u2014') ? line.replaceAll('\u2014', ' - ').replace(/ {2,}/g, ' ') : line).trimEnd())
    .join('\n');
  const sections = sectionMap(cleaned),
    goal = sections.get('Goal') ?? '';
  const goalLines = goal.split('\n'),
    modeLines = blankFencedRegions(goal)
      .split('\n')
      .map((line, index) => (/^ {0,3}Mode:/i.test(line) ? index : -1))
      .filter((index) => index >= 0);
  const mode = modeLines.length ? /^ {0,3}Mode:\s*(.*?)\s*$/i.exec(goalLines[modeLines.at(-1)]) : undefined,
    value = (explicitMode ?? mode?.[1] ?? '').toLowerCase();
  const valid = ['plan-only', 'plan-and-implement'].includes(value);
  if (!valid) advice.push('Mode defaulted to plan-only; implementation needs an explicit mode.');
  const goalWithoutMode = goalLines.filter((_, index) => !modeLines.includes(index)).join('\n');
  sections.set('Goal', trimBlankLines(`${trimBlankLines(goalWithoutMode)}\n\nMode: ${valid ? value : 'plan-only'}`));
  const rows = table(sections.get('Steps') ?? '', STEPS_HEADER).rows;
  for (const row of rows) {
    if (row.length !== 8) continue;
    row[1] = stepId(row[1]);
    row[5] = token(row[5]);
    row[6] = token(row[6]);
    if (!STEP_EFFECTS.has(row[5])) advice.push(`unknown Effect: ${row[5]}`);
    if (!STEP_STATUSES.has(row[6])) advice.push(`unknown Status: ${row[6]}`);
    // A done or skipped step does not run again, so it needs no ask.
    if (row[5] !== 'local' && !terminal(row[6]))
      advice.push(`step ${row[1]} Effect ${row[5]} needs an in-session ask before it runs.`);
  }
  const numbers = new Map(rows.filter((row) => row.length === 8).map((row) => [row[1], row[0]]));
  const displays = new Set(numbers.values());
  const dependency = (part) => {
    const trimmed = part.trim();
    if (displays.has(trimmed)) return trimmed;
    // Depends is a comma-separated list, so a display that holds a comma cannot replace an id: the next pass would
    // split it into new parts, and the cell would change again.
    const display = numbers.get(stepId(trimmed));
    return display === undefined || display.includes(',') ? trimmed : display;
  };
  for (const row of rows)
    if (row.length === 8) row[4] = row[4] === '-' ? '-' : row[4].split(',').map(dependency).join(', ');
  advice.push(...sharedFilesAdvice(rows.filter((row) => row.length === 8)));
  replaceTable(sections, 'Steps', STEPS_HEADER, STEPS_SEPARATOR, rows);
  replaceTable(
    sections,
    'Acceptance',
    ACCEPTANCE_HEADER,
    ACCEPTANCE_SEPARATOR,
    table(sections.get('Acceptance') ?? '', ACCEPTANCE_HEADER).rows,
  );
  const machinePaths = new Set(Array.from(cleaned.matchAll(MACHINE_PATH), ([match]) => match.replace(/[.:]+$/, '')));
  for (const machinePath of machinePaths) advice.push(`body contains an absolute machine path: ${machinePath}`);
  return { body: render(sections, marker), advice };
}
export function parsePlan(text) {
  const { body } = normalizePlan(text),
    sections = sectionMap(body);
  return {
    sections,
    malformedSteps: table(sections.get('Steps'), STEPS_HEADER)
      .rows.map((row, index) => ({ line: index + 1, cells: row.length }))
      .filter((row) => row.cells !== 8),
    steps: table(sections.get('Steps'), STEPS_HEADER)
      .rows.filter((row) => row.length === 8)
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
    acceptance: table(sections.get('Acceptance'), ACCEPTANCE_HEADER).rows,
  };
}
// A drafted plan holds this placeholder until research is published (#78).
const RESEARCH_PLACEHOLDER = '_Not researched yet._';
// Compare the whole section: research prose may quote the placeholder.
function researchFilled(plan) {
  const research = plan.sections.get('Research').trim();
  return research !== '' && research !== RESEARCH_PLACEHOLDER;
}
function printAdvice(text, status, extra = [], options = {}) {
  const result = normalizePlan(text, options);
  if (status !== 'drafting' && !researchFilled(parsePlan(text)))
    result.advice.push('Research is not filled after drafting.');
  for (const message of [...result.advice, ...extra]) console.log(`advice: ${message}`);
}
// A plan-review pass covers the body that the reviewer read (#78). In a yolo plan, the Mode line and the
// delegation line record what the yolo invocation decided, not reviewed work, so they need no new round (#111).
const PLANNED_WORK_SECTIONS = ['Goal', 'Research', 'Steps', 'Acceptance', 'Do not touch'];
const YOLO_DELEGATION_LINE = 'Yolo: the user delegated every decision except the merge to the agent.';
// The trimmed live lines of Goal text with their indexes: a fenced or indented code line is example text.
const liveGoalLines = (goal) =>
  blankFencedRegions(goal)
    .split('\n')
    .flatMap((line, index) => (/^(?: {4}|\t)/.test(line) ? [] : [{ index, text: line.trim() }]));
// The indexes of the live delegation lines of Goal text. A fenced or indented code line that quotes the delegation
// line is example text, so it stays reviewed work.
const liveDelegationLines = (goal) =>
  new Set(liveGoalLines(goal).flatMap(({ index, text }) => (text === YOLO_DELEGATION_LINE ? [index] : [])));
// Normalization ends Goal with its one canonical Mode line. The comparison removes each live delegation line with the
// blank line that separated it from the text before it, the blank lines that a leading delegation line leaves at the
// start, and the blank lines at the end. Every other blank line and indentation stays, because example text can
// depend on them.
const goalWork = (goal) => {
  const lines = goal.replace(/(?:^|\n)Mode: [^\n]*$/, '').split('\n');
  const live = liveDelegationLines(lines.join('\n'));
  const kept = [];
  let removedAtStart = false;
  lines.forEach((line, index) => {
    if (live.has(index)) {
      if (kept.length === 0) removedAtStart = true;
      else if (kept.at(-1).trim() === '' && (lines[index + 1] ?? '').trim() === '') kept.pop();
    } else if (!(removedAtStart && kept.length === 0 && line.trim() === '')) kept.push(line);
  });
  return kept.join('\n').trimEnd();
};
function plannedWorkChanges(before, after) {
  const yoloGoal = liveDelegationLines(after.sections.get('Goal')).size > 0;
  return PLANNED_WORK_SECTIONS.filter((name) => {
    const [was, now] = [before.sections.get(name), after.sections.get(name)];
    return name === 'Goal' && yoloGoal ? goalWork(was) !== goalWork(now) : was !== now;
  });
}
// Reviewers write Markdown: read review keywords through emphasis, code marks, quotes, and list markers (#49).
function reviewText(line) {
  return line
    .replace(/[*_`]/g, '')
    .trim()
    .replace(/^(?:>\s*)+/, '')
    .replace(/^(?:[-+]|\d+[.)])\s+/, '')
    .trim();
}
const REVIEW_HEADING = /^(?:#+\s*)?(plan|code) review/i;
const REVIEW_VERDICT = /^(plan|code)[- ]review:\s*([a-z]+(?:-[a-z]+)*)/i;
const severeFinding = (text) =>
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
function blockHeadingKind(rawLine) {
  const heading = /^ {0,3}#+(.*)$/.exec(rawLine);
  return heading && /^\s*(plan|code) review/i.exec(heading[1].replace(/[*_`]/g, ''))?.[1].toLowerCase();
}
const VERDICT_SEVERITY = { pass: 0, repair: 1, 'fixes-required': 1, blocked: 2 };
function verdictFor(kind, alias) {
  if (['pass', 'ok', 'approved'].includes(alias)) return 'pass';
  if (['repair', 'changes', 'fixes-required'].includes(alias)) return kind === 'plan' ? 'repair' : 'fixes-required';
  return alias === 'blocked' ? 'blocked' : undefined;
}
// The manager's response to round k follows the review blocks of round k+1 in the same comment (E5). The response
// quotes findings, so the parser reads no block heading, verdict, or severity from its heading line to the end.
const MANAGER_RESPONSE_HEADING = /^ {0,3}#### Manager response to round \d+[ \t]*$/;
export function parseReviewComment(body) {
  if (typeof body !== 'string') return undefined;
  const commentLines = body.trim().split(/\r?\n/);
  const response = commentLines.findIndex((line, index) => index > 0 && MANAGER_RESPONSE_HEADING.test(line));
  const rawLines = response < 0 ? commentLines : commentLines.slice(0, response);
  const lines = rawLines.map(reviewText);
  const heading = REVIEW_HEADING.exec(lines[0]);
  if (!heading) return undefined;
  const kind = heading[1].toLowerCase();
  const blocks = [[]];
  for (const [index, line] of lines.entries()) {
    if (index === 0) continue;
    if (blockHeadingKind(rawLines[index]) === kind) blocks.push([]);
    else blocks.at(-1).push(line);
  }
  const firstVerdict = (block) =>
    block.map((line) => REVIEW_VERDICT.exec(line)).find((match) => match?.[1].toLowerCase() === kind);
  // A later block without a verdict line is a heading inside the previous block; the first block needs a verdict.
  const matches = blocks.map(firstVerdict).filter((match, index) => match || index === 0);
  if (!matches[0]) return undefined;
  const verdicts = matches.map((match) => verdictFor(kind, match[2].toLowerCase()));
  if (verdicts.includes(undefined)) return undefined;
  let verdict = verdicts.reduce((worst, next) => (VERDICT_SEVERITY[next] > VERDICT_SEVERITY[worst] ? next : worst));
  if (kind === 'code' && verdict === 'pass' && lines.some(severeFinding)) verdict = 'fixes-required';
  return { kind, verdict };
}
// The comments that the trust rule accepts, oldest first: the issue has one assignee, and that assignee wrote them.
function trustedComments(issue) {
  const owners = issue.assignees;
  if (owners.length !== 1) return [];
  return issue.comments
    .map((comment, index) => ({ comment, index }))
    .sort((a, b) => Date.parse(a.comment.createdAt) - Date.parse(b.comment.createdAt) || a.index - b.index)
    .map(({ comment }) => comment)
    .filter((comment) => comment.author?.login === owners[0].login);
}
function reviewVerdicts(issue) {
  const verdicts = {};
  for (const comment of trustedComments(issue)) {
    const review = parseReviewComment(comment.body);
    if (review) verdicts[review.kind] = review.verdict;
  }
  return verdicts;
}
// The archive record that `archive` posts with each successful archive, so that a later recovery knows which archive
// rule finished the plan (E1). A reopen comment ends the record of the archive before it.
const parentRecord = (children) =>
  `Archived as parent: children ${children.map((child) => `#${child.number}`).join(', ')}`;
const landingRecord = (pr) => `Archived with landing pull request #${pr}`;
// A reopen comment of `reopen` or `archive` ends the archive cycle before it.
const isReopenComment = (comment) => comment.body.trim().startsWith('Reopened: ');
function archiveKind(issue) {
  let kind;
  for (const comment of trustedComments(issue)) {
    const lines = comment.body.split(/\r?\n/).map((line) => line.trim());
    if (isReopenComment(comment)) kind = undefined;
    if (lines.some((line) => /^Archived as parent: children #\d+(?:, #\d+)*$/.test(line))) kind = 'parent';
    if (lines.some((line) => /^Archived with landing pull request #\d+$/.test(line))) kind = 'landing';
  }
  return kind;
}
// Authority events (contract, Delegated decisions). The parsing is not symmetric because each misreading must fail
// closed: a wrong `in force` gives the agent authority that the user did not give, and a wrong end only sends the
// questions back to the user. So a grant's first line must be exact, and a quoted or decorated grant is no event;
// a revocation's first line is read through emphasis, code marks, and case, so a hand-typed revocation still ends
// the grant; and a parent that the helper cannot read or check gives no grant.
const GRANT_EVENT = /^Delegation grant: (?:(yolo): )?(.*\S)$/;
const PARENT_EVENT = /^Parent event:(.*)$/;
const DELEGATED_LINE = /^Delegated: the user delegated the design and tradeoff decisions to the agent\. User: (.*)$/;
// A quote compares after trimming and without one pair of surrounding double quotes.
function delegationQuote(quote) {
  const text = quote.trim();
  return /^".*"$/s.test(text) ? text.slice(1, -1) : text;
}
function authorityEvent(comment) {
  const { fullDatabaseId: id, createdAt, body } = comment;
  const revocation = body.trim().split(/\r?\n/)[0].replace(/[*_`]/g, '').trim().toLowerCase();
  if (revocation === 'delegation revoked') return { id, createdAt, kind: 'revocation' };
  const [first, second = ''] = body.split(/\r?\n/);
  const grant = GRANT_EVENT.exec(first);
  if (!grant) return undefined;
  // A malformed `Parent event:` value still counts as a link, and it never matches a parent event.
  const parentEvent = PARENT_EVENT.exec(second)?.[1].trim();
  return { id, createdAt, kind: grant[1] ? 'yolo' : 'delegated', quote: grant[2], parentEvent };
}
const authorityEvents = (issue) => trustedComments(issue).map(authorityEvent).filter(Boolean);
// The `grant:` line of `show` and its advice. The plan's latest trusted event decides. A child's grant then holds only
// while its parent allows it, and the parent is read only for a child whose latest event is a grant. Last, the one
// live delegation line of Goal must match the deciding event in kind and quote.
function grantState(issue, goal) {
  const latest = authorityEvents(issue).at(-1);
  const lines = liveGoalLines(goal)
    .map(({ text }) => text)
    .filter((text) => text === YOLO_DELEGATION_LINE || DELEGATED_LINE.test(text));
  const none = (reason) => ({ line: reason ? `grant: none; ${reason}` : 'grant: none', advice: [] });
  if (!latest) return none(lines.length ? 'the Goal delegation line has no trusted authority event' : undefined);
  if (latest.kind === 'revocation') return { line: `grant: ended by revocation comment ${latest.id}`, advice: [] };
  const { parent } = issue;
  if (!parent && latest.parentEvent !== undefined)
    return none(`comment ${latest.id} names a parent event, but the plan has no parent`);
  if (parent) {
    if (parent.repository.nameWithOwner !== repository.nameWithOwner)
      return none(`parent #${parent.number} is in another repository (${parent.repository.nameWithOwner})`);
    let parentLatest;
    try {
      parentLatest = authorityEvents(readSnapshot(parent.number, { comments: true }).issue).at(-1);
    } catch {
      return none(`parent #${parent.number} cannot be read`);
    }
    // A linked grant holds only while the named event is the parent's latest, whatever the timestamps say; an
    // unlinked grant ends at any parent event that is not older than it. Equal timestamps cannot prove the order, so
    // a parent event with the same time ends the grant too (fail closed).
    const ended =
      latest.parentEvent === undefined
        ? parentLatest !== undefined && Date.parse(parentLatest.createdAt) >= Date.parse(latest.createdAt)
        : parentLatest?.id !== latest.parentEvent;
    if (ended && !parentLatest) return none(`parent #${parent.number} has no trusted authority event`);
    if (ended)
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
    latest.kind === 'yolo'
      ? lines[0] === YOLO_DELEGATION_LINE
      : quote !== undefined && delegationQuote(quote) === delegationQuote(latest.quote);
  if (!matches) return none(`the Goal delegation line does not match comment ${latest.id}`);
  return { line: `grant: in force (${latest.kind}) by comment ${latest.id}`, advice: [] };
}
function readPlanIssue(value, forWrite = false, connections = {}) {
  const { issue, login, viewerId, labelIds } = readSnapshot(parseIssueNumber(value), {
    acting: forWrite,
    ...connections,
  });
  if (!contractVersion(issue.body)) fail(`unreadable plan contract: #${issue.number}`);
  if (forWrite) {
    const owners = issue.assignees.map((owner) => owner.login);
    const foreign = owners.find((owner) => owner !== login);
    if (foreign) fail(`plan #${issue.number} is owned by ${foreign}`);
    // The write claims an unassigned plan for the acting viewer.
    if (!owners.length) issue.claimantId = viewerId;
  }
  return { issue, parsed: parsePlan(issue.body), status: statusFromIssue(issue), labelIds, login, viewerId };
}
// A child plan needs a parent that the acting login owns alone and that is still open as a plan (E1).
function openPlanOf(issue, login) {
  return (
    contractVersion(issue.body) > 0 &&
    String(issue.state).toUpperCase() === 'OPEN' &&
    PLAN_STATUSES.has(statusFromIssue(issue)) &&
    issue.assignees.length === 1 &&
    issue.assignees[0].login === login
  );
}
// A gh release without `issue create --parent` gets the REST sub-issues API, which takes the issue's database id.
function linkSubIssue(parent, number) {
  const { nameWithOwner } = repository;
  try {
    const child = parseJson(runGh(['api', `repos/${nameWithOwner}/issues/${number}`]), 'gh api');
    if (!Number.isInteger(child?.id)) fail('gh api returned a malformed issue');
    runGh([
      'api',
      `repos/${nameWithOwner}/issues/${parent}/sub_issues`,
      '--method',
      'POST',
      '-F',
      `sub_issue_id=${child.id}`,
    ]);
  } catch (error) {
    fail(`plan #${number} was created, but its link to parent #${parent} failed: ${error.message}`);
  }
}
function createPlan(args) {
  const options = parseOptions(
    args,
    new Set(['--title', '--goal', '--mode', '--label', '--parent']),
    new Set(['--label']),
  );
  if (!options['--title']?.trim() || !options['--goal']?.trim()) fail('new requires --title and --goal');
  const extras = options['--label'] ?? [];
  for (const label of extras) if (/^plan(?::|$)/i.test(label)) fail(`reserved label namespace: ${label}`);
  const parent = options['--parent'] === undefined ? undefined : parseIssueNumber(options['--parent'], 'parent issue');
  const { issue: parentIssue, login, labelIds } = readSnapshot(parent, { acting: true, labelLookup: true });
  if (parent !== undefined && !openPlanOf(parentIssue, login)) fail(`parent #${parent} is not an open plan`);
  for (const [label, id] of labelIds)
    if (id === null) runGh(['label', 'create', label, '--repo', repository.nameWithOwner]);
  const goalText = blankFencedRegions(options['--goal'])
    .split('\n')
    .map((masked, index) => {
      const line = options['--goal'].split('\n')[index];
      return /^ {0,3}##[ \t]/.test(masked) ? line.replace(/^( {0,3})##/, '$1###') : line;
    })
    .join('\n');
  const source = `## Goal\n${goalText}\n## Research\n${RESEARCH_PLACEHOLDER}\n## Steps\n${STEPS_HEADER}\n${STEPS_SEPARATOR}\n## Acceptance\n${ACCEPTANCE_HEADER}\n${ACCEPTANCE_SEPARATOR}`;
  const { body } = normalizePlan(source, { mode: options['--mode'] });
  let linkByRest = false;
  const url = withBodyFile(body, (file) => {
    const argv = [
      'issue',
      'create',
      '--title',
      options['--title'].replaceAll('\u2014', ' - ').replace(/ {2,}/g, ' ').trim(),
      '--body-file',
      file,
      '--label',
      'plan',
      '--label',
      'plan:drafting',
      '--assignee',
      '@me',
      ...extras.flatMap((label) => ['--label', label]),
      '--repo',
      repository.nameWithOwner,
    ];
    if (parent === undefined) return runGh(argv).trim();
    const withParent = [...argv, '--parent', String(parent)];
    const result = ghResult(withParent);
    // gh refuses an unknown flag before it creates anything, so the plain create runs once.
    linkByRest = result.status !== 0 && /unknown flag: --parent\b/.test(result.stderr);
    return (linkByRest ? runGh(argv) : ghOutput(withParent, result)).trim();
  });
  const number = /\/issues\/([1-9]\d*)\/?$/.exec(url)?.[1];
  if (!number) fail('gh issue create returned an invalid issue URL');
  if (linkByRest) linkSubIssue(parent, Number(number));
  console.log(`plan created: #${number} ${url}`);
  printAdvice(source, 'drafting', [], { mode: options['--mode'] });
}
function describeCloser(closer) {
  if (closer?.__typename === 'PullRequest') return closer.url;
  if (closer?.__typename === 'Commit') return `commit ${closer.oid}`;
  return 'an unknown closer';
}
function showPlan(args) {
  const [value, ...flags] = args;
  if (!value || flags.length > 1 || flags.some((flag) => flag !== '--body'))
    fail('show requires an issue and optional --body');
  const connections = { comments: true, closure: true, children: true, parent: true };
  const { issue, parsed, status } = readPlanIssue(value, false, connections);
  const reviews = reviewVerdicts(issue);
  const grant = grantState(issue, parsed.sections.get('Goal'));
  const metadata = [
    headerStrip(issue, status),
    `reviews: plan=${reviews.plan ?? 'none'} code=${reviews.code ?? 'none'}`,
    grant.line,
    ...issue.children.map((child) => `child #${child.number} · ${statusFromIssue(child)} · ${child.title}`),
  ].join('\n');
  if (flags.length) {
    console.error(metadata);
    process.stdout.write(issue.body);
  } else {
    console.log(metadata);
    const unfinished = status === 'finished' ? parsed.steps.find((step) => !terminal(step.status)) : undefined;
    const extra = unfinished
      ? [
          `plan is closed as completed while step ${unfinished.id} is ${unfinished.status}; closed by ${describeCloser(issue.closer)}; reopen the issue if work remains`,
        ]
      : [];
    if (stuckClosed(issue)) extra.push(STUCK_ADVICE);
    if (status === 'finished') extra.push(...closedChildAdvice(issue, parsed));
    extra.push(...budgetAdvice(issue.body, parsed, issue.comments.length), ...grant.advice);
    printAdvice(issue.body, status, extra);
  }
}
// The open work that `archive` reopens safely on a plan closed as completed (see openWork): a linked child that is not
// terminal and, on a parent that no merged pull request closed, a row that names a child that is not linked or rows
// that name no finished child.
function closedChildAdvice(issue, parsed) {
  const recovery = `run archive ${issue.number} again to reopen it safely`,
    statuses = new Map(issue.children.map((child) => [child.number, statusFromIssue(child)])),
    named = parentRecoveryChildren({ issue, parsed }),
    advice = [];
  for (const [child, status] of statuses)
    if (!CHILD_TERMINAL_STATUSES.has(status))
      advice.push(`plan is closed as completed while child #${child} is ${status}; ${recovery}`);
  if (!named) return advice;
  for (const child of named)
    if (!statuses.has(child))
      advice.push(`plan names child #${child}, which is not linked; relink it or edit the row; ${recovery}`);
  if (noNamedChildFinished(named, statuses))
    advice.push(`plan is closed as completed but no child finished; ${recovery}`);
  return advice;
}
// Each budget that a plan passes gets one advice line (E4).
function budgetAdvice(body, plan, comments) {
  const bytes = Buffer.byteLength(body, 'utf8'),
    steps = plan.steps.length + plan.malformedSteps.length;
  return [
    bytes > BODY_BYTE_BUDGET && `body is ${bytes} bytes (budget ${BODY_BYTE_BUDGET})`,
    steps > STEP_BUDGET && `${steps} steps (budget ${STEP_BUDGET})`,
    comments > COMMENT_BUDGET && `${comments} comments (budget ${COMMENT_BUDGET})`,
  ]
    .filter(Boolean)
    .map((reason) => `split into child plans: ${reason}`);
}
// The helper cannot tell new scope from a repair, so each change of this shape on a started v5 plan gets the advice to
// move new work into a child plan: a new step, a new path in the Files cell of a step, or a changed Task or Done when.
function scopeChanged(before, after) {
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
function refuseMalformedSteps(plan) {
  const [first] = plan.malformedSteps;
  if (first)
    fail(
      `Steps row ${first.line} has ${first.cells} cells; expected 8. Escape a literal pipe as \\| so the row is preserved.`,
    );
}
function editPlan(args) {
  const [value, ...flags] = args,
    file = parseOptions(flags, new Set(['--file']))['--file'];
  if (!file) fail('edit requires an issue and --file');
  const { issue, parsed, status } = readPlanIssue(value, true, { history: true, comments: true }),
    origin = readOrigin(file);
  if (!origin)
    fail(
      `missing export provenance: ${file}.origin does not exist; run \`plan.mjs export ${issue.number}\` and re-apply the edit`,
    );
  if (origin !== bodyDigest(issue.body))
    fail(
      `stale export: ${file} was exported from a superseded body; run \`plan.mjs export ${issue.number}\` and re-apply the edit`,
    );
  const started = workStarted(issue, status),
    source = fs.readFileSync(file, 'utf8'),
    { body } = normalizePlan(source, { marker: writeMarker(issue, status) }),
    incomingPlan = parsePlan(body),
    incoming = incomingPlan.steps;
  refuseMalformedSteps(incomingPlan);
  const seenIds = new Set();
  for (const row of incoming) {
    if (seenIds.has(row.id)) fail(`duplicate step id after normalization: ${row.id}`);
    seenIds.add(row.id);
  }
  if (started) {
    refuseMalformedSteps(parsed);
    const frozen = (detail) => fail(`step state is frozen once work starts: ${detail}`),
      ids = new Set(parsed.steps.map((row) => row.id));
    const last = incoming.reduce((position, row, index) => (ids.has(row.id) ? index : position), -1);
    for (const row of parsed.steps) {
      const matches = incoming.filter((next) => next.id === row.id);
      if (matches.length !== 1) frozen(`step ${row.id} removed or duplicated`);
      for (const key of ['id', 'display', 'depends', 'effect', 'status'])
        if (matches[0][key] !== row[key]) frozen(`step ${row.id} ${key} changed`);
    }
    incoming.forEach((row, index) => {
      if (
        !ids.has(row.id) &&
        (String(issue.state).toUpperCase() === 'CLOSED' || row.status !== 'planned' || index < last)
      )
        frozen(`new step ${row.id} must append as planned on an open plan`);
    });
  }
  fs.writeFileSync(file, body);
  writeIssueIfUnchanged(issue, { body });
  // Refresh provenance only after the remote write, so a failed write can be retried with the same file (#78).
  fs.writeFileSync(originFile(file), `${bodyDigest(body)}\n`, { mode: 0o600 });
  fs.chmodSync(originFile(file), 0o600);
  const changes = changedLines(issue.body, body);
  console.log(headerStrip(issue, status));
  console.log(`changed: ${changes.length} line(s)`);
  for (const line of changes) console.log(line);
  const changedWork = reviewVerdicts(issue).plan === 'pass' ? plannedWorkChanges(parsed, incomingPlan) : [];
  const extra = changedWork.length
    ? [
        `plan review passed before this edit; changed sections: ${changedWork.join(', ')}; review all such edits in one plan-review round before code that depends on them or the next code-review round`,
      ]
    : [];
  if (started && contractVersion(issue.body) === 5 && scopeChanged(parsed, incomingPlan))
    extra.push(`check for new scope; move new work into a child plan (new --parent ${issue.number})`);
  extra.push(...budgetAdvice(body, incomingPlan, issue.comments.length));
  printAdvice(source, status, extra);
}
function setPlanStatus(args) {
  const [value, raw, ...flags] = args,
    target = token(raw ?? ''),
    options = parseOptions(flags, new Set(['--reason']));
  if (!PLAN_STATUSES.has(target)) fail(`unknown plan status: ${target}`);
  if (target === 'blocked' && (!options['--reason']?.trim() || /[\r\n]/.test(options['--reason'])))
    fail('blocked status requires --reason as single-line text');
  const { issue, parsed, status, labelIds } = readPlanIssue(value, true, { history: true, labelLookup: true });
  if (String(issue.state).toUpperCase() === 'CLOSED')
    fail(`plan #${issue.number} is closed; status applies to open plans`);
  if (workStarted(issue, status) && !['ongoing', 'blocked'].includes(target))
    fail(`illegal plan status transition: ${status} -> ${target}`);
  if (['planned', 'ongoing'].includes(target) && !researchFilled(parsed))
    fail(`status ${target} requires a filled Research section`);
  const content = parsed.sections.get('Open questions').replace(/^Blocked:[^\n]*\n?\s*/i, '');
  parsed.sections.set(
    'Open questions',
    `${target === 'blocked' ? `Blocked: ${options['--reason']}\n\n` : ''}${content}`.trim(),
  );
  const source = render(parsed.sections);
  writeIssueIfUnchanged(issue, {
    body: normalizePlan(source, { marker: writeMarker(issue, status) }).body,
    add: `plan:${target}`,
    remove: labelsToRemove(issue, target),
    labelIds,
  });
  console.log(`plan #${issue.number} status: ${status} -> ${target}`);
  printAdvice(issue.body, target);
}
function setStepStatus(args) {
  if (args.length !== 3) fail('step requires an issue, step id, and status');
  const [value, id, raw] = args,
    target = token(raw),
    { issue, parsed, status } = readPlanIssue(value, true);
  if (!STEP_STATUSES.has(target)) fail(`unknown step status: ${target}`);
  if (status !== 'ongoing' && status !== 'finished') fail(`plan status is ${status}; expected ongoing`);
  refuseMalformedSteps(parsed);
  const row = parsed.steps.find((step) => step.id === stepId(id));
  if (!row) fail(`unknown step id: ${id}`);
  const current = row.status;
  if (status === 'finished' && !terminal(target))
    fail(`plan #${issue.number} is finished; reopen it before moving step ${row.id} to ${target}`);
  if (status !== 'finished' && terminal(current) && current !== target)
    fail(`illegal step status transition: ${current} -> ${target}`);
  const advice = normalizePlan(issue.body).advice.filter((message) => message.startsWith('Mode defaulted')),
    unfinished = row.depends
      .split(',')
      .map((part) => part.trim())
      .filter((part) => part !== '-' && !terminal(dependencyStep(parsed.steps, part)?.status));
  if (['in-flight', 'done'].includes(target) && unfinished.length)
    advice.push(`step ${row.id} has unfinished dependency ${unfinished.join(', ')}`);
  row.status = target;
  replaceTable(
    parsed.sections,
    'Steps',
    STEPS_HEADER,
    STEPS_SEPARATOR,
    parsed.steps.map((step) => Object.values(step)),
  );
  const source = render(parsed.sections);
  writeIssueIfUnchanged(issue, { body: normalizePlan(source, { marker: writeMarker(issue, status) }).body });
  console.log(`plan #${issue.number} step ${row.id}: ${current} -> ${target}`);
  printAdvice(source, status, advice);
}
function listPlans(args) {
  const selected = parseOptions(args, new Set(['--status']))['--status'];
  // One GraphQL query per 100 plans; like every snapshot, it names the repository through gh's {owner}/{repo}.
  const query = `query($owner:String!,$name:String!,$after:String){repository(owner:$owner,name:$name){${issueConnectionSelection('issues', ISSUE_SUMMARY_FIELDS, PLAN_LIST_ARGS, true)}}}`;
  const page = (variables) => graphql(query, variables).repository?.issues;
  const nodes = connectionNodes(page(), 'plan issues', (after) => page({ after }), PLAN_LIST_LIMIT);
  const issues = issueSummaries(nodes.slice(0, PLAN_LIST_LIMIT), 'plan issues');
  issues.sort(
    (a, b) =>
      Number(a.state.toUpperCase() === 'CLOSED') - Number(b.state.toUpperCase() === 'CLOSED') || a.number - b.number,
  );
  for (const issue of issues) {
    const status = statusFromIssue(issue);
    if (!selected || status === token(selected)) console.log(`${status}\t#${issue.number}\t${issue.title}`);
  }
  if (issues.length >= PLAN_LIST_LIMIT) console.log('advice: list stopped at 500 plans; more plans may exist');
}
// A child plan that closed as completed, not planned, or duplicate runs no more work.
const CHILD_TERMINAL_STATUSES = new Set(['finished', 'retired', 'duplicate']);
// GitHub closes a plan for its merged pull request a while after the merge, so an archive takes the plan open and
// ongoing as well as closed and finished. A plan finishes only after each of its child plans closed (E1).
function refuseUnarchivable(plan, { codeReview = true } = {}) {
  const { issue, parsed, status } = plan;
  refuseStuck(issue);
  if (status !== (isClosed(plan) ? 'finished' : 'ongoing'))
    fail(`archive requires ongoing or finished status, found ${status}`);
  refuseMalformedSteps(parsed);
  if (parsed.steps.length === 0) fail('archive refused: no Steps rows parsed');
  const unfinished = parsed.steps.find((row) => !terminal(row.status));
  if (unfinished) fail(`archive refused: non-terminal step ${unfinished.id}`);
  if (codeReview && reviewVerdicts(issue).code !== 'pass') fail('archive requires Code-review: pass');
  const openChild = issue.children.find((child) => !CHILD_TERMINAL_STATUSES.has(statusFromIssue(child)));
  if (openChild) fail(`archive refused: child #${openChild.number} is ${statusFromIssue(openChild)}`);
}
// The first child of the plan that has a new status in a fresh read: a new child, a child with another status, or a
// child that is no longer linked (status `unlinked`). Undefined when the children are as the snapshot read them.
function changedChild(issue) {
  const statuses = (children) => new Map(children.map((child) => [child.number, statusFromIssue(child)]));
  const before = statuses(issue.children),
    now = statuses(readSnapshot(issue.number, { children: true }).issue.children);
  const number = [...now.keys(), ...before.keys()].find((child) => before.get(child) !== now.get(child));
  return number === undefined ? undefined : { number, status: now.get(number) ?? 'unlinked' };
}
// A rerun cannot take a close back, so the close runs only while the plan keeps the snapshot body, no other owner, and
// the snapshot children with their statuses: a child that reopened or a new child is open work.
function refuseChangedBeforeClose({ issue, login }) {
  if (ownedPreWriteIssue(issue.number, login).body !== issue.body || changedChild(issue))
    fail('plan issue changed remotely; re-read and retry');
}
// The Done when cell of a parent row (E1).
const CHILD_ROW = /^child #([1-9]\d*) finished$/;
// The children that the Steps rows of a parent name: every row has Files `-` and Done when `child #<c> finished` (E1).
// Undefined for a plan without rows or with a row of its own landing work.
function parentRowChildren(parsed) {
  const named = parsed.steps.map((step) =>
    unquoteCode(step.files.trim()).trim() === '-' ? Number(CHILD_ROW.exec(step.doneWhen)?.[1]) : Number.NaN,
  );
  return named.length > 0 && named.every((child) => !Number.isNaN(child)) ? named : undefined;
}
// Whether no named child is linked and finished. `statuses` maps each linked child to its status.
const noNamedChildFinished = (named, statuses) => !named.some((child) => statuses.get(child) === 'finished');
// The children that the rows of a parent name, for the parent recovery rules. They apply only while the latest trusted
// archive record says that the plan was archived as a parent: a plan archived with its landing pull request, or one
// that no archive record names, landed or closed without the child proof, so these rules would misread it.
const parentRecoveryChildren = ({ issue, parsed }) =>
  archiveKind(issue) === 'parent' ? parentRowChildren(parsed) : undefined;
// The open work of a plan that reads closed as completed, as one child and its status, or undefined when it shows none.
// A child that is not terminal is open work on every plan. On a plan archived as a parent, after archive's own close,
// `snapshot` holds the children of its pre-close read, and a child that is new, a child that is no longer linked
// (status `unlinked`), or child rows that name no finished child count too. On such a plan without a snapshot, a row
// that names a child that is not linked, and rows that name no finished child, count too.
function openWork({ issue, parsed }, snapshot) {
  const statuses = (children) => new Map(children.map((child) => [child.number, statusFromIssue(child)]));
  const now = statuses(issue.children),
    before = snapshot && statuses(snapshot),
    named = parentRecoveryChildren({ issue, parsed });
  const work = (number) => ({ number, status: now.get(number) ?? 'unlinked' });
  const open = [...now.keys()].find(
    (child) => !CHILD_TERMINAL_STATUSES.has(now.get(child)) || (named && before?.has(child) === false),
  );
  if (open !== undefined) return work(open);
  if (!named) return undefined;
  const unlinked = (before ? [...before.keys()] : named).find((child) => !now.has(child));
  if (unlinked !== undefined) return work(unlinked);
  if (noNamedChildFinished(named, now))
    return work(named.find((child) => before?.get(child) === 'finished') ?? named[0]);
  return undefined;
}
// Archive found open `work` on `observed`, a plan that it closed or that reads closed as completed. It reopens the plan
// as `reopen` does, after the settle wait, while the settled read still shows the same close and open work, and then
// refuses with that work. A plan that someone reopened gets no write.
function reopenForOpenWork(observed, work, snapshot) {
  const { number } = observed.issue;
  if (isClosed(observed))
    settleAndReopen({
      observed,
      read: () => readPlanIssue(number, true, { comments: true, children: true, closure: true, labelLookup: true }),
      command: 'archive',
      stillReopenable: (plan) => {
        refuseStuck(plan.issue);
        return openWork(plan, snapshot) !== undefined;
      },
      comment: `Reopened: child #${work.number} changed while plan #${number} closed; work continues.`,
    });
  fail(`archive refused: child #${work.number} is ${work.status}`);
}
// A close cannot see a child change that races it, so archive reads the plan again after its own close and compares
// the children with `snapshot`, the children of its pre-close read.
function checkAfterOwnClose(number, snapshot) {
  const after = readPlanIssue(number, true, { comments: true, children: true, closure: true, labelLookup: true });
  const work = openWork(after, snapshot);
  if (work) reopenForOpenWork(after, work, snapshot);
  if (!isClosed(after)) fail('plan issue changed remotely; re-read and retry');
}
// A parent holds one row per child plan, with Files `-` and Done when `child #<c> finished`, and every child has its
// row (E1). Any other plan with children landed work of its own, so it needs the proof of `--pr`.
function isParentPlan({ issue, parsed }) {
  const children = new Set(issue.children.map((child) => child.number));
  const named = parentRowChildren(parsed);
  return (
    named?.every((child) => children.has(child)) &&
    new Set(named).size === named.length &&
    named.length === children.size
  );
}
// The trusted comments of the current archive cycle: the ones after the latest trusted reopen comment.
function cycleComments(issue) {
  const trusted = trustedComments(issue);
  return trusted.slice(trusted.findLastIndex(isReopenComment) + 1);
}
// Whether the current archive cycle already holds a trusted comment with the line `record`, so that a rerun does not
// post the record again, while the archive after a reopen gets its own record.
const recorded = (issue, record) =>
  cycleComments(issue).some((comment) => comment.body.split(/\r?\n/).some((line) => line.trim() === record));
// An unassigned plan is claimed before archive closes it, so that the record of the close is a trusted comment when the
// read after the close needs it.
function claimBeforeClose(plan) {
  if (plan.issue.claimantId === undefined) return;
  writeIssueIfUnchanged(plan.issue);
  delete plan.issue.claimantId;
}
// Post the archive `record` on a plan that archive did not close itself, unless a rerun posted it already.
function postRecordOnce({ issue, login }, record) {
  if (recorded(issue, record)) return;
  const { id } = ownedPreWriteIssue(issue.number, login);
  graphqlData([
    '-f',
    'query=mutation($issue:ID!,$body:String!){addComment(input:{subjectId:$issue,body:$body}){clientMutationId}}',
    '-f',
    `issue=${id}`,
    '-f',
    `body=${record}`,
  ]);
}
// The archive of a parent plan: its work landed through its child plans, so a child that closed as completed is the
// landing proof, and the parent needs no pull request and no code review (E1). A plan that reads closed as completed
// while its children show open work, such as after a failed read that followed the close, is reopened safely. The
// close posts the parent archive record.
function archiveParent(number) {
  const plan = readPlanIssue(number, true, { comments: true, children: true, closure: true, labelLookup: true });
  const work = plan.status === 'finished' ? openWork(plan) : undefined;
  if (work) reopenForOpenWork(plan, work);
  const { children } = plan.issue;
  if (children.length === 0) fail('archive requires an issue and --pr');
  refuseUnarchivable(plan, { codeReview: false });
  if (!isParentPlan(plan)) fail(`archive refused: plan #${number} has its own landing work; archive it with --pr`);
  if (!children.some((child) => statusFromIssue(child) === 'finished'))
    fail(`archive refused: no child of plan #${number} finished; retire the parent`);
  const record = parentRecord(children);
  if (!isClosed(plan)) {
    claimBeforeClose(plan);
    refuseChangedBeforeClose(plan);
    // gh posts the comment before it closes, so the record of a close that failed after it is not posted again.
    const comment = recorded(plan.issue, record) ? [] : ['--comment', record];
    runGh(['issue', 'close', String(number), '--reason', 'completed', ...comment, '--repo', repository.nameWithOwner]);
    checkAfterOwnClose(number, children);
  } else postRecordOnce(plan, record);
  writeIssueIfUnchanged(plan.issue, { remove: labelsToRemove(plan.issue) });
  console.log(`plan #${number} finished (all ${children.length} children finished)`);
}
// The archive of a plan whose work landed through the pull request that `--pr` names. That pull request is the landing
// proof: the latest close of the plan can come from a commit, another pull request, or a person.
function archivePlan(args) {
  const [value, ...flags] = args,
    pr = parseOptions(flags, new Set(['--pr']))['--pr'];
  if (!value) fail('archive requires an issue and --pr');
  if (pr === undefined) return archiveParent(parseIssueNumber(value));
  const number = parseIssueNumber(value),
    pullRequest = readPullRequest(parseIssueNumber(pr, 'pull request'), number);
  if (!pullRequest.merged) fail(`pull request #${pullRequest.number} is not merged`);
  // Each read is a snapshot for the write: it checks ownership, decides the claim, and must still be archivable. A plan
  // that reads closed as completed while a child shows open work, such as after a failed read that followed archive's
  // close, is reopened safely before the archive refusals.
  const read = () => {
    const plan = readPlanIssue(number, true, {
      comments: true,
      defaultBranch: true,
      children: true,
      closure: true,
      labelLookup: true,
    });
    const work = plan.status === 'finished' ? openWork(plan) : undefined;
    if (work) reopenForOpenWork(plan, work);
    refuseUnarchivable(plan);
    return plan;
  };
  let observed = read();
  const { nameWithOwner } = repository,
    defaultBranch = repository.defaultBranchRef.name;
  if (pullRequest.baseRefName !== defaultBranch)
    fail(
      `pull request #${pullRequest.number} merged into ${pullRequest.baseRefName}; archive requires a merge into ${nameWithOwner}:${defaultBranch}`,
    );
  if (typeof pullRequest.body !== 'string' || !hasClosingKeyword(pullRequest.body, number, nameWithOwner))
    fail(
      `pull request #${pullRequest.number} has no closing keyword for plan #${number} in its description; ask the owner before you add \`Closes #${number}\` to the merged pull request, then run archive again`,
    );
  // A state change that races GitHub's own close for a merge can leave the plan stuck (#90), so an open plan gets the
  // waits of reopen before archive closes it.
  for (let reads = 1; !isClosed(observed) && reads < CLOSE_WAIT_READS; reads += 1) {
    sleep(CLOSE_WAIT_PAUSES_MS[Math.min(reads, CLOSE_WAIT_PAUSES_MS.length) - 1]);
    observed = read();
  }
  // The close comes before the label removal: a failed close leaves the plan ongoing and a failed removal leaves it
  // finished, so a rerun archives it either way. Without its phase label, an open plan would no longer be archivable.
  const record = landingRecord(pullRequest.number);
  if (!isClosed(observed)) {
    refuseChangedBeforeClose(observed);
    // One comment explains the close and holds the archive record.
    const comment = `Closed by archive: pull request #${pullRequest.number} merged into ${defaultBranch} and closes this plan, but GitHub left the plan open.\n\n${record}`;
    // gh posts the comment before it closes, so the comment of a close that failed after it is not posted again.
    const commented = cycleComments(observed.issue).some((entry) => entry.body === comment);
    runGh([
      'issue',
      'close',
      String(number),
      '--reason',
      'completed',
      ...(commented ? [] : ['--comment', comment]),
      '--repo',
      nameWithOwner,
    ]);
    checkAfterOwnClose(number, observed.issue.children);
  } else postRecordOnce(observed, record);
  writeIssueIfUnchanged(observed.issue, { remove: labelsToRemove(observed.issue) });
  console.log(`plan #${number} finished (closed by ${pullRequest.url})`);
}
function retirePlan(args) {
  const [value, ...flags] = args,
    options = parseOptions(flags, new Set(['--reason']));
  if (!options['--reason']?.trim() || /[\r\n]/.test(options['--reason']))
    fail('retire requires a single-line --reason');
  const { issue, status } = readPlanIssue(value, true);
  if (String(issue.state).toUpperCase() === 'CLOSED') fail(`cannot retire a ${status} plan`);
  writeIssueIfUnchanged(issue, { remove: labelsToRemove(issue) });
  runGh([
    'issue',
    'close',
    String(issue.number),
    '--reason',
    'not planned',
    '--comment',
    options['--reason'].replaceAll('\u2014', ' - ').replace(/ {2,}/g, ' '),
    '--repo',
    repository.nameWithOwner,
  ]);
  console.log(`plan #${issue.number} retired`);
}
// Block the process for `ms` milliseconds. A reopen 1 s after GitHub closed a plan for a merged pull request raced
// that close and left the issue stuck closed with reason REOPENED (#90). So `reopen` and `archive` pause between their
// reads until they see the close, and `reopen` then waits REOPEN_SETTLE_MS for the close to settle before it writes.
function sleep(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}
function isClosed({ issue }) {
  return String(issue.state).toUpperCase() === 'CLOSED';
}
// Pull request `number`: whether, when, and where it merged, its description, and whether GitHub lists plan
// `planNumber` of this repository among the issues that it closes.
function readPullRequest(number, planNumber) {
  const references = (after) =>
    issueConnectionSelection('closingIssuesReferences', 'number repository{nameWithOwner}', '', after);
  const query = `query($owner:String!,$name:String!,$pr:Int!){repository(owner:$owner,name:$name){nameWithOwner pullRequest(number:$pr){url merged mergedAt baseRefName body ${references(false)}}}}`;
  const repo = graphql(query, { pr: number }).repository;
  const pullRequest = repo?.pullRequest;
  if (
    typeof repo?.nameWithOwner !== 'string' ||
    typeof pullRequest?.url !== 'string' ||
    typeof pullRequest.merged !== 'boolean' ||
    (pullRequest.merged && !Number.isFinite(Date.parse(pullRequest.mergedAt))) ||
    typeof pullRequest.baseRefName !== 'string' ||
    (pullRequest.body !== null && typeof pullRequest.body !== 'string')
  )
    fail('gh api graphql returned malformed pull request');
  const pageQuery = `query($owner:String!,$name:String!,$pr:Int!,$after:String!){repository(owner:$owner,name:$name){pullRequest(number:$pr){${references(true)}}}}`;
  const closed = connectionNodes(
    pullRequest.closingIssuesReferences,
    'closing issue references',
    (after) => graphql(pageQuery, { pr: number, after }).repository?.pullRequest?.closingIssuesReferences,
  );
  if (closed.some((issue) => !Number.isInteger(issue.number) || typeof issue.repository?.nameWithOwner !== 'string'))
    fail('gh api graphql returned malformed closing issue references');
  return {
    number,
    url: pullRequest.url,
    merged: pullRequest.merged,
    mergedAt: pullRequest.mergedAt,
    baseRefName: pullRequest.baseRefName,
    body: pullRequest.body,
    closesPlan: closed.some(
      (issue) => issue.number === planNumber && issue.repository.nameWithOwner === repo.nameWithOwner,
    ),
  };
}
// Whether the latest close of the plan came from the merged pull request, directly or through a commit associated
// with it; false while that close predates the merge or the plan has none. Refuses a stuck plan and a close by
// another closer after the merge.
function closedByPullRequest(issue, pullRequest) {
  refuseStuck(issue);
  if (issue.closedEventAt === undefined || Date.parse(issue.closedEventAt) < Date.parse(pullRequest.mergedAt))
    return false;
  const { closer } = issue;
  const isPullRequest = (candidate) =>
    candidate.number === pullRequest.number && candidate.repository.nameWithOwner === repository.nameWithOwner;
  const fromPullRequest =
    closer?.__typename === 'PullRequest'
      ? isPullRequest(closer)
      : closer?.__typename === 'Commit' && pullRequestNodes(associatedNodes(closer)).some(isPullRequest);
  if (!fromPullRequest)
    fail(
      `plan #${issue.number} was closed by ${describeCloser(closer)} after pull request #${pullRequest.number} merged; reopen it by hand only if that close was a mistake`,
    );
  return true;
}
// Whether a label is a phase label: `plan:` and a plan status.
const isPhaseLabel = (name) => token(name).startsWith('plan:') && PLAN_STATUSES.has(token(name).slice(5));
// One write request reopens the plan, posts `comment`, and claims an unassigned plan. It changes no label that the plan
// holds, so a label that someone adds meanwhile survives. Only when the read right before the write shows no phase
// label, as after a finished archive, does the same request add `plan:ongoing`. GitHub labels have no compare-and-set,
// so a phase label can still change around the write: the read after it must show an open plan with exactly one phase
// label. A plan that reads closed again was closed by someone after the write, and the refusal names `command`, whose
// rerun reads that close and decides again. An open plan with no phase label or with more than one is refused with the
// repair through `status`. A reopen compares no body, so the pre-write read is its last ownership check: an owner that
// appeared after the snapshot is refused, and the claim follows that read. The last field returns the stored state,
// which shows whether GitHub left the plan stuck.
function writeReopen({ issue, login, viewerId, labelIds }, comment, command) {
  const { id, assignees } = ownedPreWriteIssue(issue.number, login);
  const claims = assignees.length === 0;
  const restoresPhase = !readSnapshot(issue.number).issue.labels.some((label) => isPhaseLabel(label.name));
  const phaseLabelId = restoresPhase ? (labelIds.get('plan:ongoing') ?? createdLabelId('plan:ongoing')) : undefined;
  const stored = '{... on Issue{state stateReason}}';
  const fields = [
    'reopenIssue(input:{issueId:$issue}){clientMutationId}',
    ...(restoresPhase ? ['addLabelsToLabelable(input:{labelableId:$issue,labelIds:$labels}){clientMutationId}'] : []),
    `addComment(input:{subjectId:$issue,body:$body}){${claims ? 'clientMutationId' : `subject${stored}`}}`,
  ];
  if (claims)
    fields.push(`addAssigneesToAssignable(input:{assignableId:$issue,assigneeIds:$assignees}){assignable${stored}}`);
  const declarations = [
    '$issue:ID!',
    '$body:String!',
    ...(restoresPhase ? ['$labels:[ID!]!'] : []),
    ...(claims ? ['$assignees:[ID!]!'] : []),
  ];
  let data;
  try {
    data = graphqlData([
      '-f',
      `query=mutation(${declarations.join(',')}){${fields.join(' ')}}`,
      '-f',
      `issue=${id}`,
      '-f',
      `body=${comment}`,
      ...(restoresPhase ? ['-f', `labels[]=${phaseLabelId}`] : []),
      ...(claims ? ['-f', `assignees[]=${viewerId}`] : []),
    ]);
  } catch (error) {
    // GitHub answers the reopen of a stuck plan with "Could not reopen the issue." (#90); the request is not retried.
    refuseStuck(readSnapshot(issue.number).issue);
    throw error;
  }
  const payload = claims ? data.addAssigneesToAssignable?.assignable : data.addComment?.subject;
  if (typeof payload?.state !== 'string' || (payload.stateReason !== null && typeof payload.stateReason !== 'string'))
    fail('gh api graphql returned malformed stored plan issue');
  refuseStuck({ ...issue, state: payload.state, stateReason: payload.stateReason });
  // The status comes from a fresh read, which must show an open plan with exactly one phase label.
  const current = readSnapshot(issue.number).issue,
    status = statusFromIssue(current);
  refuseStuck(current);
  if (isClosed({ issue: current })) fail(`plan #${issue.number} closed again after the reopen; run ${command} again`);
  if (!PLAN_STATUSES.has(status))
    fail(`plan issue state differs after reopen; run status ${issue.number} ongoing to repair the phase labels`);
  console.log(`plan #${issue.number} reopened: ${status}`);
}
// A v5 plan lands each pull request through a child plan with `Closes #<child>`, so a partial pull request never
// closes it (E2). The refusal comes before the pull request read, whatever the state of that pull request. `gh issue
// view` resolves the repository as the GraphQL reads do, and it is no GraphQL read of the plan, so the reads that the
// close waits count stay the same.
function refuseChildPlanReopen(number) {
  const viewed = parseJson(runGh(['issue', 'view', String(number), '--json', 'body']), 'gh issue view');
  if (typeof viewed?.body !== 'string') fail('gh issue view returned malformed plan issue');
  if (contractVersion(viewed.body) === 5)
    fail(
      `plan #${number} uses child plans; a partial pull request is not allowed (open a child plan with new --parent ${number})`,
    );
}
// The reopen after a partial pull request closed the plan through its linked branch (#90).
function reopenPlan(args) {
  const [value, ...flags] = args,
    pr = parseOptions(flags, new Set(['--pr']))['--pr'];
  if (!value || !pr) fail('reopen requires an issue and --pr');
  const number = parseIssueNumber(value),
    prNumber = parseIssueNumber(pr, 'pull request');
  refuseChildPlanReopen(number);
  const pullRequest = readPullRequest(prNumber, number);
  if (!pullRequest.merged) fail(`pull request #${pullRequest.number} is not merged`);
  if (!pullRequest.closesPlan) {
    console.log(`pull request #${pullRequest.number} does not close plan #${number}; nothing to reopen`);
    return;
  }
  // Each read is a snapshot for the write: it checks ownership and decides the claim.
  const read = () => readPlanIssue(number, true, { closure: true, labelLookup: true });
  let observed = read();
  for (let reads = 1; !closedByPullRequest(observed.issue, pullRequest); reads += 1) {
    if (reads === CLOSE_WAIT_READS) {
      // GitHub cannot close a closed issue, so a plan that still reads closed by an earlier close never gets the
      // close from this merge; telling the caller to run reopen again would loop forever.
      if (isClosed(observed))
        fail(
          `plan #${number} was closed by ${describeCloser(observed.issue.closer)} before pull request #${pullRequest.number} merged; reopen it by hand only if that close was a mistake`,
        );
      fail(
        `GitHub has not closed plan #${number} for pull request #${pullRequest.number} yet; run reopen again once it has`,
      );
    }
    sleep(CLOSE_WAIT_PAUSES_MS[Math.min(reads, CLOSE_WAIT_PAUSES_MS.length) - 1]);
    observed = read();
  }
  // A plan that reads open was reopened after that close.
  if (!isClosed(observed)) {
    console.log(`plan #${number} is open: ${observed.status}`);
    return;
  }
  const current = settleAndReopen({
    observed,
    read,
    command: 'reopen',
    stillReopenable: (plan) => closedByPullRequest(plan.issue, pullRequest),
    comment: `Reopened: partial pull request #${pullRequest.number} closed this plan through its linked branch. Work continues.`,
  });
  if (current) console.log(`plan #${number} is open: ${current.status}`);
}
// A reopen right after a close can leave the plan stuck closed with reason REOPENED (#90). So a reopen of `observed`, a
// plan that reads closed, waits REOPEN_SETTLE_MS and reads the plan again. It writes only while that read shows the
// same close as completed and `stillReopenable` accepts it. When someone reopened the plan during the wait, it writes
// nothing and returns that read.
function settleAndReopen({ observed, read, command, stillReopenable, comment }) {
  sleep(REOPEN_SETTLE_MS);
  const current = read();
  const sameClose =
    stillReopenable(current) &&
    current.issue.closedEventAt === observed.issue.closedEventAt &&
    describeCloser(current.issue.closer) === describeCloser(observed.issue.closer);
  if (isClosed(current) && (current.status !== 'finished' || !sameClose))
    fail(`plan #${current.issue.number} changed during the settle wait; run ${command} again`);
  if (!isClosed(current)) return current;
  writeReopen(current, comment, command);
  return undefined;
}
function main([command, ...args]) {
  const commands = {
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
  if (!Object.hasOwn(commands, command))
    fail('usage: plan.mjs <new|show|export|edit|status|step|list|archive|retire|reopen> ...');
  repository = undefined;
  commands[command](args);
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    main(process.argv.slice(2));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
