/**
 * docks-kit-omp extension: workspace hygiene for omp sessions.
 *
 * - The tools scratch_new, scratch_remove, and tidy_report run docks-kit.
 * - The tool_result handler records each resource that a bash command
 *   creates, and it adds a reminder that names the cleanup command.
 * - The session_stop handler lists the recorded resources that still exist.
 * - The session_start handler of a main session starts `docks-kit tidy --apply`
 *   in the background, at most one time in each sweep interval.
 *
 * The module imports only node: modules, so omp loads it without a package
 * install. No subprocess uses a command interpreter, so a tool argument never
 * gets to a shell.
 */
import { execFile, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
  accessSync,
  chmodSync,
  closeSync,
  constants,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  statSync,
  unlinkSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, posix, resolve, win32 } from "node:path";

// ------------------------------------------------------------- constants ----

const SWEEP_INTERVAL_MS = 12 * 60 * 60 * 1000;
const CLAIM_STALE_MS = 60 * 1000;
const STAMP_FILE = "tidy.stamp";
const CLAIM_FILE = "tidy.stamp.claim";
const TAKEOVER_FILE = "tidy.stamp.takeover";
const DOCKER_CHECK_TIMEOUT_MS = 5000;
const SCRATCH_TIMEOUT_MS = 60_000;
const REPORT_TIMEOUT_MS = 120_000;
const OUTPUT_LIMIT_BYTES = 16 * 1024 * 1024;
const COMMAND_TEXT_LIMIT = 120;
const LABEL_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const LABEL_ERROR = "label must match ^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$";
const NOT_ON_PATH = "docks-kit is not on PATH; install docks-kit and run docks-kit sync omp";

/**
 * A bash command that does not match this pattern creates no tracked
 * resource. Each detection rule below has a word in this pattern.
 */
const TRIGGER =
  /worktree\s+add|compose|docker|scratch\s+new|mktemp|nohup|setsid|disown|&|tmux|screen|ngrok|cloudflared|port-forward|ssh|cluster|minikube|multipass|limactl|machine|colima|crontab|\bat\b|systemctl|systemd-run|launchctl|install|(?:^|\s)-g(?:\s|$)|global|branches|branch\s+create|vercel|netlify|wrangler|fly\s|fork|codespace|stash/;

/** The scope of the top-level command; a subshell scope extends it with `/<n>`. */
const ROOT_SCOPE = "0";

const UNRESOLVED = /[$`*]/;
const ASSIGNMENT = /^[A-Za-z_][A-Za-z0-9_]*=/;
const REDIRECT_OPERATOR = /^(?:\d+|&)?(?:<<<|<<-?|>>|>&|<&|>\||<>|>|<)$/;
const ATTACHED_REDIRECT = /^(?:\d+|&)?[<>]/;
const SHORT_CLUSTER_WITH_D = /^-[A-Za-z]*d[A-Za-z]*$/;
/** mktemp options after which it prints a name or text but creates nothing. */
const MKTEMP_CREATES_NOTHING: Record<string, true> = {
  "--dry-run": true,
  "--help": true,
  "--version": true,
};
const CONTAINER_ID = /^[0-9a-f]{64}$/;
const SAFE_WORD = /^[A-Za-z0-9_/.:@%+=,-]+$/;
const RESERVED_WORDS: Record<string, true> = {
  "{": true,
  "}": true,
  "!": true,
  if: true,
  then: true,
  else: true,
  elif: true,
  do: true,
  while: true,
  until: true,
  time: true,
};

const GIT_VALUE_OPTIONS: Record<string, true> = { "-C": true, "-c": true };
const WORKTREE_VALUE_OPTIONS: Record<string, true> = { "-b": true, "-B": true, "--reason": true };
/** Docker global options that select the daemon, mapped to their long names. */
const DOCKER_CONNECTION_VALUE_OPTIONS: Record<string, string> = {
  "-c": "--context",
  "--context": "--context",
  "-H": "--host",
  "--host": "--host",
  "--config": "--config",
  "--tlscacert": "--tlscacert",
  "--tlscert": "--tlscert",
  "--tlskey": "--tlskey",
};
const DOCKER_CONNECTION_FLAGS: Record<string, true> = { "--tls": true, "--tlsverify": true };
const DOCKER_LOG_LEVEL_OPTIONS: Record<string, true> = { "-l": true, "--log-level": true };
/** Environment variables that select the Docker daemon. */
const DOCKER_ENVIRONMENT: Record<string, true> = {
  DOCKER_HOST: true,
  DOCKER_CONTEXT: true,
  DOCKER_CONFIG: true,
  DOCKER_TLS_VERIFY: true,
  DOCKER_CERT_PATH: true,
};
const COMPOSE_VALUE_OPTIONS: Record<string, true> = {
  "-f": true,
  "--file": true,
  "-p": true,
  "--project-name": true,
  "--project-directory": true,
  "--env-file": true,
  "--profile": true,
  "--ansi": true,
  "--progress": true,
};
const SSH_VALUE_FLAGS = "BbcDEeFIiJLlmOoPpQRSWw";
const STASH_WITHOUT_ENTRY: Record<string, true> = {
  list: true,
  show: true,
  pop: true,
  apply: true,
  drop: true,
  clear: true,
  branch: true,
};

const RM_NOTE = "Add `--rm` to `docker run` so that Docker removes the container when it stops.";
const SCRATCH_NOTE =
  "Create temporary files and directories inside a directory from the `scratch_new` tool or `docks-kit scratch new <label>`, not in `/tmp`.";
const KEEP_SENTENCE =
  "Remove each resource that the task no longer needs. Keep a resource only when the user asked for it or a later step needs it, and name it with the reason in your final answer. Never stop or delete a production resource without an ask in the main session.";

interface OtherRule {
  readonly category: string;
  readonly hint: string;
}

const BACKGROUND: OtherRule = {
  category: "background process",
  hint: "Stop it before your final answer, or start it as a named bash service.",
};
const TERMINAL: OtherRule = {
  category: "detached terminal session",
  hint: "Kill the session when the task no longer needs it.",
};
const TUNNEL: OtherRule = {
  category: "tunnel",
  hint: "Stop the tunnel when the task no longer needs it.",
};
const CLUSTER: OtherRule = {
  category: "cluster or virtual machine",
  hint: "Stop or delete it with the same tool when the task no longer needs it.",
};
const DOCKER_RESOURCE: OtherRule = {
  category: "Docker resource",
  hint: "Remove it with docker volume rm, docker network rm, or docker buildx rm when the task no longer needs it.",
};
const SCHEDULED: OtherRule = {
  category: "scheduled job or service",
  hint: "Remove the entry or unit that you added, or name it in your final answer.",
};
const GLOBAL_INSTALL: OtherRule = {
  category: "global install",
  hint: "Uninstall it unless the user asked for it.",
};
const REMOTE: OtherRule = {
  category: "remote resource",
  hint: "Delete it with the provider's command only when its target is development, test, homologation, staging, or preview, and the task no longer needs it. For a production target, ask the user first. If you do not delete it, name it in your final answer.",
};
const STASH: OtherRule = {
  category: "git stash",
  hint: "Apply the stash, or name it in your final answer.",
};

const CLUSTER_COMMANDS: ReadonlyArray<ReadonlyArray<string>> = [
  ["kind", "create", "cluster"],
  ["k3d", "cluster", "create"],
  ["minikube", "start"],
  ["multipass", "launch"],
  ["limactl", "start"],
  ["podman", "machine", "start"],
  ["colima", "start"],
];
const REMOTE_COMMANDS: ReadonlyArray<ReadonlyArray<string>> = [
  ["supabase", "branches", "create"],
  ["neonctl", "branches", "create"],
  ["pscale", "branch", "create"],
  ["netlify", "deploy"],
  ["wrangler", "deploy"],
  ["fly", "deploy"],
  ["fly", "launch"],
  ["gh", "repo", "fork"],
  ["gh", "codespace", "create"],
];

// ----------------------------------------------------------------- types ----

/**
 * The Docker daemon that a command used: the `DOCKER_*` environment variables
 * and the global options before the subcommand. An empty target is the
 * default daemon of the omp process.
 */
export interface DockerTarget {
  environment: Record<string, string>;
  options: Array<string>;
}

export type HygieneResource =
  | { kind: "worktree"; path: string }
  | { kind: "compose"; workingDir: string; down: string; docker: DockerTarget }
  | { kind: "container"; id: string; down: string; docker: DockerTarget }
  | { kind: "scratch"; path: string }
  | { kind: "tempDir"; path: string }
  | { kind: "tempFile"; path: string }
  | { kind: "other"; category: string; command: string; hint: string };

type PathResource = Exclude<HygieneResource, { kind: "other" }>;

export interface ShellSegment {
  words: Array<string>;
  background: boolean;
}

/** A segment with its subshell scope. A `cd` changes only its own scope. */
interface ScopedSegment extends ShellSegment {
  scope: string;
}

export interface RunOptions {
  readonly signal?: AbortSignal;
  readonly timeoutMs: number;
  readonly env?: NodeJS.ProcessEnv;
}

export interface RunResult {
  /** The exit code, or null when a signal or the timeout stopped the process. */
  readonly code: number | null;
  readonly stdout: string;
  readonly stderr: string;
}

// The local structural types below name only the omp extension API parts
// that this module uses. The module does not import @oh-my-pi packages.

interface TextContent {
  readonly type: string;
  readonly text?: string;
}

interface ExtensionContext {
  readonly cwd: string;
  readonly agent?: { readonly kind: "main" | "sub" };
}

interface ToolResultEvent {
  readonly toolName: string;
  readonly input?: Readonly<Record<string, unknown>>;
  readonly content?: ReadonlyArray<TextContent>;
  readonly isError?: boolean;
}

interface SessionStopEvent {
  readonly stop_hook_active?: boolean;
}

interface Schema {
  describe(description: string): Schema;
}

interface SchemaBuilder {
  object(shape: Record<string, Schema>): Schema;
  string(): Schema;
  array(item: Schema): Schema;
}

interface ToolResult {
  content: Array<{ type: "text"; text: string }>;
  details: Record<string, unknown>;
}

interface ToolDefinition<Params> {
  name: string;
  label: string;
  description: string;
  parameters: Schema;
  execute(
    toolCallId: string,
    params: Params,
    signal: AbortSignal | undefined,
    onUpdate: unknown,
    ctx: ExtensionContext,
  ): Promise<ToolResult>;
}

export interface ExtensionApi {
  readonly zod: SchemaBuilder;
  on(
    event: "tool_result",
    handler: (
      event: ToolResultEvent,
      ctx: ExtensionContext,
    ) => Promise<{ additionalContext: string } | undefined>,
  ): void;
  on(
    event: "session_stop",
    handler: (
      event: SessionStopEvent,
      ctx: ExtensionContext,
    ) => Promise<{ continue: true; additionalContext: string } | undefined>,
  ): void;
  on(
    event: "session_start",
    handler: (event: unknown, ctx: ExtensionContext) => Promise<undefined>,
  ): void;
  registerTool<Params>(definition: ToolDefinition<Params>): void;
}

// ------------------------------------------------------------ subprocess ----

/**
 * Runs `command` with `args` through execFile without a shell. Each argument
 * gets to the child as one literal argv entry. A non-zero exit, a signal, or
 * the timeout resolves; a spawn failure or an abort rejects.
 */
export function run(
  command: string,
  args: ReadonlyArray<string>,
  options: RunOptions,
): Promise<RunResult> {
  const { promise, resolve: resolveRun, reject: rejectRun } = Promise.withResolvers<RunResult>();
  execFile(
    command,
    [...args],
    {
      encoding: "utf8",
      env: options.env,
      maxBuffer: OUTPUT_LIMIT_BYTES,
      shell: false,
      signal: options.signal,
      timeout: options.timeoutMs,
      windowsHide: true,
    },
    (error, stdout, stderr) => {
      if (error === null) resolveRun({ code: 0, stdout, stderr });
      else if (typeof error.code === "number") resolveRun({ code: error.code, stdout, stderr });
      else if (
        error.name !== "AbortError" &&
        (error.killed === true || (error.signal ?? null) !== null)
      ) {
        resolveRun({ code: null, stdout, stderr });
      } else rejectRun(error);
    },
  );
  return promise;
}

/**
 * Finds docks-kit on PATH. Windows accepts only `docks-kit.exe`, because
 * execFile without a shell cannot start a `.cmd` or `.bat` shim. A relative
 * PATH entry is skipped.
 */
export function resolveDocksKit(
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
): string {
  const windows = platform === "win32";
  const paths = windows ? win32 : posix;
  const searchPath = env["PATH"] ?? env["Path"] ?? "";
  for (const entry of searchPath.split(windows ? ";" : ":")) {
    const directory = entry.replace(/^"(.*)"$/, "$1");
    if (directory === "" || !paths.isAbsolute(directory)) continue;
    const candidate = paths.join(directory, windows ? "docks-kit.exe" : "docks-kit");
    if (isRunnableFile(candidate, windows)) return candidate;
  }
  throw new Error(NOT_ON_PATH);
}

function isRunnableFile(path: string, windows: boolean): boolean {
  try {
    if (!statSync(path).isFile()) return false;
    if (!windows) accessSync(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function errorCode(error: unknown): unknown {
  return typeof error === "object" && error !== null && "code" in error ? error.code : undefined;
}

function toError(error: unknown): Error {
  if (errorCode(error) === "ENOENT") return new Error(NOT_ON_PATH);
  return error instanceof Error ? error : new Error(String(error));
}

async function runDocksKit(
  args: ReadonlyArray<string>,
  signal: AbortSignal | undefined,
  timeoutMs: number,
): Promise<string> {
  const result = await run(resolveDocksKit(), args, { signal, timeoutMs });
  const output = [result.stdout.trim(), result.stderr.trim()].filter((text) => text !== "");
  if (result.code === 0) return result.stdout;
  const status = result.code === null ? "was stopped" : `exited with code ${result.code}`;
  throw new Error(
    output.length > 0 ? output.join("\n") : `docks-kit ${args.join(" ")} ${status}`,
  );
}

// --------------------------------------------------------- shell parsing ----

/**
 * Splits a bash command into simple-command segments. This is a minimal
 * tokenizer: it removes single quotes, double quotes, and backslash escapes,
 * and it splits on `&&`, `||`, `;`, `|`, `&`, parentheses, and newlines.
 * `background` is true when a single `&` ended the segment. The command of a
 * `$(...)` or backtick substitution becomes a segment before its container.
 * A heredoc body is skipped.
 */
export function splitShellSegments(command: string): Array<ShellSegment> {
  return scopedSegments(command, ROOT_SCOPE).map(({ words, background }) => ({
    words,
    background,
  }));
}

/**
 * Does the work of splitShellSegments, and gives each segment its subshell
 * scope. A `( ... )` group, a `$( ... )` substitution, and a backtick
 * substitution each get a new scope `<parent>/<n>`. A `{ ...; }` group stays
 * in the scope around it, as in bash.
 */
function scopedSegments(command: string, rootScope: string): Array<ScopedSegment> {
  const segments: Array<ScopedSegment> = [];
  const nested: Array<ScopedSegment> = [];
  const heredocs: Array<{ delimiter: string; strip: boolean }> = [];
  const scopes = [rootScope];
  let childScopes = 0;
  let words: Array<string> = [];
  let word = "";
  let inWord = false;
  /** The strip flag of a `<<` operator whose delimiter is the next word. */
  let heredocOperator: boolean | undefined;

  const currentScope = (): string => scopes.at(-1) ?? rootScope;
  const childScope = (): string => `${currentScope()}/${childScopes++}`;
  const finishWord = (): void => {
    if (!inWord) return;
    if (heredocOperator !== undefined) {
      heredocs.push({ delimiter: word, strip: heredocOperator });
      heredocOperator = undefined;
    } else if (!word.includes("<<<")) {
      const match = /^\d*<<(-?)(.*)$/.exec(word);
      if (match !== null) {
        const strip = match[1] === "-";
        const delimiter = match[2] ?? "";
        if (delimiter === "") heredocOperator = strip;
        else heredocs.push({ delimiter, strip });
      }
    }
    words.push(word);
    word = "";
    inWord = false;
  };

  const finishSegment = (background: boolean): void => {
    finishWord();
    segments.push(...nested.splice(0));
    if (words.length > 0) segments.push({ words, background, scope: currentScope() });
    words = [];
  };

  const readSubstitution = (start: number): number => {
    let depth = 0;
    let openQuote: string | undefined;
    let index = start + 1;
    for (; index < command.length; index++) {
      const char = command[index];
      if (openQuote !== undefined) {
        if (char === "\\" && openQuote === '"') index++;
        else if (char === openQuote) openQuote = undefined;
        continue;
      }
      if (char === "\\") index++;
      else if (char === "'" || char === '"') openQuote = char;
      else if (char === "(") depth++;
      else if (char === ")" && --depth === 0) break;
    }
    nested.push(...scopedSegments(command.slice(start + 2, index), childScope()));
    word += command.slice(start, index + 1);
    inWord = true;
    return index + 1;
  };

  const readBacktick = (start: number): number => {
    let index = start + 1;
    while (index < command.length && command[index] !== "`") {
      index += command[index] === "\\" ? 2 : 1;
    }
    nested.push(...scopedSegments(command.slice(start + 1, index), childScope()));
    word += command.slice(start, index + 1);
    inWord = true;
    return index + 1;
  };

  const readDoubleQuoted = (start: number): number => {
    let index = start;
    inWord = true;
    while (index < command.length && command[index] !== '"') {
      const char = command[index];
      const next = command[index + 1];
      if (char === "\\" && next !== undefined && '"\\$`\n'.includes(next)) {
        if (next !== "\n") word += next;
        index += 2;
      } else if (char === "$" && next === "(") {
        index = readSubstitution(index);
      } else if (char === "`") {
        index = readBacktick(index);
      } else {
        word += char;
        index++;
      }
    }
    return index + 1;
  };

  const skipHeredocBodies = (start: number): number => {
    let index = start;
    for (const { delimiter, strip } of heredocs.splice(0)) {
      while (index < command.length) {
        const newline = command.indexOf("\n", index);
        const end = newline === -1 ? command.length : newline;
        let line = command.slice(index, end);
        if (line.endsWith("\r")) line = line.slice(0, -1);
        index = end + 1;
        if ((strip ? line.replace(/^\t+/, "") : line) === delimiter) break;
      }
    }
    heredocOperator = undefined;
    return index;
  };

  let index = 0;
  while (index < command.length) {
    const char = command[index] ?? "";
    const next = command[index + 1];
    if (char === "'") {
      const close = command.indexOf("'", index + 1);
      const end = close === -1 ? command.length : close;
      word += command.slice(index + 1, end);
      inWord = true;
      index = end + 1;
    } else if (char === '"') {
      index = readDoubleQuoted(index + 1);
    } else if (char === "\\") {
      if (next !== undefined && next !== "\n") {
        word += next;
        inWord = true;
      }
      index += 2;
    } else if (char === "$" && next === "(") {
      index = readSubstitution(index);
    } else if (char === "`") {
      index = readBacktick(index);
    } else if (char === " " || char === "\t" || char === "\r") {
      finishWord();
      index++;
    } else if (char === "#" && !inWord) {
      const newline = command.indexOf("\n", index);
      index = newline === -1 ? command.length : newline;
    } else if (char === "\n") {
      finishSegment(false);
      index = skipHeredocBodies(index + 1);
    } else if (char === "(" && !inWord) {
      finishSegment(false);
      scopes.push(childScope());
      index++;
    } else if (char === ")") {
      finishSegment(false);
      if (scopes.length > 1) scopes.pop();
      index++;
    } else if (char === ";") {
      finishSegment(false);
      index++;
    } else if (char === "|") {
      finishSegment(false);
      index += next === "|" || next === "&" ? 2 : 1;
    } else if (char === "&") {
      if (next === "&") {
        finishSegment(false);
        index += 2;
      } else if (next === ">" || word.endsWith(">") || word.endsWith("<")) {
        // A redirection such as `&>file` or `2>&1`.
        word += char;
        inWord = true;
        index++;
      } else {
        finishSegment(true);
        index++;
      }
    } else {
      word += char;
      inWord = true;
      index++;
    }
  }
  finishSegment(false);
  return segments;
}

/**
 * Removes redirections and leading reserved words, then splits off the
 * `NAME=value` words before the command, also after one `sudo` and an `env`.
 * The first of the returned words is the command name.
 */
function commandWords(segmentWords: ReadonlyArray<string>): {
  assignments: Array<string>;
  words: Array<string>;
} {
  const result: Array<string> = [];
  for (let index = 0; index < segmentWords.length; index++) {
    const word = segmentWords[index] ?? "";
    if (REDIRECT_OPERATOR.test(word)) {
      index++;
      continue;
    }
    if (ATTACHED_REDIRECT.test(word)) continue;
    result.push(word);
  }
  const assignments: Array<string> = [];
  let start = 0;
  while (RESERVED_WORDS[result[start] ?? ""] === true) start++;
  for (const prefix of ["sudo", "env"]) {
    while (ASSIGNMENT.test(result[start] ?? "")) assignments.push(result[start++] ?? "");
    if (result[start] !== prefix) continue;
    start++;
    // Options of env, for example `-i` or `-u NAME`.
    while ((result[start] ?? "").startsWith("-")) {
      start += result[start] === "-u" || result[start] === "--unset" ? 2 : 1;
    }
  }
  while (ASSIGNMENT.test(result[start] ?? "")) assignments.push(result[start++] ?? "");
  return { assignments, words: result.slice(start) };
}

/** Applies the `DOCKER_*` words of `assignments` to a copy of `environment`. */
function dockerEnvironment(
  environment: Readonly<Record<string, string>>,
  assignments: ReadonlyArray<string>,
): Record<string, string> {
  const result = { ...environment };
  for (const assignment of assignments) {
    const equals = assignment.indexOf("=");
    const variable = assignment.slice(0, equals);
    if (DOCKER_ENVIRONMENT[variable] === true) result[variable] = assignment.slice(equals + 1);
  }
  return result;
}

function quote(word: string): string {
  return SAFE_WORD.test(word) ? word : `'${word.replaceAll("'", "'\\''")}'`;
}

/** Resolves a path word, or returns undefined when the word is not literal. */
function resolvePath(word: string, base: string | undefined, home: string): string | undefined {
  if (UNRESOLVED.test(word)) return undefined;
  if (word === "~") return resolve(home);
  if (word.startsWith("~/")) return resolve(home, word.slice(2));
  if (word.startsWith("~")) return undefined;
  if (isAbsolute(word)) return resolve(word);
  return base === undefined ? undefined : resolve(base, word);
}

function changeDirectory(
  args: ReadonlyArray<string>,
  directory: string | undefined,
  home: string,
): string | undefined {
  const target = args.find((word) => word === "-" || !word.startsWith("-"));
  if (target === undefined) return resolve(home);
  if (target === "-") return undefined;
  return resolvePath(target, directory, home);
}

function lastAbsoluteLine(output: string): string | undefined {
  return output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== "" && isAbsolute(line))
    .pop();
}

/** True when `sequence` occurs in `words` in order, with other words between. */
function containsInOrder(words: ReadonlyArray<string>, sequence: ReadonlyArray<string>): boolean {
  let position = 0;
  for (const word of words) {
    if (word === sequence[position]) position++;
    if (position === sequence.length) return true;
  }
  return sequence.length === 0;
}

function matchesCommand(
  name: string,
  words: ReadonlyArray<string>,
  pattern: ReadonlyArray<string>,
): boolean {
  return name === pattern[0] && containsInOrder(words.slice(1), pattern.slice(1));
}

/** Skips git global options and returns the effective directory and arguments. */
function gitArguments(
  words: ReadonlyArray<string>,
  directory: string | undefined,
  home: string,
): { directory: string | undefined; args: Array<string> } {
  let current = directory;
  let index = 1;
  while (index < words.length) {
    const word = words[index] ?? "";
    if (GIT_VALUE_OPTIONS[word] === true) {
      const value = words[index + 1];
      if (word === "-C") current = value === undefined ? undefined : resolvePath(value, current, home);
      index += 2;
    } else if (word.startsWith("-")) {
      index++;
    } else {
      break;
    }
  }
  return { directory: current, args: words.slice(index) };
}

/**
 * Reads a docker command: the daemon target and the arguments after the
 * global options. `target` is undefined when a value of the target is not
 * literal. Returns undefined for a command that is not docker.
 */
function dockerCommand(
  name: string,
  words: ReadonlyArray<string>,
  environment: Readonly<Record<string, string>>,
): { target: DockerTarget | undefined; args: Array<string> } | undefined {
  if (name !== "docker" && name !== "docker-compose") return undefined;
  const target: DockerTarget = { environment: {}, options: [] };
  let literal = true;
  for (const [variable, value] of Object.entries(environment)) {
    if (value === "") continue;
    if (UNRESOLVED.test(value)) literal = false;
    target.environment[variable] = value;
  }
  if (name === "docker-compose") {
    return { target: literal ? target : undefined, args: ["compose", ...words.slice(1)] };
  }

  let index = 1;
  while (index < words.length && (words[index] ?? "").startsWith("-")) {
    const word = words[index] ?? "";
    const equals = word.indexOf("=");
    const option = equals > 0 ? word.slice(0, equals) : word;
    const longName = DOCKER_CONNECTION_VALUE_OPTIONS[option];
    if (longName !== undefined) {
      const value = equals > 0 ? word.slice(equals + 1) : words[index + 1];
      index += equals > 0 ? 1 : 2;
      if (value === undefined) break;
      if (UNRESOLVED.test(value)) literal = false;
      target.options.push(longName, value);
    } else {
      if (DOCKER_CONNECTION_FLAGS[option] === true) target.options.push(word);
      index += DOCKER_LOG_LEVEL_OPTIONS[option] === true && equals < 0 ? 2 : 1;
    }
  }
  return { target: literal ? target : undefined, args: words.slice(index) };
}

/** The docker command prefix that reaches `target`, for a cleanup command. */
function dockerPrefix(target: DockerTarget): string {
  return [
    ...Object.entries(target.environment).map(([variable, value]) => `${variable}=${quote(value)}`),
    "docker",
    ...target.options.map(quote),
  ].join(" ");
}

function sshFlags(args: ReadonlyArray<string>): Set<string> {
  const flags = new Set<string>();
  for (let index = 0; index < args.length; index++) {
    const word = args[index] ?? "";
    if (!word.startsWith("-") || word.startsWith("--") || word === "-") continue;
    for (let position = 1; position < word.length; position++) {
      const letter = word[position] ?? "";
      flags.add(letter);
      if (SSH_VALUE_FLAGS.includes(letter)) {
        if (position === word.length - 1) index++;
        break;
      }
    }
  }
  return flags;
}

function unresolvedNote(noun: string, command: string): string {
  return `You created a ${noun}. When the task no longer needs it, run \`${command}\`.`;
}

// ---------------------------------------------------------------- detect ----

interface Findings {
  readonly resource: (resource: HygieneResource) => void;
  readonly note: (note: string) => void;
}

/** The state that a `cd` or an `export` changes, one for each subshell scope. */
interface ScopeState {
  directory: string | undefined;
  dockerEnvironment: Record<string, string>;
}

/** One simple command, with the state of its scope applied. */
interface CommandContext {
  readonly name: string;
  readonly words: ReadonlyArray<string>;
  readonly directory: string | undefined;
  readonly dockerEnvironment: Readonly<Record<string, string>>;
}

/**
 * Finds the resources that a successful bash command created. A resource
 * whose path or id is not literal in the command or the output gives a
 * generic note in place of a ledger entry.
 */
export function detectResources(
  command: string,
  cwd: string,
  output: string,
  home: string,
): { resources: Array<HygieneResource>; notes: Array<string> } {
  const found = new Map<string, HygieneResource>();
  const notes: Array<string> = [];
  const findings: Findings = {
    resource: (resource) => {
      found.set(resourceKey(resource), resource);
    },
    note: (note) => {
      if (!notes.includes(note)) notes.push(note);
    },
  };

  // A subshell scope starts with a copy of its parent state at its first
  // command, so a `cd` in a subshell does not change the commands after it.
  const states = new Map<string, ScopeState>([
    [ROOT_SCOPE, { directory: cwd, dockerEnvironment: {} }],
  ]);
  const stateOf = (scope: string): ScopeState => {
    const known = states.get(scope);
    if (known !== undefined) return known;
    const parent = stateOf(scope.slice(0, scope.lastIndexOf("/")));
    const state = { directory: parent.directory, dockerEnvironment: { ...parent.dockerEnvironment } };
    states.set(scope, state);
    return state;
  };

  const segments = scopedSegments(command, ROOT_SCOPE);
  // Only a command that runs alone and prints to the tool output owns that
  // output. A substitution such as `f=$(mktemp)` captures what mktemp prints,
  // a later command can print an unrelated path, and a redirection or a
  // process substitution sends the output elsewhere, so these get the
  // generic note.
  const sole = segments.length === 1 ? segments[0] : undefined;
  const ownPath =
    sole !== undefined && printsToOutput(sole.words) ? lastAbsoluteLine(output) : undefined;
  for (const segment of segments) {
    const { assignments, words } = commandWords(segment.words);
    const first = words[0];
    if (first === undefined) continue;
    const name = (first.split(/[\\/]/).pop() ?? first).replace(/\.exe$/i, "");
    const state = stateOf(segment.scope);
    if (name === "cd" || name === "pushd") {
      state.directory = changeDirectory(words.slice(1), state.directory, home);
      continue;
    }
    if (name === "export") {
      state.dockerEnvironment = dockerEnvironment(state.dockerEnvironment, words.slice(1));
      continue;
    }
    if (name === "unset") {
      for (const variable of words.slice(1)) delete state.dockerEnvironment[variable];
      continue;
    }
    const context: CommandContext = {
      name,
      words,
      directory: state.directory,
      dockerEnvironment: dockerEnvironment(state.dockerEnvironment, assignments),
    };
    detectCreation(context, home, output, ownPath, findings);
    const text = segment.words.map(quote).join(" ").slice(0, COMMAND_TEXT_LIMIT);
    for (const rule of otherRules(context, segment.background, home)) {
      findings.resource({ kind: "other", category: rule.category, command: text, hint: rule.hint });
    }
  }
  return { resources: [...found.values()], notes };
}

function detectCreation(
  context: CommandContext,
  home: string,
  output: string,
  ownPath: string | undefined,
  findings: Findings,
): void {
  const { name, words, directory } = context;
  if (name === "git") {
    const git = gitArguments(words, directory, home);
    if (git.args[0] === "worktree" && git.args[1] === "add") {
      detectWorktree(git.args.slice(2), git.directory, home, findings);
    }
    return;
  }

  const docker = dockerCommand(name, words, context.dockerEnvironment);
  if (docker !== undefined) {
    const { target, args } = docker;
    if (args[0] === "compose") detectCompose(args.slice(1), target, directory, home, findings);
    else if (args[0] === "run") detectContainer(args.slice(1), target, output, findings);
    else if (args[0] === "container" && args[1] === "run") {
      detectContainer(args.slice(2), target, output, findings);
    }
    return;
  }

  if (name === "docks-kit" && words[1] === "scratch" && words[2] === "new") {
    if (ownPath === undefined) {
      findings.note(unresolvedNote("scratch directory", "docks-kit scratch remove <path>"));
    } else {
      findings.resource({ kind: "scratch", path: ownPath });
    }
    return;
  }

  if (name === "mktemp") detectMktemp(words.slice(1), ownPath, findings);
}

/** mktemp creates a file, or a directory with `-d`; a dry run (`-u`) creates nothing. */
function detectMktemp(
  args: ReadonlyArray<string>,
  path: string | undefined,
  findings: Findings,
): void {
  const effect = mktempEffect(args);
  if (effect === "nothing") return;
  const directory = effect === "directory";
  if (path === undefined) {
    const noun = directory ? "temporary directory" : "temporary file";
    findings.note(unresolvedNote(noun, "docks-kit scratch remove <path>"));
  } else {
    findings.resource({ kind: directory ? "tempDir" : "tempFile", path });
  }
  findings.note(SCRATCH_NOTE);
}

/**
 * Reads the options of an mktemp call, which GNU mktemp accepts before and
 * after the template. The value of `--suffix` or `-p`, the template, and every
 * word after `--` are not options, so `--suffix -upload` is no dry run.
 */
function mktempEffect(args: ReadonlyArray<string>): "file" | "directory" | "nothing" {
  let directory = false;
  for (let index = 0; index < args.length; index++) {
    const word = args[index] ?? "";
    if (word === "--") break;
    if (!word.startsWith("-") || word === "-") continue;
    if (word.startsWith("--")) {
      const name = word.split("=", 1)[0] ?? word;
      if (MKTEMP_CREATES_NOTHING[name] === true) return "nothing";
      if (name === "--directory") directory = true;
      if (name === "--suffix" && !word.includes("=")) index++;
      continue;
    }
    for (let at = 1; at < word.length; at++) {
      const flag = word[at];
      if (flag === "u") return "nothing";
      if (flag === "d") directory = true;
      if (flag === "p") {
        // `-p DIR` takes the next word; in `-pDIR` the rest of the word is the value.
        if (at === word.length - 1) index++;
        break;
      }
    }
  }
  return directory ? "directory" : "file";
}

/** True when no word of the segment redirects its output or runs a process substitution. */
function printsToOutput(words: ReadonlyArray<string>): boolean {
  return !words.some(
    (word) =>
      REDIRECT_OPERATOR.test(word) ||
      ATTACHED_REDIRECT.test(word) ||
      word.includes("<(") ||
      word.includes(">("),
  );
}

function detectWorktree(
  args: ReadonlyArray<string>,
  directory: string | undefined,
  home: string,
  findings: Findings,
): void {
  let optionsEnded = false;
  for (let index = 0; index < args.length; index++) {
    const word = args[index] ?? "";
    if (!optionsEnded && word === "--") {
      optionsEnded = true;
    } else if (!optionsEnded && WORKTREE_VALUE_OPTIONS[word] === true) {
      index++;
    } else if (optionsEnded || !word.startsWith("-") || word === "-") {
      const path = resolvePath(word, directory, home);
      if (path === undefined) {
        findings.note(unresolvedNote("git worktree", "git worktree remove -- <path>"));
      } else {
        findings.resource({ kind: "worktree", path });
      }
      return;
    }
  }
}

function detectCompose(
  args: ReadonlyArray<string>,
  target: DockerTarget | undefined,
  directory: string | undefined,
  home: string,
  findings: Findings,
): void {
  const files: Array<string> = [];
  let project: string | undefined;
  let projectDirectory: string | undefined;
  let subcommand: string | undefined;
  for (let index = 0; index < args.length; index++) {
    const word = args[index] ?? "";
    const equals = word.startsWith("-") ? word.indexOf("=") : -1;
    const option = equals > 0 ? word.slice(0, equals) : word;
    if (COMPOSE_VALUE_OPTIONS[option] === true) {
      const value = equals > 0 ? word.slice(equals + 1) : args[++index];
      if (value === undefined) break;
      if (option === "-f" || option === "--file") files.push(value);
      else if (option === "-p" || option === "--project-name") project = value;
      else if (option === "--project-directory") projectDirectory = value;
    } else if (!word.startsWith("-")) {
      subcommand = word;
      break;
    }
  }
  if (subcommand !== "up" && subcommand !== "start") return;

  const unresolved = unresolvedNote(
    "detached container",
    "docker compose --project-directory <path> down",
  );
  const resolvedFiles: Array<string> = [];
  for (const file of files) {
    const path = file === "-" ? undefined : resolvePath(file, directory, home);
    if (path === undefined) {
      findings.note(unresolved);
      return;
    }
    resolvedFiles.push(path);
  }
  const firstFile = resolvedFiles[0];
  const workingDir =
    projectDirectory !== undefined
      ? resolvePath(projectDirectory, directory, home)
      : firstFile !== undefined
        ? dirname(firstFile)
        : directory;
  if (
    target === undefined ||
    workingDir === undefined ||
    (project !== undefined && UNRESOLVED.test(project))
  ) {
    findings.note(unresolved);
    return;
  }

  const down = [dockerPrefix(target), "compose"];
  if (project !== undefined) down.push("-p", quote(project));
  if (projectDirectory !== undefined || resolvedFiles.length === 0) {
    down.push("--project-directory", quote(workingDir));
  }
  for (const file of resolvedFiles) down.push("-f", quote(file));
  down.push("down");
  findings.resource({ kind: "compose", workingDir, down: down.join(" "), docker: target });
}

function detectContainer(
  args: ReadonlyArray<string>,
  target: DockerTarget | undefined,
  output: string,
  findings: Findings,
): void {
  const detached = args.some(
    (word) => word === "--detach" || word === "--detach=true" || SHORT_CLUSTER_WITH_D.test(word),
  );
  const removesItself = args.some((word) => word === "--rm" || word === "--rm=true");
  if (detached) {
    const line = output
      .split(/\r?\n/)
      .map((text) => text.trim())
      .filter((text) => text !== "")
      .pop();
    if (target !== undefined && line !== undefined && CONTAINER_ID.test(line)) {
      const id = line.slice(0, 12);
      const prefix = dockerPrefix(target);
      const down = removesItself
        ? `${prefix} stop ${id}`
        : `${prefix} stop ${id} && ${prefix} rm ${id}`;
      findings.resource({ kind: "container", id, down, docker: target });
    } else {
      findings.note(unresolvedNote("detached container", "docker stop <id>"));
    }
  }
  if (!removesItself) findings.note(RM_NOTE);
}

function otherRules(
  context: CommandContext,
  background: boolean,
  home: string,
): Array<OtherRule> {
  const { name, words } = context;
  const rules: Array<OtherRule> = [];
  const args = words.slice(1);
  const has = (word: string): boolean => args.includes(word);
  const hasAny = (...candidates: Array<string>): boolean => candidates.some(has);
  const global = hasAny("-g", "--global");

  if (
    background ||
    name === "nohup" ||
    name === "setsid" ||
    name === "disown" ||
    has("disown")
  ) {
    rules.push(BACKGROUND);
  }

  const detachFlag = args.some((word) => SHORT_CLUSTER_WITH_D.test(word));
  if (
    ((name === "tmux" && hasAny("new", "new-session")) || name === "screen") &&
    detachFlag
  ) {
    rules.push(TERMINAL);
  }

  const ssh = name === "ssh" ? sshFlags(args) : undefined;
  if (
    name === "ngrok" ||
    (name === "cloudflared" && has("tunnel")) ||
    (name === "kubectl" && has("port-forward")) ||
    (ssh !== undefined &&
      (ssh.has("L") || ssh.has("R") || ssh.has("D")) &&
      (ssh.has("N") || ssh.has("f")))
  ) {
    rules.push(TUNNEL);
  }

  if (CLUSTER_COMMANDS.some((pattern) => matchesCommand(name, words, pattern))) {
    rules.push(CLUSTER);
  }

  const docker = dockerCommand(name, words, context.dockerEnvironment)?.args;
  if (
    docker !== undefined &&
    (docker[0] === "volume" || docker[0] === "network" || docker[0] === "buildx") &&
    docker[1] === "create"
  ) {
    rules.push(DOCKER_RESOURCE);
  }

  if (
    (name === "crontab" && !has("-l")) ||
    name === "at" ||
    (name === "systemctl" && has("--user") && hasAny("enable", "start")) ||
    (name === "systemd-run" && has("--user")) ||
    (name === "launchctl" && hasAny("load", "bootstrap"))
  ) {
    rules.push(SCHEDULED);
  }

  if (
    (name === "npm" && hasAny("i", "install") && global) ||
    (name === "bun" && hasAny("add", "install", "i") && global) ||
    (name === "pnpm" && has("add") && global) ||
    (name === "yarn" && containsInOrder(args, ["global", "add"])) ||
    (/^pip[0-9.]*$/.test(name) && has("install") && has("--user")) ||
    ((name === "pipx" || name === "cargo" || name === "go") && has("install"))
  ) {
    rules.push(GLOBAL_INSTALL);
  }

  if (
    (name === "vercel" && !has("env")) ||
    REMOTE_COMMANDS.some((pattern) => matchesCommand(name, words, pattern))
  ) {
    rules.push(REMOTE);
  }

  if (name === "git") {
    const git = gitArguments(words, context.directory, home);
    if (git.args[0] === "stash" && STASH_WITHOUT_ENTRY[git.args[1] ?? ""] !== true) {
      rules.push(STASH);
    }
  }
  return rules;
}

// ----------------------------------------------------------- reminders ----

function resourceKey(resource: HygieneResource): string {
  switch (resource.kind) {
    case "worktree":
    case "scratch":
    case "tempDir":
    case "tempFile":
      return `${resource.kind}:${resource.path}`;
    case "compose":
      return `compose:${dockerPrefix(resource.docker)}:${resource.workingDir}`;
    case "container":
      return `container:${dockerPrefix(resource.docker)}:${resource.id}`;
    case "other":
      return `other:${resource.category}:${resource.command}`;
  }
}

function describeResource(resource: PathResource): string {
  switch (resource.kind) {
    case "worktree":
      return `the worktree ${resource.path}`;
    case "compose":
      return `the compose project in ${resource.workingDir}`;
    case "container":
      return `the container ${resource.id}`;
    case "scratch":
      return `the scratch directory ${resource.path}`;
    case "tempDir":
      return `the temporary directory ${resource.path}`;
    case "tempFile":
      return `the temporary file ${resource.path}`;
  }
}

export function cleanupCommand(resource: HygieneResource): string {
  switch (resource.kind) {
    case "worktree":
      return `git worktree remove -- ${quote(resource.path)}`;
    case "compose":
    case "container":
      return resource.down;
    case "scratch":
    case "tempDir":
    case "tempFile":
      return `docks-kit scratch remove ${quote(resource.path)}`;
    case "other":
      return resource.hint;
  }
}

export function creationReminder(resource: HygieneResource): string {
  if (resource.kind === "other") {
    return `This command created a ${resource.category} (\`${resource.command}\`). ${resource.hint}`;
  }
  return `You created ${describeResource(resource)}. When the task no longer needs it, run \`${cleanupCommand(resource)}\`.`;
}

function stopLine(resource: HygieneResource): string {
  if (resource.kind === "other") {
    return `- ${resource.category}: \`${resource.command}\` (${resource.hint})`;
  }
  return `- ${describeResource(resource)}: run \`${cleanupCommand(resource)}\``;
}

export function stopReminder(
  verified: ReadonlyArray<HygieneResource>,
  unverified: ReadonlyArray<HygieneResource>,
): string {
  const lines: Array<string> = [];
  if (verified.length > 0) {
    lines.push("These resources from this session still exist:", ...verified.map(stopLine));
  }
  if (unverified.length > 0) {
    lines.push(
      "These commands from this session may have left something running, installed, or created:",
      ...unverified.map(stopLine),
    );
  }
  lines.push(KEEP_SENTENCE);
  return lines.join("\n");
}

// ----------------------------------------------------------------- sweep ----

export function sweepDue(stampMtimeMs: number | undefined, nowMs: number): boolean {
  return stampMtimeMs === undefined || nowMs - stampMtimeMs >= SWEEP_INTERVAL_MS;
}

function mtimeMs(path: string): number | undefined {
  try {
    return statSync(path).mtimeMs;
  } catch {
    return undefined;
  }
}

function removeIfPresent(path: string): void {
  try {
    unlinkSync(path);
  } catch (error) {
    if (errorCode(error) !== "ENOENT") throw error;
  }
}

/**
 * Creates `path` with `wx` and writes an owner token into it. Returns the
 * token, or undefined when the file exists.
 */
function createOwned(path: string): string | undefined {
  let descriptor: number;
  try {
    descriptor = openSync(path, "wx", 0o600);
  } catch (error) {
    if (errorCode(error) === "EEXIST") return undefined;
    throw error;
  }
  const token = `${process.pid} ${randomUUID()}`;
  try {
    writeFileSync(descriptor, token);
  } finally {
    closeSync(descriptor);
  }
  return token;
}

/** Removes `path` only when it still holds `token`, so that no process removes the file of another. */
function releaseOwned(path: string, token: string): void {
  try {
    if (readFileSync(path, "utf8") === token) unlinkSync(path);
  } catch (error) {
    if (errorCode(error) !== "ENOENT") throw error;
  }
}

/** True when `path` is missing or older than CLAIM_STALE_MS: its process stopped. */
function isStale(path: string, nowMs: number): boolean {
  const mtime = mtimeMs(path);
  return mtime === undefined || nowMs - mtime > CLAIM_STALE_MS;
}

/**
 * Creates the claim and returns its token, or returns undefined when another
 * process holds it. Only the holder of the takeover mutex replaces a stale
 * claim, and it checks the claim again while it holds the mutex. Thus two
 * processes cannot both replace the same stale claim.
 */
function acquireClaim(cacheDir: string, nowMs: number): string | undefined {
  const claim = join(cacheDir, CLAIM_FILE);
  const token = createOwned(claim);
  if (token !== undefined || !isStale(claim, nowMs)) return token;

  const takeover = join(cacheDir, TAKEOVER_FILE);
  let mutex = createOwned(takeover);
  if (mutex === undefined && isStale(takeover, nowMs)) {
    removeIfPresent(takeover);
    mutex = createOwned(takeover);
  }
  if (mutex === undefined) return undefined;
  try {
    if (!isStale(claim, nowMs)) return undefined;
    removeIfPresent(claim);
    return createOwned(claim);
  } finally {
    releaseOwned(takeover, mutex);
  }
}

/**
 * Lets one process in each sweep interval start the sweep. The process that
 * holds `tidy.stamp.claim` reads the stamp again. When the sweep is still
 * due, it writes the stamp and returns true. It always releases its claim.
 */
export function claimSweep(cacheDir: string, nowMs: number): boolean {
  mkdirSync(cacheDir, { recursive: true, mode: 0o700 });
  chmodSync(cacheDir, 0o700);
  const token = acquireClaim(cacheDir, nowMs);
  if (token === undefined) return false;
  try {
    const stamp = join(cacheDir, STAMP_FILE);
    if (!sweepDue(mtimeMs(stamp), nowMs)) return false;
    writeFileSync(stamp, "", { mode: 0o600 });
    chmodSync(stamp, 0o600);
    const seconds = nowMs / 1000;
    utimesSync(stamp, seconds, seconds);
    return true;
  } finally {
    releaseOwned(join(cacheDir, CLAIM_FILE), token);
  }
}

// ---------------------------------------------------------------- ledger ----

/**
 * One omp process shares module state across its sessions, so the main
 * session also sees the resources that its subagents created.
 */
const ledger = new Map<string, HygieneResource>();
const reminded = new Set<string>();

async function dockerListsAny(
  target: DockerTarget,
  args: ReadonlyArray<string>,
): Promise<boolean> {
  try {
    const result = await run("docker", [...target.options, ...args], {
      env: { ...process.env, ...target.environment },
      timeoutMs: DOCKER_CHECK_TIMEOUT_MS,
    });
    return result.code === 0 && result.stdout.trim() !== "";
  } catch {
    return false;
  }
}

async function stillExists(resource: HygieneResource): Promise<boolean> {
  switch (resource.kind) {
    case "worktree":
    case "scratch":
    case "tempDir":
    case "tempFile":
      return existsSync(resource.path);
    case "compose":
      return dockerListsAny(resource.docker, [
        "ps",
        "-q",
        "--filter",
        `label=com.docker.compose.project.working_dir=${resource.workingDir}`,
      ]);
    case "container":
      return dockerListsAny(resource.docker, ["ps", "-aq", "--filter", `id=${resource.id}`]);
    case "other":
      return true;
  }
}

function textResult(text: string, details: Record<string, unknown>): ToolResult {
  return { content: [{ type: "text", text }], details };
}

// ------------------------------------------------------------- extension ----

export default function docksKitOmp(pi: ExtensionApi): void {
  const z = pi.zod;

  pi.registerTool<{ label: string }>({
    name: "scratch_new",
    label: "Scratch New",
    description:
      "Create a private temporary directory under the docks-kit scratch root and return its path. Use it instead of /tmp, also for a single temporary file. Remove it with scratch_remove when the task no longer needs it.",
    parameters: z.object({
      label: z.string().describe("Short name: letters, digits, dot, underscore, or hyphen"),
    }),
    async execute(_toolCallId, params, signal) {
      try {
        if (!LABEL_PATTERN.test(params.label)) throw new Error(LABEL_ERROR);
        const output = await runDocksKit(
          ["scratch", "new", params.label],
          signal,
          SCRATCH_TIMEOUT_MS,
        );
        const path = lastAbsoluteLine(output);
        if (path === undefined) throw new Error(`docks-kit scratch new printed no path: ${output}`);
        const resource: HygieneResource = { kind: "scratch", path };
        ledger.set(resourceKey(resource), resource);
        return textResult(path, { path });
      } catch (error) {
        throw toError(error);
      }
    },
  });

  pi.registerTool<{ paths: Array<string> }>({
    name: "scratch_remove",
    label: "Scratch Remove",
    description:
      "Remove temporary files and directories that you created. Use it instead of gio trash, which does not work on a tmpfs /tmp. Accepts only absolute paths inside the docks-kit scratch root, the system temporary directory, or /var/tmp; refuses every other path.",
    parameters: z.object({
      paths: z.array(z.string()).describe("Absolute paths"),
    }),
    async execute(_toolCallId, params, signal) {
      try {
        if (params.paths.length === 0) throw new Error("paths must not be empty");
        const relative = params.paths.find((path) => !isAbsolute(path));
        if (relative !== undefined) throw new Error(`path must be absolute: ${relative}`);
        const output = await runDocksKit(
          ["scratch", "remove", ...params.paths],
          signal,
          SCRATCH_TIMEOUT_MS,
        );
        return textResult(output.trim(), { paths: params.paths });
      } catch (error) {
        throw toError(error);
      }
    },
  });

  pi.registerTool<Record<string, never>>({
    name: "tidy_report",
    label: "Tidy Report",
    description:
      "List agent leftovers and other disk and memory use (worktrees, containers, orphaned processes, scratch, /tmp, caches, Trash, branches, scheduled jobs, global installs). Read-only.",
    parameters: z.object({}),
    async execute(_toolCallId, _params, signal) {
      try {
        const output = await runDocksKit(["tidy", "--report"], signal, REPORT_TIMEOUT_MS);
        return textResult(output.trim(), {});
      } catch (error) {
        throw toError(error);
      }
    },
  });

  pi.on("tool_result", async (event, ctx) => {
    try {
      if (event.toolName !== "bash" || event.isError === true) return undefined;
      const command = event.input?.["command"];
      if (typeof command !== "string" || !TRIGGER.test(command)) return undefined;
      const cwd = resolve(ctx.cwd, String(event.input?.["cwd"] ?? "."));
      const output = (event.content ?? [])
        .map((block) => (block.type === "text" && typeof block.text === "string" ? block.text : ""))
        .join("\n");
      const { resources, notes } = detectResources(command, cwd, output, homedir());
      for (const resource of resources) ledger.set(resourceKey(resource), resource);
      const lines = [...resources.map(creationReminder), ...notes];
      return lines.length === 0 ? undefined : { additionalContext: lines.join("\n") };
    } catch {
      return undefined;
    }
  });

  pi.on("session_stop", async (event) => {
    try {
      if (event.stop_hook_active === true) return undefined;
      const pending = [...ledger].filter(([key]) => !reminded.has(key));
      if (pending.length === 0) return undefined;
      const states = await Promise.all(
        pending.map(async ([key, resource]) => ({
          key,
          resource,
          exists: await stillExists(resource),
        })),
      );
      const verified: Array<HygieneResource> = [];
      const unverified: Array<HygieneResource> = [];
      for (const { key, resource, exists } of states) {
        if (!exists) {
          ledger.delete(key);
          continue;
        }
        reminded.add(key);
        if (resource.kind === "other") unverified.push(resource);
        else verified.push(resource);
      }
      if (verified.length === 0 && unverified.length === 0) return undefined;
      return { continue: true, additionalContext: stopReminder(verified, unverified) };
    } catch {
      return undefined;
    }
  });

  pi.on("session_start", async (_event, ctx) => {
    try {
      if (ctx.agent?.kind === "sub") return undefined;
      // The same directory as kitCacheDir in the docks-kit CLI.
      const cacheDir = join(homedir(), ".cache", "docks-kit");
      const now = Date.now();
      if (!sweepDue(mtimeMs(join(cacheDir, STAMP_FILE)), now)) return undefined;
      const docksKit = resolveDocksKit();
      if (!claimSweep(cacheDir, now)) return undefined;
      const child = spawn(docksKit, ["tidy", "--apply"], {
        cwd: homedir(),
        detached: true,
        shell: false,
        stdio: "ignore",
        windowsHide: true,
      });
      child.on("error", () => {});
      child.unref();
    } catch {
      // A sweep that cannot start must not stop the session.
    }
    return undefined;
  });
}
