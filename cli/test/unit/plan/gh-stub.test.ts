import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  GH_STUB,
  PLAN_CLI_HOST_SUPPORTED,
  type PlanCliContext,
  type PlanResult,
  planCliContext,
} from "../../lib/plan/harness";
import { SPAWN_TIMEOUT_MS } from "../../lib/spawnTimeout";

/**
 * These cases call the fake gh directly. A fixture field that the query does
 * not select must not reach the helper, or a plan CLI test passes for a query
 * that GitHub would answer without that field.
 */
const REPO = "DocksDocks/fixture";
const PR = 7;
const PR_URL = `https://github.com/DocksDocks/fixture/pull/${PR}`;
const MERGED_AT = "2026-08-21T00:00:00Z";
const OID = "c0ffee0000000000000000000000000000000007";

// Run the fake gh with the state file that `planCliContext` keeps in its scratch folder.
function gh({ scratch }: PlanCliContext, args: ReadonlyArray<string>): PlanResult {
  return spawnSync(GH_STUB, args, {
    cwd: scratch,
    encoding: "utf8",
    env: { ...process.env, GH_STUB_STATE: join(scratch, "gh-state.json") },
  });
}

// Run `gh api graphql` on the fake gh. A number variable goes with -F, as the helper sends it, and a string variable
// with -f.
function graphql(
  context: PlanCliContext,
  query: string,
  variables: Readonly<Record<string, string | number>> = {},
): PlanResult {
  const args = [
    "api",
    "graphql",
    "-f",
    `query=${query}`,
    "-f",
    "owner=DocksDocks",
    "-f",
    "name=fixture",
  ];
  for (const [key, value] of Object.entries(variables)) {
    args.push(typeof value === "number" ? "-F" : "-f", `${key}=${value}`);
  }
  return gh(context, args);
}

/** The value at `keys` of parsed JSON, or undefined where a key is missing. */
function at(value: unknown, ...keys: ReadonlyArray<string>): unknown {
  let current = value;
  for (const key of keys) {
    current =
      typeof current === "object" && current !== null && key in current
        ? Reflect.get(current, key)
        : undefined;
  }
  return current;
}

// The `repository` object of a successful GraphQL response.
function responseRepository(result: PlanResult): unknown {
  expect(result.status, result.stderr).toBe(0);
  return at(JSON.parse(result.stdout), "data", "repository");
}

// A merged pull request that stores every field that the fake gh can return.
function seedPullRequest({ updateState }: PlanCliContext): void {
  updateState((state) => {
    state.prs.push({
      number: PR,
      url: PR_URL,
      state: "MERGED",
      mergedAt: MERGED_AT,
      baseRefName: "main",
      body: "Closes #1",
      repository: "DocksDocks/fixture",
      closingIssuesReferences: [1],
    });
  });
}

function pullRequest(context: PlanCliContext, fields: string): PlanResult {
  const query = `query($owner:String!,$name:String!,$pr:Int!){repository(owner:$owner,name:$name){pullRequest(number:$pr){${fields}}}}`;
  return graphql(context, query, { pr: PR });
}

// Repository.object for a commit that is associated with the seeded pull request, as the helper reads the pull
// requests of a commit closer. `fields` is the selection set of the associatedPullRequests connection.
function associatedPullRequests(context: PlanCliContext, fields: string): PlanResult {
  context.updateState((state) => {
    state.commits = [{ oid: OID, associatedPullRequests: [{ number: PR }] }];
  });
  const query = `query($owner:String!,$name:String!,$oid:String!){repository(owner:$owner,name:$name){commit:object(expression:$oid){... on Commit{associatedPullRequests(first:100){${fields}}}}}}`;
  return graphql(context, query, { oid: OID });
}

describe.skipIf(!PLAN_CLI_HOST_SUPPORTED)("the fake gh", () => {
  it(
    "returns only the selected fields of Repository.pullRequest",
    () => {
      const context = planCliContext();
      seedPullRequest(context);
      const repository = responseRepository(pullRequest(context, "number url"));
      expect(at(repository, "pullRequest")).toStrictEqual({ number: PR, url: PR_URL });
    },
    SPAWN_TIMEOUT_MS,
  );

  it(
    "returns only the selected fields of a pull request closer",
    () => {
      const context = planCliContext();
      // The stored closer has a URL, a state, a merge time, a base branch, a body, and a repository.
      const { number, closer } = context.closedPlan("closer fields");
      for (const [closerFields, expected] of [
        [
          "__typename ... on PullRequest{number} ... on Commit{oid}",
          { __typename: "PullRequest", number: closer.number },
        ],
        ["... on PullRequest{number}", { number: closer.number }],
      ] as const) {
        const query = `query($owner:String!,$name:String!,$number:Int!){repository(owner:$owner,name:$name){issue(number:$number){timelineItems(last:1,itemTypes:[CLOSED_EVENT]){nodes{... on ClosedEvent{closer{${closerFields}}}}}}}}`;
        const repository = responseRepository(graphql(context, query, { number }));
        expect(at(repository, "issue", "timelineItems"), closerFields).toStrictEqual({
          nodes: [{ closer: expected }],
        });
      }
    },
    SPAWN_TIMEOUT_MS,
  );

  it(
    "returns only the selected fields of a closer for each aliased timeline connection",
    () => {
      const context = planCliContext();
      const { number, closer } = context.closedPlan("aliased closers");
      // Each connection selects other fields of the same close, and GitHub answers each with its own selection.
      const closures = (fields: string): string =>
        `timelineItems(last:1,itemTypes:[CLOSED_EVENT]){nodes{... on ClosedEvent{${fields}}}}`;
      const query = `query($owner:String!,$name:String!,$number:Int!){repository(owner:$owner,name:$name){issue(number:$number){updatedAt a:${closures("closer{... on PullRequest{number}}")} b:${closures("createdAt closer{... on PullRequest{url}}")}}}}`;
      const issue = at(responseRepository(graphql(context, query, { number })), "issue");
      expect(at(issue, "a")).toStrictEqual({ nodes: [{ closer: { number: closer.number } }] });
      // The stored close has no time, so the fake gh stamps it with the issue's last update.
      expect(at(issue, "b")).toStrictEqual({
        nodes: [{ createdAt: at(issue, "updatedAt"), closer: { url: closer.url } }],
      });
    },
    SPAWN_TIMEOUT_MS,
  );

  it(
    "returns only the selected fields of the pull requests associated with a commit",
    () => {
      const context = planCliContext();
      seedPullRequest(context);
      const repository = responseRepository(associatedPullRequests(context, "nodes{number}"));
      expect(at(repository, "commit")).toStrictEqual({
        associatedPullRequests: { nodes: [{ number: PR }] },
      });
    },
    SPAWN_TIMEOUT_MS,
  );

  it(
    "merges the repeated node selections of a connection",
    () => {
      const context = planCliContext();
      seedPullRequest(context);
      const repository = responseRepository(
        associatedPullRequests(context, "nodes{number} nodes{url}"),
      );
      expect(at(repository, "commit")).toStrictEqual({
        associatedPullRequests: { nodes: [{ number: PR, url: PR_URL }] },
      });
    },
    SPAWN_TIMEOUT_MS,
  );

  it(
    "gives the repository of a pull request its type",
    () => {
      const context = planCliContext();
      seedPullRequest(context);
      const repository = responseRepository(
        pullRequest(context, "repository{__typename ... on Repository{nameWithOwner}}"),
      );
      expect(at(repository, "pullRequest")).toStrictEqual({
        repository: { __typename: "Repository", nameWithOwner: "DocksDocks/fixture" },
      });
    },
    SPAWN_TIMEOUT_MS,
  );

  it(
    "merges the repeated selections of an object field",
    () => {
      const context = planCliContext();
      seedPullRequest(context);
      const names = { a: "DocksDocks/fixture", b: "DocksDocks/fixture" };
      const repository = responseRepository(
        pullRequest(context, "repository{a:nameWithOwner} repository{b:nameWithOwner}"),
      );
      expect(at(repository, "pullRequest")).toStrictEqual({ repository: names });
      // The selections also merge when two selections of the parent field hold them.
      const nested = responseRepository(
        associatedPullRequests(
          context,
          "nodes{repository{a:nameWithOwner}} nodes{repository{b:nameWithOwner}}",
        ),
      );
      expect(at(nested, "commit")).toStrictEqual({
        associatedPullRequests: { nodes: [{ repository: names }] },
      });
    },
    SPAWN_TIMEOUT_MS,
  );

  it(
    "refuses an object field without subfields",
    () => {
      const context = planCliContext();
      seedPullRequest(context);
      // The bare field is in the selection set of the pull request, and also in the second of two `nodes` selections.
      for (const result of [
        pullRequest(context, "number repository"),
        associatedPullRequests(context, "nodes{number} nodes{repository}"),
      ]) {
        expect(result.status).toBe(1);
        expect(result.stderr).toBe(
          "Field must have selections (field 'repository' has no selections. Did you mean 'repository { ... }'?)\n",
        );
      }
    },
    SPAWN_TIMEOUT_MS,
  );

  it(
    "returns an aliased pull request field only under its alias",
    () => {
      const context = planCliContext();
      seedPullRequest(context);
      // GitHub returns `landed` with the merge time and no `mergedAt`, also for an alias in a nested selection.
      const repository = responseRepository(
        pullRequest(context, "landed: mergedAt number repo: repository{fullName: nameWithOwner}"),
      );
      expect(at(repository, "pullRequest")).toStrictEqual({
        landed: MERGED_AT,
        number: PR,
        repo: { fullName: "DocksDocks/fixture" },
      });
    },
    SPAWN_TIMEOUT_MS,
  );

  it(
    "returns the value of the selected field for an alias that names another field",
    () => {
      const context = planCliContext();
      seedPullRequest(context);
      const repository = responseRepository(pullRequest(context, "mergedAt: url"));
      expect(at(repository, "pullRequest")).toStrictEqual({ mergedAt: PR_URL });
    },
    SPAWN_TIMEOUT_MS,
  );

  it(
    "refuses a response key that names two different fields",
    () => {
      const context = planCliContext();
      seedPullRequest(context);
      const result = pullRequest(context, "number: url number");
      expect(result.status).toBe(1);
      expect(result.stderr).toBe("Field 'number' has a field conflict: url or number?\n");
    },
    SPAWN_TIMEOUT_MS,
  );

  it(
    "posts the `issue close` comment as the viewer, closes without a closer, and skips a closed issue",
    () => {
      const context = planCliContext();
      const number = context.createPlan("closed through gh issue close");
      const close = (comment: string): PlanResult =>
        gh(context, [
          "issue",
          "close",
          String(number),
          "--reason",
          "completed",
          "--comment",
          comment,
          "--repo",
          REPO,
        ]);
      const closed = close("Closed by hand.");
      expect(closed.status, closed.stderr).toBe(0);
      // gh reports an issue that is already closed and posts no comment on it.
      const again = close("Closed twice.");
      expect(again.status, again.stderr).toBe(0);
      expect(again.stderr).toBe(
        `! Issue ${REPO}#${number} (closed through gh issue close) is already closed\n`,
      );
      const query = `query($owner:String!,$name:String!,$number:Int!){repository(owner:$owner,name:$name){issue(number:$number){comments(first:100){nodes{author{login} body}} timelineItems(last:1,itemTypes:[CLOSED_EVENT]){nodes{... on ClosedEvent{closer{__typename}}}}}}}`;
      const issue = at(responseRepository(graphql(context, query, { number })), "issue");
      const nodes = at(issue, "comments", "nodes");
      expect(Array.isArray(nodes), "the comments connection has nodes").toBe(true);
      const comments = Array.isArray(nodes) ? nodes : [];
      expect(
        comments.map((node: unknown) => ({ author: at(node, "author"), body: at(node, "body") })),
      ).toStrictEqual([{ author: { login: "plan-agent" }, body: "Closed by hand." }]);
      expect(at(issue, "timelineItems")).toStrictEqual({ nodes: [{ closer: null }] });
    },
    SPAWN_TIMEOUT_MS,
  );
});
