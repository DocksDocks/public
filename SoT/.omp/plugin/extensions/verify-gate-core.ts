// The host-neutral core of the verify-gate omp extension (`verify-gate.ts`): check that each
// `git commit` in a shell command carries a `Verified:` git trailer, the record of how the
// commit was verified. Format: `Verified: <command>[; <command>]` or `Verified: none - <reason>`.
//
// Mode comes from DOCKS_VERIFY_GATE:
//   off      allow every command and write nothing.
//   observe  (default) allow every command. A bash command that holds a commit without the
//            trailer writes one log line for that command to
//            ${XDG_STATE_HOME:-~/.local/state}/docks/verify-gate.jsonl, with the message sources
//            of its first commit without the trailer. The line holds metadata only: time,
//            session_id, cwd, mode, and the kinds of message source. It never holds the raw
//            command or any message text, because a command or a message can hold a secret.
//   enforce  deny such a command the first two times in a session. The third time, allow it,
//            write one log line for that command with allowed_after_denials, and start the
//            count again. A denial count older than seven days expires, so the cycle starts
//            again at the first denial.
//   A command whose commits all carry the trailer writes nothing. A `git commit --dry-run`
//   counts as no commit, also when the first commit without the trailer is chosen. An unknown
//   value works as observe.
//   A check that throws or passes its deadline allows the command; it can then write no log line
//   and count no denial, so a missing log line does not prove a trailer.
//
// The core finds each commit in the command itself, so the adapter gives it every bash
// command. Each git call and each file operation is asynchronous, so a check does not hold
// the event loop of omp. The core never reads the stdin of omp: `-F -`, `-F /dev/stdin`, and
// `-F /dev/fd/0` take the heredoc text of the command. A `-F` path or a denial file that is not
// a regular file (a FIFO or a device can block a read without end) makes the check throw. A
// check stops at its deadline: the git calls and file reads of that check stop with it, and the
// check writes no state after it. The core reads and writes nothing on stdout or stderr: the
// adapter allows the command when the core throws.
import { execFile } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

type Mode = 'off' | 'observe' | 'enforce';
const MODES: ReadonlySet<string> = new Set<Mode>(['off', 'observe', 'enforce']);
const isMode = (value: string): value is Mode => MODES.has(value);
const DENIALS_BEFORE_ALLOW = 2;
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const TRAILER_FORMAT = '`Verified: <command>[; <command>]` or `Verified: none - <reason>`';
// Each git call stops after this time.
const GIT_TIMEOUT_MS = 5000;
// A whole check stops after this time, below the 30 s after which omp blocks a tool call
// whose handler still runs.
const CHECK_DEADLINE_MS = 20_000;
// These `-F` names are the stdin of the command, that is its heredoc text, not the stdin of omp.
const STDIN_NAMES = new Set(['-', '/dev/stdin', '/dev/fd/0']);

// ---------- shell tokenizer ----------

// One simple command of a shell command: its words and the text on its stdin, when it has one.
interface ShellCommand {
  readonly words: ReadonlyArray<string>;
  readonly stdin: string | null;
}

// The stdin of a command whose heredoc body comes after the end of the command line.
interface HeredocTarget {
  stdin: string;
}

interface Heredoc {
  readonly delimiter: string;
  readonly stripTabs: boolean;
}

interface PendingHeredoc extends Heredoc {
  readonly target: HeredocTarget;
}

// Split a shell command into simple commands. Each command is { words, stdin }.
// Words keep quotes removed; `$(...)` stays as raw text. `stdin` holds
// the body of a heredoc or a here-string on that command, when one exists.
function parseShell(src: string): ShellCommand[] {
  const commands: Array<{ words: string[]; stdin: string | HeredocTarget | null }> = [];
  let words: string[] = [];
  let word: string | null = null;
  let stdin: string | HeredocTarget | null = null;
  const pendingHeredocs: PendingHeredoc[] = [];
  let i = 0;

  const pushWord = (): void => {
    if (word !== null) words.push(word);
    word = null;
  };
  const endCommand = (): void => {
    pushWord();
    if (words.length > 0) commands.push({ words, stdin });
    words = [];
    stdin = null;
  };
  const readHeredocBodies = (): void => {
    // i points just after a newline.
    for (const doc of pendingHeredocs.splice(0)) {
      const lines: string[] = [];
      while (i < src.length) {
        const end = src.indexOf('\n', i);
        const rawLine = end === -1 ? src.slice(i) : src.slice(i, end);
        i = end === -1 ? src.length : end + 1;
        const line = doc.stripTabs ? rawLine.replace(/^\t+/u, '') : rawLine;
        if (line === doc.delimiter) break;
        lines.push(line);
      }
      doc.target.stdin = lines.length > 0 ? `${lines.join('\n')}\n` : '';
    }
  };

  while (i < src.length) {
    const c = src[i];
    if (c === '\n') {
      endCommand();
      i += 1;
      if (pendingHeredocs.length > 0) readHeredocBodies();
      continue;
    }
    if (c === ' ' || c === '\t') {
      pushWord();
      i += 1;
      continue;
    }
    if (c === '#' && word === null) {
      while (i < src.length && src[i] !== '\n') i += 1;
      continue;
    }
    if (c === ';' || c === '&' || c === '|' || c === '(' || c === ')') {
      endCommand();
      i += 1;
      continue;
    }
    if (c === '<' && src.startsWith('<<<', i)) {
      pushWord();
      i += 3;
      while (src[i] === ' ' || src[i] === '\t') i += 1;
      const { value, next } = readWord(src, i);
      i = next;
      stdin = `${value}\n`;
      continue;
    }
    if (c === '<' && src[i + 1] === '<') {
      pushWord();
      i += 2;
      const stripTabs = src[i] === '-';
      if (stripTabs) i += 1;
      while (src[i] === ' ' || src[i] === '\t') i += 1;
      const { value, next } = readWord(src, i);
      i = next;
      // The heredoc belongs to the command that is open now; endCommand copies `stdin`.
      const target = { stdin: '' };
      pendingHeredocs.push({ delimiter: value, stripTabs, target });
      stdin = target;
      continue;
    }
    if (c === '>' || c === '<') {
      // Other redirections: drop the operator and its target word.
      pushWord();
      i += 1;
      while (src[i] === '>' || src[i] === '&') i += 1;
      while (src[i] === ' ' || src[i] === '\t') i += 1;
      i = readWord(src, i).next;
      continue;
    }
    const { value, next } = readWord(src, i);
    word = (word ?? '') + value;
    i = next;
  }
  endCommand();
  // Resolve heredoc targets to their text.
  return commands.map(({ words: commandWords, stdin: commandStdin }) => ({
    words: commandWords,
    stdin: commandStdin !== null && typeof commandStdin === 'object' ? commandStdin.stdin : commandStdin,
  }));
}

// Read one word starting at i. Stops at an unquoted space, operator, or newline.
function readWord(src: string, start: number): { value: string; next: number } {
  let i = start;
  let value = '';
  while (i < src.length) {
    const c = src[i];
    if (' \t\n;&|()<>'.includes(c)) break;
    if (c === '\\') {
      if (src[i + 1] === '\n') {
        i += 2;
        continue;
      }
      value += src[i + 1] ?? '';
      i += 2;
      continue;
    }
    if (c === "'") {
      const end = src.indexOf("'", i + 1);
      const stop = end === -1 ? src.length : end;
      value += src.slice(i + 1, stop);
      i = stop + 1;
      continue;
    }
    if (c === '"') {
      i += 1;
      while (i < src.length && src[i] !== '"') {
        if (src[i] === '\\' && '$`"\\\n'.includes(src[i + 1])) {
          if (src[i + 1] !== '\n') value += src[i + 1];
          i += 2;
          continue;
        }
        if (src[i] === '$' && src[i + 1] === '(') {
          const end = substitutionEnd(src, i + 2);
          value += src.slice(i, end);
          i = end;
          continue;
        }
        value += src[i];
        i += 1;
      }
      i += 1;
      continue;
    }
    if (c === '$' && src[i + 1] === '(') {
      const end = substitutionEnd(src, i + 2);
      value += src.slice(i, end);
      i = end;
      continue;
    }
    value += c;
    i += 1;
  }
  return { value, next: i };
}

// Return the index just after the `)` that closes a `$(` whose body starts at i.
// Skips quoted text and heredoc bodies, because a commit message in a heredoc can
// hold unbalanced parentheses.
function substitutionEnd(src: string, start: number): number {
  let depth = 1;
  let i = start;
  const heredocs: Heredoc[] = [];
  while (i < src.length) {
    const c = src[i];
    if (c === '\\') {
      i += 2;
      continue;
    }
    if (c === "'") {
      const end = src.indexOf("'", i + 1);
      i = end === -1 ? src.length : end + 1;
      continue;
    }
    if (c === '"') {
      i += 1;
      while (i < src.length && src[i] !== '"') i += src[i] === '\\' ? 2 : 1;
      i += 1;
      continue;
    }
    if (c === '<' && src[i + 1] === '<' && src[i + 2] !== '<') {
      i += 2;
      const stripTabs = src[i] === '-';
      if (stripTabs) i += 1;
      while (src[i] === ' ' || src[i] === '\t') i += 1;
      const { value, next } = readWord(src, i);
      heredocs.push({ delimiter: value, stripTabs });
      i = next;
      continue;
    }
    if (c === '\n' && heredocs.length > 0) {
      i += 1;
      for (const doc of heredocs.splice(0)) {
        while (i < src.length) {
          const end = src.indexOf('\n', i);
          const rawLine = end === -1 ? src.slice(i) : src.slice(i, end);
          i = end === -1 ? src.length : end + 1;
          const line = doc.stripTabs ? rawLine.replace(/^\t+/u, '') : rawLine;
          if (line.trim() === doc.delimiter) break;
        }
      }
      continue;
    }
    if (c === '(') depth += 1;
    if (c === ')') {
      depth -= 1;
      if (depth === 0) return i + 1;
    }
    i += 1;
  }
  return src.length;
}

// Turn `$(cat <<'EOF' ... EOF)` into its heredoc body. Other text stays as it is.
function expandCatHeredocs(text: string): string {
  return text.replace(
    /\$\(\s*cat\s*<<-?\s*(['"]?)([A-Za-z_][\w-]*)\1[^\n]*\n([\s\S]*?)\n[ \t]*\2[ \t]*\n?\s*\)/gu,
    (_match: string, _quote: string, _delimiter: string, body: string) => body,
  );
}

// ---------- git commit detection ----------

const GIT_GLOBAL_WITH_VALUE = new Set([
  '-C',
  '-c',
  '--git-dir',
  '--work-tree',
  '--namespace',
  '--exec-path',
  '--config-env',
]);
const COMMIT_SHORT_WITH_VALUE = new Set(['m', 'F', 'c', 'C', 't']);
const COMMIT_SHORT_ATTACHED = new Set(['S', 'u']);
const COMMIT_LONG_WITH_VALUE = new Set([
  '--message',
  '--file',
  '--reuse-message',
  '--reedit-message',
  '--template',
  '--author',
  '--date',
  '--cleanup',
  '--fixup',
  '--squash',
  '--trailer',
  '--pathspec-from-file',
]);

// One `git commit` of a shell command: the folder where it runs, its arguments, and its stdin text.
interface Commit {
  readonly cwd: string;
  readonly args: ReadonlyArray<string>;
  readonly stdin: string | null;
}

// Find each `git commit` in the command.
function findCommits(command: string, baseCwd: string): Commit[] {
  const found: Commit[] = [];
  let cwd = baseCwd;
  for (const { words, stdin } of parseShell(command)) {
    let k = 0;
    while (k < words.length && /^[A-Za-z_][A-Za-z0-9_]*=/u.test(words[k])) k += 1;
    const head = words[k];
    if (head === 'cd' && words[k + 1]) {
      cwd = path.resolve(cwd, words[k + 1]);
      continue;
    }
    if (head !== 'git' && !(head ?? '').endsWith('/git')) continue;
    let gitCwd = cwd;
    let j = k + 1;
    while (j < words.length && words[j].startsWith('-')) {
      const option = words[j];
      if (option === '-C') gitCwd = path.resolve(gitCwd, words[j + 1] ?? '.');
      j += GIT_GLOBAL_WITH_VALUE.has(option) ? 2 : 1;
    }
    if (words[j] !== 'commit') continue;
    found.push({ cwd: gitCwd, args: words.slice(j + 1), stdin });
  }
  return found;
}

// The message options of one `git commit` call.
interface CommitOptions {
  readonly messages: string[];
  readonly files: string[];
  readonly trailers: string[];
  reuse: string | null;
  amend: boolean;
  dryRun: boolean;
}

// Read the options of one `git commit` call.
function parseCommitArgs(args: ReadonlyArray<string>): CommitOptions {
  const options: CommitOptions = { messages: [], files: [], trailers: [], reuse: null, amend: false, dryRun: false };
  const take = (name: string, value: string): void => {
    if (name === 'm' || name === '--message') options.messages.push(value);
    else if (name === 'F' || name === '--file') options.files.push(value);
    else if (name === '--trailer') options.trailers.push(value.replace(/^([^:=]+)=/u, '$1: '));
    else if (name === 'C' || name === 'c' || name === '--reuse-message' || name === '--reedit-message')
      options.reuse = value;
  };
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === '--') break;
    if (arg === '--amend') options.amend = true;
    else if (arg === '--dry-run') options.dryRun = true;
    else if (arg.startsWith('--')) {
      const eq = arg.indexOf('=');
      if (eq !== -1) take(arg.slice(0, eq), arg.slice(eq + 1));
      else if (COMMIT_LONG_WITH_VALUE.has(arg)) {
        take(arg, args[i + 1] ?? '');
        i += 1;
      }
    } else if (arg.startsWith('-') && arg.length > 1) {
      // A cluster such as `-am msg` or `-mmsg`.
      for (let p = 1; p < arg.length; p += 1) {
        const flag = arg[p];
        // `-S<keyid>` and `-u<mode>` take only an attached value: the rest is not flags.
        if (COMMIT_SHORT_ATTACHED.has(flag)) break;
        if (!COMMIT_SHORT_WITH_VALUE.has(flag)) continue;
        if (p + 1 < arg.length) take(flag, arg.slice(p + 1));
        else {
          take(flag, args[i + 1] ?? '');
          i += 1;
        }
        break;
      }
    }
  }
  return options;
}

// Run git in `cwd` with `input` on stdin, and resolve with its stdout. A non-zero exit,
// the timeout, the abort of `signal`, or a spawn failure rejects.
function git(cwd: string, args: ReadonlyArray<string>, signal: AbortSignal, input = ''): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = execFile(
      'git',
      args,
      { cwd, encoding: 'utf8', timeout: GIT_TIMEOUT_MS, signal },
      (error, stdout, stderr) => {
        if (error) reject(new Error(`git ${args.join(' ')} failed: ${String(stderr).trim() || error.message}`));
        else resolve(stdout);
      },
    );
    // execFile gives the child a stdin pipe, so `stdin` is null only if that changes.
    const { stdin } = child;
    if (stdin === null) throw new Error('git has no stdin pipe');
    // git can exit before it reads stdin. The callback above reports that failure; without this
    // listener the EPIPE error event would throw in the omp process.
    stdin.on('error', () => {});
    stdin.end(input);
  });
}

// Read one `-F` message source of the commit.
async function messageFile(commit: Commit, file: string, signal: AbortSignal): Promise<string> {
  if (STDIN_NAMES.has(file)) return commit.stdin ?? '';
  const full = path.resolve(commit.cwd, file);
  if (!(await fs.promises.stat(full)).isFile()) throw new Error(`${file} is not a regular file`);
  return fs.promises.readFile(full, { encoding: 'utf8', signal });
}

// Build the message that the commit records. Returns null when it has no source,
// which means git would open an editor.
async function commitMessage(commit: Commit, options: CommitOptions, signal: AbortSignal): Promise<string | null> {
  const parts = options.messages.map(expandCatHeredocs);
  for (const file of options.files) parts.push(await messageFile(commit, file, signal));
  let base: string | null = null;
  if (parts.length > 0) base = parts.join('\n\n');
  else if (options.reuse) base = await git(commit.cwd, ['log', '-1', '--format=%B', options.reuse, '--'], signal);
  else if (options.amend) base = await git(commit.cwd, ['log', '-1', '--format=%B'], signal);
  if (options.trailers.length === 0) return base;
  return `${base ?? ''}\n\n${options.trailers.join('\n')}\n`;
}

// True when the message ends with a valid `Verified:` git trailer.
async function hasVerifiedTrailer(message: string, cwd: string, signal: AbortSignal): Promise<boolean> {
  const trailers = await git(cwd, ['interpret-trailers', '--parse'], signal, message);
  return trailers.split('\n').some((line) => {
    const match = /^Verified:\s*(.*)$/iu.exec(line);
    if (!match) return false;
    const value = match[1].trim();
    if (value === '') return false;
    return /^none\b/iu.exec(value) ? /^none - \S/iu.exec(value) !== null : true;
  });
}

// Name the kinds of message source of one commit, for the log. `-C` stands for
// each reuse option (`-c`, `-C`, `--reuse-message`, `--reedit-message`).
function messageSources(options: CommitOptions): string[] {
  const sources: string[] = [];
  if (options.messages.length > 0) sources.push('-m');
  if (options.files.length > 0) sources.push('-F');
  if (options.reuse) sources.push('-C');
  if (options.amend) sources.push('--amend');
  if (options.trailers.length > 0) sources.push('--trailer');
  return sources.length > 0 ? sources : ['none'];
}

// ---------- state ----------

// The environment of the check, such as `process.env`. The check reads DOCKS_VERIFY_GATE and XDG_STATE_HOME.
type CheckEnv = Readonly<Record<string, string | undefined>>;

// One line of the log: metadata only.
interface LogEntry {
  readonly time: string;
  readonly session_id: string;
  readonly cwd: string;
  readonly mode: Mode;
  readonly message_sources: ReadonlyArray<string>;
  readonly allowed_after_denials?: number;
}

// True for a JSON object or array: a value whose fields the denial update reads and writes.
const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null;

// Start one write of state, unless the check passed its deadline: a check starts no state write after it.
function writeState<T>(signal: AbortSignal, write: () => Promise<T>): Promise<T> {
  signal.throwIfAborted();
  return write();
}

async function stateDir(env: CheckEnv, signal: AbortSignal): Promise<string> {
  const base = env.XDG_STATE_HOME || path.join(os.homedir(), '.local', 'state');
  const dir = path.join(base, 'docks');
  await writeState(signal, () => fs.promises.mkdir(dir, { recursive: true, mode: 0o700 }));
  return dir;
}

async function appendLog(env: CheckEnv, entry: LogEntry, signal: AbortSignal): Promise<void> {
  const file = path.join(await stateDir(env, signal), 'verify-gate.jsonl');
  await writeState(signal, () => fs.promises.appendFile(file, `${JSON.stringify(entry)}\n`, { mode: 0o600 }));
}

// The denial counts of the state file, by session id. A missing file or a file that is not valid
// JSON counts as empty. A file that is not a regular file throws, because a read of a FIFO can wait
// without end. A JSON value that is neither an object nor an array throws, because the update
// cannot record a count in it.
async function readDenials(file: string, signal: AbortSignal): Promise<Record<string, unknown>> {
  let stat;
  try {
    stat = await fs.promises.stat(file);
  } catch (error) {
    if (isRecord(error) && error.code === 'ENOENT') return {};
    throw error;
  }
  if (!stat.isFile()) throw new Error(`${file} is not a regular file`);
  const text = await fs.promises.readFile(file, { encoding: 'utf8', signal });
  let state: unknown;
  try {
    state = JSON.parse(text);
  } catch {
    return {};
  }
  if (!isRecord(state)) throw new Error(`${file} holds no JSON object`);
  return state;
}

// Record one denial for the session and return the count of earlier denials. After
// DENIALS_BEFORE_ALLOW denials the count starts again at zero. The new state goes to a temporary
// file first, and a rename puts it in place, so a reader never sees a part of a file. Each update
// has its own temporary file, so no other update writes into it. A write that started before the
// deadline can end after it; the update then removes its temporary file and changes no state.
async function updateDenials(env: CheckEnv, sessionId: string, signal: AbortSignal): Promise<number> {
  const file = path.join(await stateDir(env, signal), 'verify-gate-denials.json');
  const state = await readDenials(file, signal);
  const now = Date.now();
  // The file holds the entries `{ count, time }` that this core wrote. A time of another type reads
  // as a number, so an entry without a valid time never expires. A count of another type reads as a
  // number, and as 0 when that is no finite number, so each count that the update writes is finite.
  for (const [id, entry] of Object.entries(state)) {
    if (!entry || now - Number(isRecord(entry) ? entry.time : undefined) > SESSION_TTL_MS) delete state[id];
  }
  const stored = state[sessionId];
  const storedCount = Number(isRecord(stored) ? stored.count : 0);
  const previous = Number.isFinite(storedCount) ? storedCount : 0;
  state[sessionId] = previous >= DENIALS_BEFORE_ALLOW ? { count: 0, time: now } : { count: previous + 1, time: now };
  const temp = `${file}.${process.pid}.${crypto.randomUUID()}.tmp`;
  try {
    await writeState(signal, () => fs.promises.writeFile(temp, JSON.stringify(state), { mode: 0o600, flag: 'wx' }));
    await writeState(signal, () => fs.promises.rename(temp, file));
  } catch (error) {
    await fs.promises.unlink(temp).catch(() => {});
    throw error;
  }
  return previous;
}

// The end of the last queued denial update of this omp process. Each update starts only when the
// one before it settles, so two updates never overlap and two checks cannot both read the old
// count and lose a denial. An update whose check passed its deadline while it waited writes nothing.
let denialQueue: Promise<unknown> = Promise.resolve();

function countDenial(env: CheckEnv, sessionId: string, signal: AbortSignal): Promise<number> {
  const update = denialQueue.then(() => updateDenials(env, sessionId, signal));
  denialQueue = update.catch(() => {});
  return update;
}

// ---------- check ----------

const DENY_REASON =
  `verify-gate: the commit message has no Verified: trailer. ` +
  `Add a last paragraph with ${TRAILER_FORMAT}. ` +
  `Name the checks that you ran, or say why none ran.`;

// The input of one check.
interface CheckRequest {
  readonly command: string;
  readonly cwd: string;
  readonly sessionId: string;
  readonly env: CheckEnv;
  readonly deadlineMs?: number;
}

// Check one shell command before it runs. `cwd` is the folder where the command starts,
// `sessionId` keys the denial count, and `env` gives DOCKS_VERIFY_GATE and XDG_STATE_HOME.
// Returns the deny reason, or null to allow the command. It rejects when the check runs longer
// than `deadlineMs`; the abort then stops the git calls and the file reads of the check, so the
// check starts no state write after its deadline.
export async function checkCommand({
  command,
  cwd,
  sessionId,
  env,
  deadlineMs = CHECK_DEADLINE_MS,
}: CheckRequest): Promise<string | null> {
  const controller = new AbortController();
  const expired = new Promise<never>((_, reject) => {
    controller.signal.addEventListener('abort', () => reject(controller.signal.reason), { once: true });
  });
  const timer = setTimeout(() => controller.abort(new Error(`the check ran longer than ${deadlineMs} ms`)), deadlineMs);
  try {
    return await Promise.race([gateCommand({ command, cwd, sessionId, env }, controller.signal), expired]);
  } finally {
    clearTimeout(timer);
  }
}

async function gateCommand(
  { command, cwd, sessionId, env }: CheckRequest,
  signal: AbortSignal,
): Promise<string | null> {
  const rawMode = (env.DOCKS_VERIFY_GATE || 'observe').trim().toLowerCase();
  if (rawMode === 'off') return null;
  const mode: Mode = isMode(rawMode) ? rawMode : 'observe';

  // The message sources of the first commit without the trailer, or null when each commit has it.
  let unverifiedSources: string[] | null = null;
  for (const commit of findCommits(command, cwd)) {
    const options = parseCommitArgs(commit.args);
    if (options.dryRun) continue;
    const message = await commitMessage(commit, options, signal);
    if (message !== null && (await hasVerifiedTrailer(message, commit.cwd, signal))) continue;
    unverifiedSources = messageSources(options);
    break;
  }
  if (!unverifiedSources) return null;

  // Log metadata only. The command and the message can hold a secret, so no text of them goes to the log.
  const entry: LogEntry = {
    time: new Date().toISOString(),
    session_id: sessionId,
    cwd,
    mode,
    message_sources: unverifiedSources,
  };
  if (mode === 'observe') {
    await appendLog(env, entry, signal);
    return null;
  }
  const previous = await countDenial(env, sessionId, signal);
  if (previous >= DENIALS_BEFORE_ALLOW) {
    await appendLog(env, { ...entry, allowed_after_denials: previous }, signal);
    return null;
  }
  return DENY_REASON;
}
