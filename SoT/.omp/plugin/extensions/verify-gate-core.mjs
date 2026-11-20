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

const MODES = new Set(['off', 'observe', 'enforce']);
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

// Split a shell command into simple commands. Each command is { words, stdin }.
// Words keep quotes removed; `$(...)` stays as raw text. `stdin` holds
// the body of a heredoc or a here-string on that command, when one exists.
function parseShell(src) {
  const commands = [];
  let words = [];
  let word = null;
  let stdin = null;
  const pendingHeredocs = [];
  let i = 0;

  const pushWord = () => {
    if (word !== null) words.push(word);
    word = null;
  };
  const endCommand = () => {
    pushWord();
    if (words.length > 0) commands.push({ words, stdin });
    words = [];
    stdin = null;
  };
  const readHeredocBodies = () => {
    // i points just after a newline.
    for (const doc of pendingHeredocs.splice(0)) {
      const lines = [];
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
  for (const command of commands) {
    if (command.stdin && typeof command.stdin === 'object') command.stdin = command.stdin.stdin;
  }
  return commands;
}

// Read one word starting at i. Stops at an unquoted space, operator, or newline.
function readWord(src, start) {
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
function substitutionEnd(src, start) {
  let depth = 1;
  let i = start;
  const heredocs = [];
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
function expandCatHeredocs(text) {
  return text.replace(
    /\$\(\s*cat\s*<<-?\s*(['"]?)([A-Za-z_][\w-]*)\1[^\n]*\n([\s\S]*?)\n[ \t]*\2[ \t]*\n?\s*\)/gu,
    (_match, _quote, _delimiter, body) => body,
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

// Find each `git commit` in the command. Returns [{ cwd, args, stdin }].
function findCommits(command, baseCwd) {
  const found = [];
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

// Read the options of one `git commit` call.
function parseCommitArgs(args) {
  const options = { messages: [], files: [], trailers: [], reuse: null, amend: false, dryRun: false };
  const take = (name, value) => {
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
function git(cwd, args, signal, input = '') {
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
    // git can exit before it reads stdin. The callback above reports that failure; without this
    // listener the EPIPE error event would throw in the omp process.
    child.stdin.on('error', () => {});
    child.stdin.end(input);
  });
}

// Read one `-F` message source of the commit.
async function messageFile(commit, file, signal) {
  if (STDIN_NAMES.has(file)) return commit.stdin ?? '';
  const full = path.resolve(commit.cwd, file);
  if (!(await fs.promises.stat(full)).isFile()) throw new Error(`${file} is not a regular file`);
  return fs.promises.readFile(full, { encoding: 'utf8', signal });
}

// Build the message that the commit records. Returns null when it has no source,
// which means git would open an editor.
async function commitMessage(commit, options, signal) {
  const parts = options.messages.map(expandCatHeredocs);
  for (const file of options.files) parts.push(await messageFile(commit, file, signal));
  let base = null;
  if (parts.length > 0) base = parts.join('\n\n');
  else if (options.reuse) base = await git(commit.cwd, ['log', '-1', '--format=%B', options.reuse, '--'], signal);
  else if (options.amend) base = await git(commit.cwd, ['log', '-1', '--format=%B'], signal);
  if (options.trailers.length === 0) return base;
  return `${base ?? ''}\n\n${options.trailers.join('\n')}\n`;
}

// True when the message ends with a valid `Verified:` git trailer.
async function hasVerifiedTrailer(message, cwd, signal) {
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
function messageSources(options) {
  const sources = [];
  if (options.messages.length > 0) sources.push('-m');
  if (options.files.length > 0) sources.push('-F');
  if (options.reuse) sources.push('-C');
  if (options.amend) sources.push('--amend');
  if (options.trailers.length > 0) sources.push('--trailer');
  return sources.length > 0 ? sources : ['none'];
}

// ---------- state ----------

// Start one write of state, unless the check passed its deadline: a check starts no state write after it.
function writeState(signal, write) {
  signal.throwIfAborted();
  return write();
}

async function stateDir(env, signal) {
  const base = env.XDG_STATE_HOME || path.join(os.homedir(), '.local', 'state');
  const dir = path.join(base, 'docks');
  await writeState(signal, () => fs.promises.mkdir(dir, { recursive: true, mode: 0o700 }));
  return dir;
}

async function appendLog(env, entry, signal) {
  const file = path.join(await stateDir(env, signal), 'verify-gate.jsonl');
  await writeState(signal, () => fs.promises.appendFile(file, `${JSON.stringify(entry)}\n`, { mode: 0o600 }));
}

// The denial counts of the state file. A missing file or a file that is not valid JSON counts
// as empty. A file that is not a regular file throws, because a read of a FIFO can wait without end.
async function readDenials(file, signal) {
  let stat;
  try {
    stat = await fs.promises.stat(file);
  } catch (error) {
    if (error?.code === 'ENOENT') return {};
    throw error;
  }
  if (!stat.isFile()) throw new Error(`${file} is not a regular file`);
  const text = await fs.promises.readFile(file, { encoding: 'utf8', signal });
  try {
    return JSON.parse(text);
  } catch {
    return {};
  }
}

// Record one denial for the session and return the count of earlier denials. After
// DENIALS_BEFORE_ALLOW denials the count starts again at zero. The new state goes to a temporary
// file first, and a rename puts it in place, so a reader never sees a part of a file. Each update
// has its own temporary file, so no other update writes into it. A write that started before the
// deadline can end after it; the update then removes its temporary file and changes no state.
async function updateDenials(env, sessionId, signal) {
  const file = path.join(await stateDir(env, signal), 'verify-gate-denials.json');
  const state = await readDenials(file, signal);
  const now = Date.now();
  for (const [id, entry] of Object.entries(state)) {
    if (!entry || now - entry.time > SESSION_TTL_MS) delete state[id];
  }
  const previous = state[sessionId]?.count ?? 0;
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
let denialQueue = Promise.resolve();

function countDenial(env, sessionId, signal) {
  const update = denialQueue.then(() => updateDenials(env, sessionId, signal));
  denialQueue = update.catch(() => {});
  return update;
}

// ---------- check ----------

const DENY_REASON =
  `verify-gate: the commit message has no Verified: trailer. ` +
  `Add a last paragraph with ${TRAILER_FORMAT}. ` +
  `Name the checks that you ran, or say why none ran.`;

// Check one shell command before it runs. `cwd` is the folder where the command starts,
// `sessionId` keys the denial count, and `env` gives DOCKS_VERIFY_GATE and XDG_STATE_HOME.
// Returns the deny reason, or null to allow the command. It rejects when the check runs longer
// than `deadlineMs`; the abort then stops the git calls and the file reads of the check, so the
// check starts no state write after its deadline.
export async function checkCommand({ command, cwd, sessionId, env, deadlineMs = CHECK_DEADLINE_MS }) {
  const controller = new AbortController();
  const expired = new Promise((_, reject) => {
    controller.signal.addEventListener('abort', () => reject(controller.signal.reason), { once: true });
  });
  const timer = setTimeout(() => controller.abort(new Error(`the check ran longer than ${deadlineMs} ms`)), deadlineMs);
  try {
    return await Promise.race([gateCommand({ command, cwd, sessionId, env }, controller.signal), expired]);
  } finally {
    clearTimeout(timer);
  }
}

async function gateCommand({ command, cwd, sessionId, env }, signal) {
  const rawMode = (env.DOCKS_VERIFY_GATE || 'observe').trim().toLowerCase();
  if (rawMode === 'off') return null;
  const mode = MODES.has(rawMode) ? rawMode : 'observe';

  // The message sources of the first commit without the trailer, or null when each commit has it.
  let unverifiedSources = null;
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
  const entry = {
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
