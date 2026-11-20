/**
 * The JSON state file of the fake gh (`GH_STUB_STATE`). The plan suites write
 * it through the harness, and the fake gh reads it, changes it, and writes it
 * back on each call. Every field that a case can set is optional unless the
 * harness always writes it. The shapes are type aliases, not interfaces, so
 * that a value also fits the open object type of a GraphQL response.
 */

/** A comment as a case stores it. `author` is a login or a GraphQL actor. */
export type StubComment = {
  id: number;
  body: string;
  author?: string | { login?: string } | null;
  user?: { login?: string };
  createdAt?: string;
  updatedAt?: string;
  url?: string;
};

/** A REST issue event, such as `{ event: "labeled", label: { name } }`. */
export type StubEvent = {
  event?: string;
  label?: { name: string };
};

/**
 * A pull request or commit reference that closed an issue, or that a commit
 * lists as associated. The fake gh completes it from `state.prs`.
 */
export type StubReference = {
  __typename?: string;
  number?: number;
  oid?: string;
  url?: string;
  state?: string;
  mergedAt?: string | null;
  body?: string | null;
  baseRefName?: string | null;
  repository?:
    | string
    | { nameWithOwner?: string; name?: string; owner?: { login?: string } }
    | null;
};

/** One timeline item: a ClosedEvent with its closer and its time. */
export type StubTimelineItem = {
  __typename?: string;
  closer?: StubReference | null;
  createdAt?: string;
};

export type StubIssue = {
  number: number;
  title: string;
  body: string;
  state: string;
  stateReason: string | null;
  labels: Array<string>;
  assignees?: Array<string>;
  url: string;
  createdAt: string;
  updatedAt: string;
  comments?: Array<StubComment>;
  events?: Array<StubEvent>;
  subIssues?: Array<number>;
  pendingChanges?: Array<StubChange>;
  graphqlReads?: number;
  timelineItems?: Array<StubTimelineItem>;
  /** Fails every GraphQL read that selects the issue. */
  readError?: string;
  /** A parent in another repository. */
  foreignParent?: { number: number; nameWithOwner: string };
};

/**
 * A change that lands on an issue: the fields that change, a ClosedEvent to
 * add, and the fields that change on other issues at the same time.
 */
export type StubChange = Partial<StubIssue> & {
  afterReads?: number;
  closedEvent?: { closer?: StubReference | null; createdAt?: string };
  otherIssues?: Record<string, Partial<StubIssue>>;
};

export type StubPullRequest = {
  number: number;
  url?: string;
  title?: string;
  state?: string;
  mergedAt?: string | null;
  mergedBy?: unknown;
  mergeStateStatus?: string;
  baseRefName?: string | null;
  headRefName?: string;
  body?: string | null;
  repository: string;
  closingIssuesReferences?: Array<number>;
};

export type StubCommit = {
  oid: string;
  repository?: string;
  associatedPullRequests?: Array<StubReference>;
};

export type StubGraphqlErrorEntry = {
  message?: string;
  type?: string;
  path?: Array<string>;
};

/**
 * A GraphQL fault for the next request: a message, a list of errors, or an
 * object whose `on` limits it to one stage (`snapshot`, `list`, `page`,
 * `mutation`).
 */
export type StubGraphqlError =
  | string
  | Array<StubGraphqlErrorEntry>
  | { on?: string; errors?: Array<StubGraphqlErrorEntry>; message?: string };

export type StubLabel = { color: string; description?: string };

export type StubState = {
  repo: {
    nameWithOwner: string;
    visibility: string;
    defaultBranchRef?: { name: string } | null;
  };
  repositoryDefaults?: Record<string, string>;
  viewerLogin?: string;
  labels: Record<string, StubLabel>;
  issues: Array<StubIssue>;
  prs: Array<StubPullRequest>;
  commits?: Array<StubCommit>;
  nextIssue: number;
  nextComment?: number;
  clock?: number;
  /** The argv of each gh call, in call order. */
  calls: Array<Array<string>>;
  remoteChange?: { issue: number; viewsBeforeChange: number; body?: string };
  graphqlError?: StubGraphqlError;
  graphqlMissingData?: { on?: string; data?: unknown };
  graphqlMissingCursor?: { on?: string; field: string };
  repoError?: string;
  viewerError?: string;
  issueEditError?: string;
  labelRemovalErrorOnce?: string;
  subIssueErrorOnce?: string;
  reopenLeavesClosed?: boolean;
  afterMutationOnce?: StubChange & { issue: number };
  ghLacksParentFlag?: boolean;
  dropCreateAssignee?: boolean;
  issueCloseErrorBeforeWriteOnce?: string;
  issueCloseErrorAfterCommentOnce?: string;
  afterCloseOnce?: StubChange & { graphqlError?: StubGraphqlError };
};
