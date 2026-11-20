/**
 * Shared shapes of the `docks-kit plan` command: the typed errors, the property reader for decoded JSON, and the issue
 * records that the GitHub reads produce.
 */
import { Effect, Predicate, Schema } from "effect";

/** A contract refusal, such as an invalid argument or a plan state that the command does not accept. */
export class PlanRefusal extends Schema.TaggedError<
  PlanRefusal,
  { readonly brand: unique symbol }
>()("PlanRefusal", {
  message: Schema.String,
}) {}

/** gh could not run, exited with a failure, or printed output that is not the expected JSON. */
export class GhError extends Schema.TaggedError<GhError, { readonly brand: unique symbol }>()(
  "GhError",
  {
    message: Schema.String,
  },
) {}

/** A GraphQL response with errors, without data, or with a malformed field. */
export class GraphqlError extends Schema.TaggedError<
  GraphqlError,
  { readonly brand: unique symbol }
>()("GraphqlError", {
  message: Schema.String,
}) {}

/** git could not run or exited with a failure. */
export class GitError extends Schema.TaggedError<GitError, { readonly brand: unique symbol }>()(
  "GitError",
  {
    message: Schema.String,
  },
) {}

/** A file operation failed. `message` is the Node error message; `code` is its error code, such as `ENOENT`. */
export class FileError extends Schema.TaggedError<FileError, { readonly brand: unique symbol }>()(
  "FileError",
  {
    message: Schema.String,
    code: Schema.optional(Schema.String),
  },
) {}

/** A child process could not start because Node refused its arguments. */
export class SpawnError extends Schema.TaggedError<SpawnError, { readonly brand: unique symbol }>()(
  "SpawnError",
  {
    message: Schema.String,
  },
) {}

/** Every failure of a plan command. The command edge prints its message on stderr and exits 1. */
export type PlanFailure = PlanRefusal | GhError | GraphqlError | GitError | FileError | SpawnError;

/** Stop pure code with a refusal. Effect code wraps the call in `attempt`. */
export const fail = (message: string): never => {
  throw new PlanRefusal({ message });
};

/** Run pure code that can throw a refusal, and move the refusal into the error channel. */
export const attempt = <A>(thunk: () => A): Effect.Effect<A, PlanRefusal> =>
  Effect.try({
    try: thunk,
    catch: (error) =>
      error instanceof PlanRefusal
        ? error
        : new PlanRefusal({ message: error instanceof Error ? error.message : String(error) }),
  });

/** `value?.[key]` of plan.mjs: the property of an object, or undefined for any other value. */
export const field = (value: unknown, key: string): unknown =>
  Predicate.hasProperty(value, key) ? value[key] : undefined;

export interface RepositoryInfo {
  readonly nameWithOwner: string;
  readonly visibility: string;
  readonly defaultBranch: string | undefined;
}

export interface LabelNode {
  readonly name: string;
  readonly id: string;
}

export interface NamedLabel {
  readonly name: string;
}

export interface Actor {
  readonly login: string;
}

export interface IssueComment {
  readonly fullDatabaseId: string;
  readonly body: string;
  readonly createdAt: string;
  readonly author: Actor | null;
}

export interface PullRequestNode {
  readonly number: number;
  readonly url: string;
  readonly state: string;
  readonly mergedAt: string | null;
  readonly baseRefName: string;
  readonly repository: { readonly nameWithOwner: string };
}

export type CommitCloser = {
  readonly __typename: "Commit";
  readonly oid: string;
  readonly associatedPullRequests?: unknown;
};

/** The closer of the latest close event. Any other GraphQL type is `Other`. */
export type Closer =
  | ({ readonly __typename: "PullRequest" } & PullRequestNode)
  | CommitCloser
  | { readonly __typename: "Other" };

/** A plan list row and a sub-issue row. */
export interface IssueSummary {
  readonly number: number;
  readonly title: string;
  readonly state: string;
  readonly stateReason: string | null;
  readonly labels: ReadonlyArray<NamedLabel>;
}

export interface ParentLink {
  readonly number: number;
  readonly repository: { readonly nameWithOwner: string };
}

/** The plan issue of a snapshot. A connection that the read did not select is empty or undefined. */
export interface PlanIssue {
  readonly number: number;
  readonly title: string;
  readonly body: string;
  readonly state: string;
  readonly stateReason: string | null;
  readonly url: string;
  readonly labels: ReadonlyArray<LabelNode>;
  readonly assignees: ReadonlyArray<Actor>;
  readonly comments: ReadonlyArray<IssueComment>;
  readonly history: ReadonlyArray<NamedLabel>;
  readonly closer: Closer | null | undefined;
  readonly closedEventAt: string | undefined;
  readonly children: ReadonlyArray<IssueSummary>;
  readonly parent: ParentLink | null | undefined;
  /** The viewer id that a write claims an unassigned plan for. */
  claimantId: string | undefined;
}

/** The fields that the status derivation reads; a plan issue and an issue summary both have them. */
export interface StatusSource {
  readonly state: string;
  readonly stateReason: string | null;
  readonly labels: ReadonlyArray<NamedLabel>;
}
