/**
 * The fake gh of the plan suites. The executable `gh` beside this file loads
 * it, and the harness puts that folder first on PATH.
 *
 * Protocol: `GH_STUB_STATE` names a JSON state file (see `state.ts`). Each
 * call appends its argv to `state.calls`, serves the request from the state,
 * and writes the state back. The fake gh simulates issues, labels, comments,
 * pull requests, commits, and sub-issues. A GraphQL response holds only the
 * fields that the query selects, so a query that selects too little fails as
 * it would on GitHub.
 */
import fs from "node:fs";

import type {
  StubChange,
  StubComment,
  StubGraphqlErrorEntry,
  StubIssue,
  StubReference,
  StubState,
} from "./state.ts";

/** A value that a GraphQL argument or a `gh api` field holds. */
type Variable = null | undefined | boolean | number | string | Array<Variable> | VariableRecord;
type VariableRecord = { [key: string]: Variable };

/** The response key and the arguments of a field whose stored value is a function. */
type FieldSelection = { readonly alias: string; readonly args: Map<string, string> };

/**
 * An object as the fake gh renders it before selection. A function field
 * reads its arguments, such as a connection.
 */
type GqlValue =
  | null
  | undefined
  | boolean
  | number
  | string
  | Array<GqlValue>
  | GqlObject
  | ((selection: FieldSelection) => GqlValue);
type GqlObject = { [key: string]: GqlValue };

const statePath = process.env["GH_STUB_STATE"];
if (!statePath) {
  console.error("GH_STUB_STATE is required");
  process.exit(2);
}

const state = JSON.parse(fs.readFileSync(statePath, "utf8")) as StubState;
state.calls ??= [];
state.calls.push(process.argv.slice(2));
const args = process.argv.slice(2);

function save(): void {
  fs.writeFileSync(statePath as string, `${JSON.stringify(state, null, 2)}\n`);
}

function die(message: string): never {
  save();
  console.error(message);
  process.exit(1);
}

function errorCode(error: unknown): unknown {
  return typeof error === "object" && error !== null && "code" in error ? error.code : undefined;
}

// Write stdout synchronously: process.exit() after console.log() truncates large responses.
function emit(text: string): void {
  const buffer = Buffer.from(`${text}\n`);
  for (let offset = 0; offset < buffer.length; ) {
    try {
      offset += fs.writeSync(1, buffer, offset);
    } catch (error) {
      if (errorCode(error) !== "EAGAIN") throw error;
    }
  }
}

function values(flag: string): Array<string> {
  const found: Array<string> = [];
  for (let index = 0; index < args.length; index += 1) {
    const next = args[index + 1];
    if (args[index] === flag && next !== undefined) found.push(next);
  }
  return found;
}

function value(flag: string): string | undefined {
  return values(flag).at(-1);
}

function issueNumber(position = 2): number {
  const number = Number(String(args[position] ?? "").replace(/^#/, ""));
  if (!Number.isInteger(number) || number < 1) die(`invalid issue number: ${args[position] ?? ""}`);
  return number;
}

function issueByNumber(number: number): StubIssue {
  const issue = state.issues.find((entry) => entry.number === number);
  if (!issue) die(`issue not found: ${number}`);
  return issue;
}

// Node ids are opaque to the helper, as on GitHub. An issue id names the issue number, a label id the
// lowercase label name (repository labels are unique by case-insensitive name), and a user id the login.
function issueNodeId(issue: StubIssue): string {
  return `I_${issue.number}`;
}

function labelNodeId(name: string): string {
  return `LA_${Buffer.from(name.toLowerCase(), "utf8").toString("base64url")}`;
}

function userNodeId(login: string): string {
  return `U_${login}`;
}

// REST names an issue by its database id; the fake gh derives it from the issue number.
function issueDatabaseId(issue: StubIssue): number {
  return 100_000 + issue.number;
}

// Add `child` to the sub-issues of `parent`, as GitHub does for `issue create --parent` and the REST sub-issues API.
function addSubIssue(parent: StubIssue, child: StubIssue): void {
  if (parent.number === child.number) die("an issue cannot be its own sub-issue");
  if (state.issues.some((entry) => (entry.subIssues ?? []).includes(child.number)))
    die(`issue ${child.number} already has a parent`);
  parent.subIssues = [...(parent.subIssues ?? []), child.number];
  touch(parent);
}

function issueByNodeId(id: Variable): StubIssue {
  const issue = state.issues.find((entry) => issueNodeId(entry) === id);
  if (!issue) die(`Could not resolve to a node with the global id of '${String(id)}'`);
  return issue;
}

function labelNameByNodeId(id: string): string {
  const name = /^LA_[\w-]+$/.test(id) ? Buffer.from(id.slice(3), "base64url").toString("utf8") : "";
  if (!name) die(`Could not resolve to a Label node with the global id of '${id}'`);
  return name;
}

function loginByNodeId(id: string): string {
  if (!/^U_./.test(id)) die(`Could not resolve to a User node with the global id of '${id}'`);
  return id.slice(2);
}

// The helper never sends an empty id list (an empty assigneeIds would unassign everyone), so refuse one.
function nodeIds(list: Variable, field: string): Array<string> {
  if (!Array.isArray(list) || list.length === 0) die(`${field} requires a non-empty list of ids`);
  const ids: Array<string> = [];
  for (const id of list) {
    if (typeof id !== "string" || !id) die(`${field} requires a non-empty list of ids`);
    ids.push(id);
  }
  return ids;
}

function labels(names: ReadonlyArray<string>): Array<GqlValue> {
  return names.map((name) => ({ id: labelNodeId(name), name }));
}

function assignees(logins: ReadonlyArray<string> | undefined): Array<GqlValue> {
  return (logins ?? []).map((login) => ({ id: userNodeId(login), login }));
}

function select(
  object: Readonly<Record<string, unknown>>,
  fields: string | undefined,
): Readonly<Record<string, unknown>> {
  if (!fields) return object;
  const selected: Record<string, unknown> = {};
  for (const field of fields.split(",")) selected[field] = object[field];
  return selected;
}

function validateJsonFields(fields: string | undefined, allowed: ReadonlySet<string>): void {
  for (const field of (fields ?? "").split(",").filter(Boolean)) {
    if (!allowed.has(field)) die(`Unknown JSON field: "${field}"`);
  }
}

// `gh api graphql` fields as cli/cli pkg/cmd/api/fields.go reads them: gh reads every -f field before any -F
// field. A -f value stays raw. An `@<path>` -F value is the file's bytes. Any other -F value becomes an
// integer, true, false, or null, or else gets its {owner}, {repo}, {branch}, :owner, :repo, and :branch
// placeholders filled from the repository. `key[]=value` fields build an array; a bare `key[]` is empty.
function graphqlFields(): VariableRecord {
  const [owner, repo] = state.repo.nameWithOwner.split("/");
  const placeholders: Record<string, string | undefined> = {
    owner,
    repo,
    branch: state.repo.defaultBranchRef?.name ?? "main",
  };
  const magicValue = (raw: string): Variable => {
    if (raw.startsWith("@")) {
      try {
        return fs.readFileSync(raw.slice(1), "utf8");
      } catch (error) {
        die(`open ${raw.slice(1)}: ${String(errorCode(error))}`);
      }
    }
    if (/^[+-]?\d+$/.test(raw)) return Number(raw);
    if (raw === "true" || raw === "false") return raw === "true";
    if (raw === "null") return null;
    return raw.replace(
      /:(owner|repo|branch)\b|\{([a-z]+)\}/g,
      (match, colon: string | undefined, braced: string | undefined) =>
        placeholders[colon ?? braced ?? ""] ?? match,
    );
  };
  const fields: VariableRecord = {};
  for (const [flag, magic] of [
    ["-f", false],
    ["-F", true],
  ] as const) {
    for (const entry of values(flag)) {
      const separator = entry.indexOf("=");
      const key = separator < 0 ? entry : entry.slice(0, separator);
      const name = key.endsWith("[]") ? key.slice(0, -2) : key;
      if (!name || /[[\]]/.test(name)) die(`invalid key: "${entry}"`);
      if (separator < 0 && name === key)
        die(`field "${entry}" requires a value separator '=' character`);
      const raw = separator < 0 ? undefined : entry.slice(separator + 1);
      const fieldValue = magic && raw !== undefined ? magicValue(raw) : raw;
      if (name === key) fields[name] = fieldValue;
      else {
        const list = fields[name];
        const array: Array<Variable> = Array.isArray(list) ? list : [];
        fields[name] = array;
        if (separator >= 0) array.push(fieldValue);
      }
    }
  }
  return fields;
}

function connectionPage(
  nodes: ReadonlyArray<GqlValue>,
  cursor: string | undefined,
  prefix: string,
  first = 100,
): GqlObject {
  let start = 0;
  if (cursor !== undefined) {
    const match = new RegExp(`^${prefix}:(\\d+)$`).exec(cursor);
    if (!match) die(`invalid GraphQL cursor: ${cursor}`);
    start = Number(match[1]);
  }
  const pageNodes = nodes.slice(start, start + first);
  const end = start + pageNodes.length;
  return {
    nodes: pageNodes,
    pageInfo: {
      hasNextPage: end < nodes.length,
      endCursor: pageNodes.length > 0 ? `${prefix}:${end}` : (cursor ?? null),
    },
  };
}

function graphqlValue(expression: string | undefined, variables: VariableRecord): Variable {
  if (expression === undefined) return undefined;
  if (expression.startsWith("$")) return variables[expression.slice(1)];
  if (expression === "true") return true;
  if (expression === "false") return false;
  if (expression === "null") return null;
  if (/^\d+$/.test(expression)) return Number(expression);
  if (expression.startsWith('"')) return JSON.parse(expression) as Variable;
  if (expression.startsWith("[")) {
    return splitArguments(expression.slice(1, -1)).map((item) => graphqlValue(item, variables));
  }
  if (expression.startsWith("{")) {
    const entries = [...graphqlArguments(expression.slice(1, -1))];
    return Object.fromEntries(entries.map(([key, item]) => [key, graphqlValue(item, variables)]));
  }
  return expression;
}

// Split arguments, list items, or object fields on the commas outside nested lists, objects, and strings.
function splitArguments(text: string): Array<string> {
  const parts: Array<string> = [];
  let depth = 0;
  let quoted = false;
  let start = 0;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (quoted) {
      if (char === "\\") index += 1;
      else if (char === '"') quoted = false;
    } else if (char === '"') quoted = true;
    else if (char === "[" || char === "{") depth += 1;
    else if (char === "]" || char === "}") depth -= 1;
    else if (char === "," && depth === 0) {
      parts.push(text.slice(start, index));
      start = index + 1;
    }
  }
  parts.push(text.slice(start));
  return parts.map((part) => part.trim()).filter(Boolean);
}

function graphqlArguments(text: string): Map<string, string> {
  const parsed = new Map<string, string>();
  for (const argument of splitArguments(text)) {
    const separator = argument.indexOf(":");
    if (separator < 0) die(`invalid GraphQL argument: ${argument}`);
    parsed.set(argument.slice(0, separator).trim(), argument.slice(separator + 1).trim());
  }
  return parsed;
}

type Selection = {
  readonly alias: string;
  readonly args: Map<string, string>;
  readonly fields: string;
};

// Each `<field>(...)` of a query, with its alias, its arguments, and the text of its selection set ('' if it has none).
function graphqlSelections(query: string, field: string): Array<Selection> {
  const selections: Array<Selection> = [];
  const pattern = new RegExp(`(?:(\\w+)\\s*:\\s*)?${field}\\s*\\(([^)]*)\\)(\\s*\\{)?`, "g");
  for (const match of query.matchAll(pattern)) {
    selections.push({
      alias: match[1] ?? field,
      args: graphqlArguments(match[2] ?? ""),
      fields: match[3] ? selectionSetAt(query, match.index + match[0].length) : "",
    });
  }
  return selections;
}

// The text of a selection set from `start`, the index after its opening brace, to its matching closing brace.
function selectionSetAt(text: string, start: number): string {
  let depth = 1;
  for (let index = start; index < text.length; index += 1) {
    if (text[index] === "{") depth += 1;
    else if (text[index] === "}" && (depth -= 1) === 0) return text.slice(start, index);
  }
  return text.slice(start);
}

type SelectionField = {
  readonly key: string;
  readonly name: string;
  readonly args: Map<string, string>;
  readonly nested: string | null;
};

// The fields that a selection set names at its own level, in query order. Each field has its response key (its alias,
// or else its name), its name, its arguments, and the text of its nested selection set (null if it has none). An
// inline fragment `... on <type>{...}` adds its fields only when <type> is `typename`, as GitHub applies only the
// fragments that match the object. Commas are white space in GraphQL. Like `graphqlSelections`, this reads arguments up
// to the first `)`.
function selectionFields(selection: string, typename: string | undefined): Array<SelectionField> {
  const fields: Array<SelectionField> = [];
  let index = 0;
  const skipSpace = (): void => {
    while (index < selection.length && /[\s,]/.test(selection[index] ?? "")) index += 1;
  };
  const readName = (): string => {
    const match = /^[_A-Za-z]\w*/.exec(selection.slice(index));
    if (!match) die(`fake gh cannot read the GraphQL selection at: ${selection.slice(index)}`);
    index += match[0].length;
    skipSpace();
    return match[0];
  };
  const readSet = (): string => {
    const set = selectionSetAt(selection, index + 1);
    index += set.length + 2;
    return set;
  };
  for (skipSpace(); index < selection.length; skipSpace()) {
    if (selection.startsWith("...", index)) {
      index += 3;
      skipSpace();
      const on = readName();
      const type = on === "on" ? readName() : "";
      if (!type || selection[index] !== "{")
        die(`fake gh reads only inline fragments '... on <type>{...}': ${selection}`);
      const set = readSet();
      if (type === typename) fields.push(...selectionFields(set, typename));
      continue;
    }
    const key = readName();
    let name = key;
    if (selection[index] === ":") {
      index += 1;
      skipSpace();
      name = readName();
    }
    let fieldArgs = new Map<string, string>();
    if (selection[index] === "(") {
      const end = selection.indexOf(")", index);
      if (end < 0) die(`fake gh cannot read the GraphQL arguments of '${name}': ${selection}`);
      fieldArgs = graphqlArguments(selection.slice(index + 1, end));
      index = end + 1;
      skipSpace();
    }
    fields.push({ key, name, args: fieldArgs, nested: selection[index] === "{" ? readSet() : null });
  }
  return fields;
}

// `object` as GitHub returns it for a selection set: only the fields that the set names at its own level, each under
// its response key, and each object field only with the fields of its nested set. For `{landed: mergedAt}` GitHub
// returns `landed` with the value of `mergedAt`, and no `mergedAt`. A fixture field that the query does not select must
// not reach the helper, or a test passes for a query that GitHub would answer without that field. A stored function
// gives the value of a field that reads its arguments, such as a connection; it gets the response key and arguments.
function selectFields(object: GqlObject, selection: string): GqlObject {
  // GitHub merges the selections of one response key, and refuses a key that names two different fields. The merged
  // field reads the arguments of its first selection; the fake gh does not compare the arguments.
  const keys = new Map<
    string,
    { name: string; args: Map<string, string>; sets: Array<string | null> }
  >();
  const typename = typeof object["__typename"] === "string" ? object["__typename"] : undefined;
  for (const field of selectionFields(selection, typename)) {
    const merged = keys.get(field.key);
    if (merged && merged.name !== field.name)
      die(`Field '${field.key}' has a field conflict: ${merged.name} or ${field.name}?`);
    if (merged) merged.sets.push(field.nested);
    else keys.set(field.key, { name: field.name, args: field.args, sets: [field.nested] });
  }
  const selected: GqlObject = {};
  for (const [key, { name, args: fieldArgs, sets }] of keys) {
    // The caller adds the fields that the fixture object does not store.
    if (!Object.hasOwn(object, name)) continue;
    const stored = object[name];
    const resolved = typeof stored === "function" ? stored({ alias: key, args: fieldArgs }) : stored;
    selected[key] = selectValue(resolved, name, sets.filter(Boolean).join(" "));
  }
  return selected;
}

// The value of field `name` as GitHub returns it for `nested`, the merged text of the field's nested selection sets.
// Each object in a list gets the same nested selection set.
function selectValue(stored: GqlValue, name: string, nested: string): GqlValue {
  if (Array.isArray(stored)) return stored.map((item) => selectValue(item, name, nested));
  if (stored === null || typeof stored !== "object") return stored;
  // GitHub refuses a query that selects an object field without its subfields.
  if (!nested.trim())
    die(
      `Field must have selections (field '${name}' has no selections. Did you mean '${name} { ... }'?)`,
    );
  return selectFields(stored, nested);
}

function graphqlPage(
  nodes: ReadonlyArray<GqlValue>,
  selection: FieldSelection,
  variables: VariableRecord,
  allowed: ReadonlyArray<string>,
): GqlObject {
  for (const name of selection.args.keys()) {
    if (!allowed.includes(name)) die(`Unknown GraphQL argument: "${name}"`);
  }
  const first = graphqlValue(selection.args.get("first") ?? "100", variables);
  if (typeof first !== "number" || !Number.isInteger(first) || first < 1 || first > 100)
    die(`invalid GraphQL page size: ${String(first)}`);
  const after = graphqlValue(selection.args.get("after") ?? "", variables) || undefined;
  return connectionPage(nodes, after === undefined ? undefined : String(after), selection.alias, first);
}

function observeIssue(issue: StubIssue): void {
  if (state.remoteChange?.issue !== issue.number) return;
  if (state.remoteChange.viewsBeforeChange > 0) {
    state.remoteChange.viewsBeforeChange -= 1;
  } else {
    issue.body = state.remoteChange.body ?? `${issue.body}\n`;
    touch(issue);
    delete state.remoteChange;
  }
}

// A scheduled change lands once the issue has served `afterReads` GraphQL reads, so the next request that
// reads or writes the issue sees it: a close that GitHub records a while after a merge, or a change that
// someone makes while the helper waits. A `closedEvent` becomes the latest ClosedEvent of the timeline, and
// `otherIssues` maps an issue number to the fields that change on that issue at the same time, such as a child plan
// that reopens.
function applyDueChanges(issue: StubIssue): void {
  const reads = issue.graphqlReads ?? 0;
  const pending = issue.pendingChanges ?? [];
  const due = pending.filter((change) => (change.afterReads ?? 0) <= reads);
  if (due.length === 0) return;
  issue.pendingChanges = pending.filter((change) => !due.includes(change));
  for (const change of due) applyChange(issue, change);
}

function applyChange(issue: StubIssue, change: StubChange): void {
  const { closedEvent, otherIssues, ...fields } = change;
  delete fields.afterReads;
  Object.assign(issue, fields);
  if (closedEvent) {
    issue.timelineItems ??= [];
    issue.timelineItems.push({ __typename: "ClosedEvent", ...closedEvent });
  }
  touch(issue);
  for (const [number, otherFields] of Object.entries(otherIssues ?? {})) {
    const other = issueByNumber(Number(number));
    Object.assign(other, otherFields);
    touch(other);
  }
}

function readIssue(issue: StubIssue): void {
  applyDueChanges(issue);
  issue.graphqlReads = (issue.graphqlReads ?? 0) + 1;
}

/** The field `key` of `parent` when `parent` is an object, as `parent?.[key]` reads it. */
function member(parent: unknown, key: string): unknown {
  return typeof parent === "object" && parent !== null && !Array.isArray(parent)
    ? (parent as Record<string, unknown>)[key]
    : undefined;
}

function respondGraphql(data: GqlObject, stage: string): never {
  const response: { data: unknown; errors?: Array<StubGraphqlErrorEntry> } = { data };
  const error = state.graphqlError;
  const errorStage = typeof error === "object" && !Array.isArray(error) ? error.on : undefined;
  if (error && (errorStage === undefined || errorStage === stage)) {
    response.errors = Array.isArray(error)
      ? error
      : typeof error === "string"
        ? [{ message: error }]
        : (error.errors ?? [{ message: String(error.message ?? error) }]);
    delete state.graphqlError;
  }
  const missing = state.graphqlMissingData;
  if (missing && (missing.on === undefined || missing.on === stage)) {
    response.data = missing.data ?? null;
    delete state.graphqlMissingData;
  }
  const missingCursor = state.graphqlMissingCursor;
  if (missingCursor && (missingCursor.on === undefined || missingCursor.on === stage)) {
    const connection = member(
      member(member(response.data, "repository"), "issue"),
      missingCursor.field,
    );
    const pageInfo = member(connection, "pageInfo");
    if (member(pageInfo, "hasNextPage") !== true) die(`no next page for ${missingCursor.field}`);
    (pageInfo as Record<string, unknown>)["endCursor"] = null;
    delete state.graphqlMissingCursor;
  }
  emit(JSON.stringify(response));
  save();
  process.exit(0);
}

// gh prints a GraphQL response that holds errors, reports the messages on stderr, and exits 1.
function failGraphql(data: GqlObject, errors: ReadonlyArray<StubGraphqlErrorEntry>): never {
  emit(JSON.stringify({ data, errors }));
  save();
  console.error(`gh: ${errors.map((error) => error.message).join("\n")}`);
  process.exit(1);
}

// The issue fields that a mutation payload can select, rendered as the issue stores them.
const STORED_SCALARS = [
  "number",
  "title",
  "body",
  "state",
  "stateReason",
  "url",
  "createdAt",
  "updatedAt",
] as const satisfies ReadonlyArray<keyof StubIssue>;

type MutationField = {
  readonly alias: string;
  readonly name: string;
  readonly input: Variable;
  readonly selection: string;
};

// A mutation payload shows the issue as stored right after its own field ran, limited to what the field selects.
function mutationPayload(
  field: MutationField,
  object: string,
  issue: StubIssue,
  variables: VariableRecord,
): GqlObject {
  const payload: GqlObject = { clientMutationId: null };
  const opened = new RegExp(`\\b${object}\\s*\\{`).exec(field.selection);
  if (!opened) return payload;
  const selection = field.selection.slice(opened.index);
  const stored: GqlObject = {};
  for (const name of STORED_SCALARS) {
    if (new RegExp(`\\b${name}\\b`).test(selection)) stored[name] = issue[name];
  }
  for (const page of graphqlSelections(selection, "labels")) {
    stored[page.alias] = graphqlPage(labels(issue.labels), page, variables, ["first", "after"]);
  }
  for (const connection of ["assignees", "assignedActors"]) {
    for (const page of graphqlSelections(selection, connection)) {
      stored[page.alias] = graphqlPage(assignees(issue.assignees), page, variables, [
        "first",
        "after",
      ]);
    }
  }
  for (const page of graphqlSelections(selection, "comments")) {
    const comments = (issue.comments ?? []).map((comment) => commentJson(comment, issue));
    stored[page.alias] = graphqlPage(comments, page, variables, ["first", "after"]);
  }
  payload[object] = stored;
  return payload;
}

function requireInput(
  field: MutationField,
  input: VariableRecord,
  keys: ReadonlyArray<string>,
): void {
  for (const key of Object.keys(input))
    if (!keys.includes(key)) die(`unsupported ${field.name} input field: ${key}`);
  for (const key of keys)
    if (!Object.hasOwn(input, key)) die(`${field.name} requires input field ${key}`);
}

// GitHub runs the top-level fields of a mutation serially, in document order. updateIssue replaces the body
// and the assignee list that its input names; the label mutations add or remove labels by node id;
// reopenIssue, addComment, and addAssigneesToAssignable reopen, comment as the viewer, and add assignees. A
// field that fails resolves to null with an error, and the later fields still run.
function respondMutation(query: string, variables: VariableRecord): never {
  // The fault flags that faulted `gh issue edit` fault the write request before any field runs.
  if (state.issueEditError) die(state.issueEditError);
  for (const issue of state.issues) applyDueChanges(issue);
  const mutationNames = [
    "updateIssue",
    "addLabelsToLabelable",
    "removeLabelsFromLabelable",
    "reopenIssue",
    "addComment",
    "addAssigneesToAssignable",
  ];
  const pattern = new RegExp(
    String.raw`(?:(\w+)\s*:\s*)?\b(${mutationNames.join("|")})\s*\(([^)]*)\)`,
    "g",
  );
  const matches = [...query.matchAll(pattern)];
  if (matches.length === 0) die(`unsupported GraphQL mutation: ${query}`);
  const fields: Array<MutationField> = matches.map((match, index) => {
    const name = match[2] ?? "";
    return {
      alias: match[1] ?? name,
      name,
      input: graphqlValue(graphqlArguments(match[3] ?? "").get("input") ?? "null", variables),
      selection: query.slice(match.index + match[0].length, matches[index + 1]?.index ?? query.length),
    };
  });
  if (
    state.labelRemovalErrorOnce &&
    fields.some((field) => field.name === "removeLabelsFromLabelable")
  ) {
    const message = state.labelRemovalErrorOnce;
    delete state.labelRemovalErrorOnce;
    die(message);
  }
  const same = (a: string, b: string): boolean => a.toLowerCase() === b.toLowerCase();
  const data: GqlObject = {};
  const errors: Array<StubGraphqlErrorEntry> = [];
  for (const field of fields) {
    const { input } = field;
    if (!input || typeof input !== "object" || Array.isArray(input))
      die(`${field.name} requires an input object`);
    if (field.name === "updateIssue") {
      const issue = issueByNodeId(input["id"]);
      for (const key of Object.keys(input)) {
        if (!["id", "body", "assigneeIds"].includes(key))
          die(`unsupported UpdateIssueInput field: ${key}`);
      }
      if (Object.hasOwn(input, "body")) {
        const newBody = input["body"];
        if (typeof newBody !== "string") die("UpdateIssueInput.body must be a string");
        issue.body = newBody;
      }
      if (Object.hasOwn(input, "assigneeIds")) {
        issue.assignees = [
          ...new Set(nodeIds(input["assigneeIds"], "assigneeIds").map(loginByNodeId)),
        ];
      }
      touch(issue);
      data[field.alias] = mutationPayload(field, "issue", issue, variables);
      continue;
    }
    if (field.name === "reopenIssue") {
      requireInput(field, input, ["issueId"]);
      const issue = issueByNodeId(input["issueId"]);
      // GitHub refuses every state change of an issue that it left closed with reason REOPENED (#90).
      if (issue.state === "CLOSED" && issue.stateReason === "REOPENED") {
        data[field.alias] = null;
        errors.push({ path: [field.alias], message: "Could not reopen the issue." });
        continue;
      }
      if (issue.state === "CLOSED") {
        // reopenLeavesClosed reproduces #90: a reopen that races GitHub's close leaves the issue stuck.
        if (!state.reopenLeavesClosed) issue.state = "OPEN";
        issue.stateReason = "REOPENED";
        touch(issue);
      }
      data[field.alias] = mutationPayload(field, "issue", issue, variables);
      continue;
    }
    if (field.name === "addComment") {
      requireInput(field, input, ["subjectId", "body"]);
      const issue = issueByNodeId(input["subjectId"]);
      const commentBody = input["body"];
      if (typeof commentBody !== "string" || !commentBody)
        die("AddCommentInput.body must be a non-empty string");
      touch(issue);
      state.nextComment ??= 1;
      const comment: StubComment = {
        id: state.nextComment++,
        body: commentBody,
        author: state.viewerLogin,
        createdAt: issue.updatedAt,
      };
      issue.comments ??= [];
      issue.comments.push(comment);
      data[field.alias] = {
        ...mutationPayload(field, "subject", issue, variables),
        ...(/\bcommentEdge\s*\{/.test(field.selection) && {
          commentEdge: { node: commentJson(comment, issue) },
        }),
      };
      continue;
    }
    if (field.name === "addAssigneesToAssignable") {
      requireInput(field, input, ["assignableId", "assigneeIds"]);
      const issue = issueByNodeId(input["assignableId"]);
      const logins = nodeIds(input["assigneeIds"], "assigneeIds").map(loginByNodeId);
      issue.assignees = [...new Set([...(issue.assignees ?? []), ...logins])];
      touch(issue);
      data[field.alias] = mutationPayload(field, "assignable", issue, variables);
      continue;
    }
    const issue = issueByNodeId(input["labelableId"]);
    const names = nodeIds(input["labelIds"], "labelIds").map(labelNameByNodeId);
    if (field.name === "addLabelsToLabelable") {
      for (const name of names) {
        const stored = Object.keys(state.labels).find((label) => same(label, name));
        if (!stored) die(`Could not resolve to a Label node with the name '${name}'`);
        if (!issue.labels.some((label) => same(label, stored))) issue.labels.push(stored);
      }
    } else {
      issue.labels = issue.labels.filter((label) => !names.some((name) => same(name, label)));
    }
    touch(issue);
    data[field.alias] = mutationPayload(field, "labelable", issue, variables);
  }
  // `afterMutationOnce` holds an issue number and a change, in the form of a scheduled change, that lands right after
  // one write request, such as a label that someone adds before the helper reads the plan again.
  if (state.afterMutationOnce) {
    const { issue: number, ...change } = state.afterMutationOnce;
    delete state.afterMutationOnce;
    applyChange(issueByNumber(number), change);
  }
  if (errors.length) failGraphql(data, errors);
  respondGraphql(data, "mutation");
}

function commentLogin(comment: StubComment): string | undefined {
  return typeof comment.author === "string"
    ? comment.author
    : (comment.author?.login ?? comment.user?.login);
}

function commentJson(comment: StubComment, issue: StubIssue): GqlObject {
  const login = commentLogin(comment);
  return {
    id: comment.id,
    // GitHub's IssueComment.fullDatabaseId: the number after `#issuecomment-` in the comment URL, as a string.
    fullDatabaseId: String(comment.id),
    body: comment.body,
    author: login ? { login } : null,
    createdAt: comment.createdAt,
    updatedAt: comment.updatedAt ?? comment.createdAt,
    url: comment.url ?? `${issue.url}#issuecomment-${comment.id}`,
  };
}

function apiCommentJson(comment: StubComment, issue: StubIssue): GqlObject {
  const rendered = commentJson(comment, issue);
  return {
    id: rendered["id"],
    body: rendered["body"],
    user: rendered["author"],
    created_at: rendered["createdAt"],
    updated_at: rendered["updatedAt"],
    html_url: rendered["url"],
  };
}

function issueJson(issue: StubIssue): Record<string, unknown> & { labels: Array<GqlValue> } {
  return {
    ...issue,
    id: issueNodeId(issue),
    labels: labels(issue.labels),
    assignees: assignees(issue.assignees),
    comments: (issue.comments ?? []).map((comment) => commentJson(comment, issue)),
  };
}

function touch(issue: StubIssue): void {
  state.clock = (state.clock ?? 0) + 1;
  issue.updatedAt = new Date(Date.parse("2026-08-20T20:00:00Z") + state.clock * 1000).toISOString();
}

/** Each page of `items`, 100 items to a page, as `--paginate --slurp` prints them. */
function slurpPages<T>(items: ReadonlyArray<T>): Array<Array<T>> {
  const pages: Array<Array<T>> = [];
  for (let index = 0; index < items.length; index += 100) pages.push(items.slice(index, index + 100));
  if (pages.length === 0) pages.push([]);
  return pages;
}

const [group, command] = args;
const ISSUE_JSON_FIELDS = new Set([
  "id",
  "number",
  "title",
  "body",
  "state",
  "stateReason",
  "labels",
  "assignees",
  "url",
  "createdAt",
  "updatedAt",
  "comments",
]);
const PR_JSON_FIELDS = new Set([
  "number",
  "title",
  "body",
  "state",
  "url",
  "mergedAt",
  "mergedBy",
  "mergeStateStatus",
  "baseRefName",
  "headRefName",
]);

const commentsEndpoint = /^repos\/([^/]+)\/([^/]+)\/issues\/([1-9]\d*)\/comments$/.exec(
  `${command ?? ""}`,
);
if (group === "api" && commentsEndpoint) {
  if (!args.includes("--paginate") || !args.includes("--slurp"))
    die("issue comments api requires --paginate and --slurp");
  const repo = `${commentsEndpoint[1]}/${commentsEndpoint[2]}`;
  if (repo !== state.repo.nameWithOwner) die(`repository not found: ${repo}`);
  const issue = issueByNumber(Number(commentsEndpoint[3]));
  const comments = (issue.comments ?? []).map((comment) => apiCommentJson(comment, issue));
  emit(JSON.stringify(slurpPages(comments)));
  save();
  process.exit(0);
}

const eventsEndpoint = /^repos\/([^/]+)\/([^/]+)\/issues\/([1-9]\d*)\/events$/.exec(
  `${command ?? ""}`,
);
if (group === "api" && eventsEndpoint) {
  if (!args.includes("--paginate") || !args.includes("--slurp"))
    die("issue events api requires --paginate and --slurp");
  const repo = `${eventsEndpoint[1]}/${eventsEndpoint[2]}`;
  if (repo !== state.repo.nameWithOwner) die(`repository not found: ${repo}`);
  const issue = issueByNumber(Number(eventsEndpoint[3]));
  emit(JSON.stringify(slurpPages(issue.events ?? [])));
  save();
  process.exit(0);
}

// The REST issue read and the REST sub-issue add, the path that the helper takes when gh lacks `issue create --parent`.
// `subIssueErrorOnce` fails one sub-issue add before it writes anything.
const issueEndpoint = /^repos\/([^/]+)\/([^/]+)\/issues\/([1-9]\d*)(\/sub_issues)?$/.exec(
  `${command ?? ""}`,
);
if (group === "api" && issueEndpoint) {
  const repo = `${issueEndpoint[1]}/${issueEndpoint[2]}`;
  if (repo !== state.repo.nameWithOwner) die(`repository not found: ${repo}`);
  const issue = issueByNumber(Number(issueEndpoint[3]));
  const method = (
    value("--method") ??
    value("-X") ??
    (values("-F").length || values("-f").length ? "POST" : "GET")
  ).toUpperCase();
  if (!issueEndpoint[4]) {
    if (method !== "GET") die(`unsupported issue api method: ${method}`);
    emit(
      JSON.stringify({
        id: issueDatabaseId(issue),
        node_id: issueNodeId(issue),
        number: issue.number,
      }),
    );
    save();
    process.exit(0);
  }
  if (method !== "POST") die(`unsupported sub-issues api method: ${method}`);
  if (state.subIssueErrorOnce) {
    const message = state.subIssueErrorOnce;
    delete state.subIssueErrorOnce;
    die(message);
  }
  const { sub_issue_id: id } = graphqlFields();
  const subIssue = state.issues.find((entry) => issueDatabaseId(entry) === id);
  if (!Number.isInteger(id) || !subIssue) die("HTTP 422: Validation Failed (sub_issue_id)");
  addSubIssue(issue, subIssue);
  emit(JSON.stringify({ id, number: subIssue.number }));
  save();
  process.exit(0);
}

/** A list argument of a GraphQL field, such as `labels` or `states`. */
function listArgument(argument: Variable, name: string): Array<Variable> {
  if (!Array.isArray(argument)) die(`GraphQL argument ${name} is not a list`);
  return argument;
}

if (group === "api" && command === "graphql") {
  const { query, ...variables } = graphqlFields();
  if (typeof query !== "string" || !query) die("graphql requires -f query=<query>");
  // A mutation addresses nodes by id, so it names no repository.
  if (/^\s*mutation\b/.test(query)) respondMutation(query, variables);
  const requested = `${String(variables["owner"])}/${String(variables["name"])}`;
  if (requested !== state.repo.nameWithOwner) die(`repository not found: ${requested}`);
  if (state.repoError) die(state.repoError);
  if (query.includes("viewer") && state.viewerError) die(state.viewerError);
  const stage = query.includes("viewer")
    ? "snapshot"
    : /\bissues\s*\(/.test(query)
      ? "list"
      : "page";
  const referenceRepo = (reference: StubReference): string => {
    const { repository } = reference;
    if (typeof repository === "string") return repository;
    return (
      repository?.nameWithOwner ??
      (repository?.owner?.login && repository?.name
        ? `${repository.owner.login}/${repository.name}`
        : state.repo.nameWithOwner)
    );
  };
  // A pull request, for a closer, an associated pull request, or Repository.pullRequest, with every field that the fake
  // gh can return. `selectFields` then keeps the fields that the query selects. The nested repository has its type, so
  // that `__typename` and `... on Repository{...}` read it as on GitHub.
  const pullRequestObject = (reference: StubReference): GqlObject => {
    const repo = referenceRepo(reference);
    const pullRequest = (state.prs ?? []).find(
      (entry) => entry.number === reference.number && entry.repository === repo,
    );
    const prState =
      pullRequest?.state ??
      reference.state ??
      (pullRequest?.mergedAt || reference.mergedAt ? "MERGED" : "OPEN");
    return {
      __typename: "PullRequest",
      number: reference.number,
      url:
        pullRequest?.url ?? reference.url ?? `https://github.com/${repo}/pull/${reference.number}`,
      body: pullRequest?.body ?? reference.body ?? null,
      state: prState,
      merged: prState === "MERGED",
      mergedAt: pullRequest?.mergedAt ?? reference.mergedAt ?? null,
      baseRefName: pullRequest?.baseRefName ?? reference.baseRefName ?? null,
      repository: { __typename: "Repository", nameWithOwner: repo },
    };
  };
  // A commit, for a closer or Repository.object. Its associatedPullRequests connection pages with the arguments of the
  // field that selects it, and `selectFields` gives each page the fields that this field selects.
  const commitObject = (oid: Variable): GqlObject => ({
    __typename: "Commit",
    oid,
    associatedPullRequests: (selection) => {
      const commit = (state.commits ?? []).find(
        (entry) =>
          entry.oid === oid &&
          (entry.repository ?? state.repo.nameWithOwner) === state.repo.nameWithOwner,
      );
      if (!commit) die(`commit not found: ${state.repo.nameWithOwner}@${String(oid)}`);
      return graphqlPage(
        (commit.associatedPullRequests ?? []).map((reference) => pullRequestObject(reference)),
        selection,
        variables,
        ["first", "after"],
      );
    },
  });
  const repository: GqlObject = {
    nameWithOwner: state.repo.nameWithOwner,
    visibility: state.repo.visibility,
  };
  if (query.includes("defaultBranchRef")) {
    const defaultBranch =
      state.repositoryDefaults?.[state.repo.nameWithOwner] ?? state.repo.defaultBranchRef?.name;
    repository["defaultBranchRef"] = defaultBranch ? { name: defaultBranch } : null;
  }

  const issueSelection = graphqlSelections(query, "issue");
  const issuesSelection = graphqlSelections(query, "issues");
  const objectSelection = graphqlSelections(query, "object");
  const labelSelections = graphqlSelections(query, "label");
  if (issueSelection.length > 1 || issuesSelection.length > 1 || objectSelection.length > 1)
    die("graphql selects multiple issues or objects");
  const [selectedIssue] = issueSelection;
  const [selectedObject] = objectSelection;
  const [selectedIssues] = issuesSelection;
  if (selectedIssue) {
    const requestedNumber = graphqlValue(selectedIssue.args.get("number"), variables);
    const issue = issueByNumber(Number(requestedNumber));
    // `readError` fails every GraphQL read that selects the issue, as a read that GitHub refuses.
    if (issue.readError) die(issue.readError);
    if (stage === "snapshot") observeIssue(issue);
    readIssue(issue);
    const payload: GqlObject = {
      number: issue.number,
      title: issue.title,
      body: issue.body,
      state: issue.state,
      stateReason: issue.stateReason,
      url: issue.url,
      createdAt: issue.createdAt,
      updatedAt: issue.updatedAt,
    };
    for (const selection of graphqlSelections(query, "assignedActors")) {
      payload[selection.alias] = graphqlPage(assignees(issue.assignees), selection, variables, [
        "first",
        "after",
      ]);
    }
    for (const selection of graphqlSelections(query, "labels")) {
      payload[selection.alias] = graphqlPage(labels(issue.labels), selection, variables, [
        "first",
        "after",
      ]);
    }
    for (const selection of graphqlSelections(query, "comments")) {
      payload[selection.alias] = graphqlPage(
        (issue.comments ?? []).map((comment) => commentJson(comment, issue)),
        selection,
        variables,
        ["first", "after"],
      );
    }
    // Issue.subIssues: each sub-issue with the fields that the query selects, and its labels as a connection.
    for (const selection of graphqlSelections(query, "subIssues")) {
      const children = (issue.subIssues ?? []).map(issueByNumber).map(
        (subIssue): GqlObject => ({
          __typename: "Issue",
          number: subIssue.number,
          title: subIssue.title,
          state: subIssue.state,
          stateReason: subIssue.stateReason,
          labels: (field) =>
            graphqlPage(labels(subIssue.labels), field, variables, ["first", "after"]),
        }),
      );
      payload[selection.alias] = selectFields(
        graphqlPage(children, selection, variables, ["first", "after"]),
        selection.fields,
      );
    }
    // Issue.parent: the issue whose sub-issues hold this one, or null. A fixture `foreignParent` ({ number,
    // nameWithOwner }) stands for a parent in another repository.
    if (/\bparent\s*\{/.test(selectedIssue.fields)) {
      const linked = state.issues.find((entry) => (entry.subIssues ?? []).includes(issue.number));
      const parent: GqlObject | undefined = issue.foreignParent
        ? {
            number: issue.foreignParent.number,
            repository: { nameWithOwner: issue.foreignParent.nameWithOwner },
          }
        : linked && {
            number: linked.number,
            repository: { nameWithOwner: state.repo.nameWithOwner },
          };
      Object.assign(payload, selectFields({ parent: parent ?? null }, selectedIssue.fields));
    }
    for (const selection of graphqlSelections(query, "timelineItems")) {
      const types = selection.args.get("itemTypes");
      if (types === "[LABELED_EVENT]" || types === "LABELED_EVENT") {
        const events = (issue.events ?? [])
          .filter((event) => event.event === "labeled")
          .map((event): GqlObject => ({ label: event.label }));
        payload[selection.alias] = graphqlPage(events, selection, variables, [
          "first",
          "after",
          "itemTypes",
        ]);
      } else if (types === "[CLOSED_EVENT]" || types === "CLOSED_EVENT") {
        for (const argument of selection.args.keys()) {
          if (!["last", "itemTypes"].includes(argument))
            die(`Unknown GraphQL argument: "${argument}"`);
        }
        const last = graphqlValue(selection.args.get("last") ?? "1", variables);
        if (last !== 1) die("latest closure must request last:1");
        const latest = (issue.timelineItems ?? [])
          .filter((event) => event.__typename === "ClosedEvent" || Object.hasOwn(event, "closer"))
          .at(-1);
        const stored = latest?.closer;
        let closer: GqlValue = stored;
        if (stored?.__typename === "PullRequest") closer = pullRequestObject(stored);
        else if (stored?.__typename === "Commit") closer = commitObject(stored.oid);
        // GitHub stamps every close; a fixture close without a time reads as the issue's last update.
        const event: GqlObject = {
          __typename: "ClosedEvent",
          createdAt: latest?.createdAt ?? issue.updatedAt,
          closer,
        };
        // Each connection reads its nodes with its own selection set, so two aliased connections can select different
        // fields of the same close.
        payload[selection.alias] = selectFields(
          { nodes: latest ? [event] : [] },
          selection.fields,
        );
      } else die(`unsupported timeline item types: ${types ?? "(missing)"}`);
    }
    repository["issue"] = payload;
  } else if (selectedObject) {
    const oid = graphqlValue(selectedObject.args.get("expression"), variables);
    repository[selectedObject.alias] = selectFields(commitObject(oid), selectedObject.fields);
  } else if (selectedIssues) {
    // Repository.issues: `labels` keeps issues that carry any named label; `states` and `orderBy` as on GitHub.
    const argument = (name: string, fallback: string): Variable =>
      graphqlValue(selectedIssues.args.get(name) ?? fallback, variables);
    const wanted = listArgument(argument("labels", "[]"), "labels").map((name) =>
      String(name).toLowerCase(),
    );
    const states = listArgument(argument("states", "[OPEN,CLOSED]"), "states");
    const order = argument("orderBy", "{field:CREATED_AT,direction:ASC}");
    const orderField = member(order, "field");
    if (orderField !== "CREATED_AT") die(`unsupported issue order: ${String(orderField)}`);
    const direction = member(order, "direction") === "DESC" ? -1 : 1;
    const labelPages = graphqlSelections(query, "labels");
    const matched = state.issues
      .filter(
        (issue) =>
          wanted.length === 0 ||
          issue.labels.some((label) => wanted.includes(label.toLowerCase())),
      )
      .filter((issue) => states.includes(issue.state.toUpperCase()))
      .sort(
        (a, b) =>
          direction *
          (Date.parse(a.createdAt) - Date.parse(b.createdAt) || a.number - b.number),
      )
      .map((issue) => {
        const node: GqlObject = {
          number: issue.number,
          title: issue.title,
          state: issue.state,
          stateReason: issue.stateReason,
        };
        for (const page of labelPages) {
          node[page.alias] = graphqlPage(labels(issue.labels), page, variables, ["first", "after"]);
        }
        return node;
      });
    repository[selectedIssues.alias] = graphqlPage(matched, selectedIssues, variables, [
      "first",
      "after",
      "labels",
      "states",
      "orderBy",
    ]);
  } else if (
    labelSelections.length === 0 &&
    graphqlSelections(query, "repository").length !== 1
  ) {
    die("graphql query selects no repository");
  }
  for (const selection of labelSelections) {
    for (const argument of selection.args.keys()) {
      if (argument !== "name") die(`Unknown GraphQL argument: "${argument}"`);
    }
    const name = graphqlValue(selection.args.get("name"), variables);
    const stored = Object.keys(state.labels).find(
      (label) => label.toLowerCase() === (typeof name === "string" ? name.toLowerCase() : name),
    );
    repository[selection.alias] = stored ? { name: stored, id: labelNodeId(stored) } : null;
  }
  // Repository.pullRequest: a merged pull request still lists the issues that it closes (checked on #95).
  for (const selection of graphqlSelections(query, "pullRequest")) {
    for (const argument of selection.args.keys()) {
      if (argument !== "number") die(`Unknown GraphQL argument: "${argument}"`);
    }
    const number = graphqlValue(selection.args.get("number"), variables);
    const pullRequest = (state.prs ?? []).find(
      (entry) => entry.number === number && entry.repository === state.repo.nameWithOwner,
    );
    if (!pullRequest) {
      failGraphql({ repository: { ...repository, [selection.alias]: null } }, [
        {
          type: "NOT_FOUND",
          path: ["repository", selection.alias],
          message: `Could not resolve to a PullRequest with the number of ${String(number)}.`,
        },
      ]);
    }
    const node = selectFields(pullRequestObject({ number: pullRequest.number }), selection.fields);
    for (const page of graphqlSelections(selection.fields, "closingIssuesReferences")) {
      const references = (pullRequest.closingIssuesReferences ?? []).map(
        (closedNumber): GqlObject => ({
          number: closedNumber,
          repository: { nameWithOwner: state.repo.nameWithOwner },
        }),
      );
      node[page.alias] = graphqlPage(references, page, variables, ["first", "after"]);
    }
    repository[selection.alias] = node;
  }
  const viewer: GqlObject = {
    login: state.viewerLogin ?? "",
    id: state.viewerLogin ? userNodeId(state.viewerLogin) : null,
  };
  respondGraphql({ ...(query.includes("viewer") && { viewer }), repository }, stage);
}

if (group === "api" && command === "user") {
  if (state.viewerError) die(state.viewerError);
  if (value("--jq") !== ".login") die("api user requires --jq .login");
  process.stdout.write(`${state.viewerLogin ?? ""}\n`);
  save();
  process.exit(0);
}

if (group === "repo" && command === "view") {
  if (state.repoError) die(state.repoError);
  const repo = value("--repo") ?? state.repo.nameWithOwner;
  const defaultBranch = state.repositoryDefaults?.[repo] ?? state.repo.defaultBranchRef?.name;
  const details =
    repo === state.repo.nameWithOwner
      ? state.repo
      : {
          nameWithOwner: repo,
          visibility: "PUBLIC",
          defaultBranchRef: defaultBranch ? { name: defaultBranch } : null,
        };
  emit(JSON.stringify(select(details, value("--json"))));
  save();
  process.exit(0);
}

if (group === "label" && command === "create") {
  const name = args[2];
  if (!name) die("label create requires a name");
  const existing = Object.keys(state.labels).find(
    (label) => label.toLowerCase() === name.toLowerCase(),
  );
  if (existing && !args.includes("--force")) die(`label already exists: ${name}`);
  const description = value("--description");
  state.labels[existing ?? name] = {
    ...(existing === undefined ? {} : state.labels[existing]),
    color: value("--color") ?? "ededed",
    ...(description !== undefined && { description }),
  };
  save();
  process.exit(0);
}

if (group === "label" && command === "list") {
  const entries = Object.keys(state.labels)
    .sort()
    .map((name) => ({ name }));
  emit(JSON.stringify(entries.map((entry) => select(entry, value("--json")))));
  save();
  process.exit(0);
}

if (group === "issue" && command === "create") {
  const title = value("--title");
  const bodyFile = value("--body-file");
  if (!title || !bodyFile) die("issue create requires --title and --body-file");
  // `ghLacksParentFlag` models a gh release before `issue create --parent`: flag parsing fails before any request.
  if (args.includes("--parent") && state.ghLacksParentFlag)
    die("unknown flag: --parent\n\nUsage:  gh issue create [flags]");
  const parentFlag = value("--parent");
  const parent = parentFlag === undefined ? undefined : issueByNumber(Number(parentFlag));
  const number = state.nextIssue++;
  const now = new Date(Date.parse("2026-08-20T20:00:00Z") + (state.clock ?? 0) * 1000).toISOString();
  const issue: StubIssue = {
    number,
    title,
    body: fs.readFileSync(bodyFile, "utf8"),
    state: "OPEN",
    stateReason: null,
    labels: values("--label"),
    // An `@me` with no viewer login is stored as null, as JSON writes a missing login.
    assignees: state.dropCreateAssignee
      ? []
      : values("--assignee").map((login) =>
          login === "@me" ? (state.viewerLogin as string) : login,
        ),
    url: `https://github.com/${state.repo.nameWithOwner}/issues/${number}`,
    createdAt: now,
    updatedAt: now,
    comments: [],
    events: [],
  };
  state.issues.push(issue);
  if (parent) addSubIssue(parent, issue);
  emit(issue.url);
  save();
  process.exit(0);
}

if (group === "issue" && command === "view") {
  const number = issueNumber();
  const issue = issueByNumber(number);
  validateJsonFields(value("--json"), ISSUE_JSON_FIELDS);
  observeIssue(issue);
  // `issue view` is not a GraphQL read, so it lands due changes without counting toward `afterReads`.
  applyDueChanges(issue);
  // Real gh reads `labels(first:100)` for `issue view` (cli/cli api/query_builder.go), so it never
  // returns a label past the first 100.
  const view = issueJson(issue);
  emit(JSON.stringify(select({ ...view, labels: view.labels.slice(0, 100) }, value("--json"))));
  save();
  process.exit(0);
}

// gh follows closeRun (cli/cli pkg/cmd/issue/close/close.go): it reads the issue, leaves a closed issue as it is, posts
// the --comment as the viewer, and then closes the issue in a second request. The close names no closer, as a close by
// hand does. Like `issue view`, the read lands due changes without counting toward `afterReads`.
// `issueCloseErrorBeforeWriteOnce` fails one close before gh writes anything, and `issueCloseErrorAfterCommentOnce`
// posts the comment and then fails the close request. `afterCloseOnce` is a change, in the form of a scheduled change,
// that lands on the issue right after one close, such as a child plan that reopens before the helper reads again. Its
// `graphqlError` field becomes `state.graphqlError`, so the next GraphQL request after the close fails.
if (group === "issue" && command === "close") {
  const issue = issueByNumber(issueNumber());
  const reason = value("--reason");
  if (reason !== "completed" && reason !== "not planned")
    die("issue close requires a supported --reason");
  if (state.issueCloseErrorBeforeWriteOnce) {
    const message = state.issueCloseErrorBeforeWriteOnce;
    delete state.issueCloseErrorBeforeWriteOnce;
    die(message);
  }
  applyDueChanges(issue);
  if (String(issue.state).toUpperCase() === "CLOSED") {
    const repo = value("--repo") ?? state.repo.nameWithOwner;
    save();
    console.error(`! Issue ${repo}#${issue.number} (${issue.title}) is already closed`);
    process.exit(0);
  }
  const comment = value("--comment");
  if (comment !== undefined) {
    touch(issue);
    state.nextComment ??= 1;
    issue.comments ??= [];
    issue.comments.push({
      id: state.nextComment++,
      body: comment,
      author: state.viewerLogin,
      createdAt: issue.updatedAt,
    });
  }
  if (state.issueCloseErrorAfterCommentOnce) {
    const message = state.issueCloseErrorAfterCommentOnce;
    delete state.issueCloseErrorAfterCommentOnce;
    die(message);
  }
  touch(issue);
  issue.state = "CLOSED";
  issue.stateReason = reason === "completed" ? "COMPLETED" : "NOT_PLANNED";
  issue.timelineItems ??= [];
  issue.timelineItems.push({ __typename: "ClosedEvent", closer: null, createdAt: issue.updatedAt });
  if (state.afterCloseOnce) {
    const { graphqlError, ...change } = state.afterCloseOnce;
    if (graphqlError) state.graphqlError = graphqlError;
    applyChange(issue, change);
    delete state.afterCloseOnce;
  }
  save();
  process.exit(0);
}

if (group === "pr" && command === "view") {
  const number = Number(args[2]);
  const repo = value("--repo") ?? state.repo.nameWithOwner;
  validateJsonFields(value("--json"), PR_JSON_FIELDS);
  const pullRequest = state.prs.find((entry) => entry.number === number && entry.repository === repo);
  if (!pullRequest) die(`pull request not found: ${repo}#${number}`);
  emit(JSON.stringify(select(pullRequest, value("--json"))));
  save();
  process.exit(0);
}

die(`unsupported gh command: ${args.join(" ")}`);
