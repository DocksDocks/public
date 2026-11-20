#!/usr/bin/env node
// Find the pull-request templates that GitHub reads, and gate the write of a new
// `.github/pull_request_template.md`. GitHub reads a template from the root, from
// `docs/`, or from `.github/`: a file named `pull_request_template`,
// `pull_request_template.md`, or `pull_request_template.txt` in any letter case, or a
// `PULL_REQUEST_TEMPLATE` folder that holds a `.md` or `.txt` file. The rules and the
// meaning of each line live in references/pull-request-template.md.
//
// Usage (from any folder inside the repository):
//   node pr-template.mjs detect
//   node pr-template.mjs gate
//
// Output lines:
//   detect  one `pull-request template: <path> (<kind>)` line for each usable entry,
//           one `pull-request template: unusable <path> (<reason>)` line for each
//           unusable entry, and `pull-request template: none` when no entry is usable.
//           Folders in the order `.`, `docs`, `.github`; inside a folder, by byte order
//           of the name. Paths are relative to the repository root.
//   gate    exactly one of `target occupied: write nothing`, `target free`, or
//           `no write: a usable template exists, or .github is a symlink`.
//   Either command prints `ERROR pull-request template check failed (see the message
//   above)` when the check cannot finish, for example outside a git repository; the
//   cause is on stderr.
//
// Exit status: 2 after an ERROR line, 1 for a usage error, otherwise 0.
//
// Export: prTemplateLines(root) returns the detect lines as { ok, lines }.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { pathToFileURL } from 'node:url';

const USAGE = 'usage: pr-template.mjs detect | gate';
const ERROR_LINE = 'ERROR pull-request template check failed (see the message above)';
const NONE_LINE = 'pull-request template: none';
const TEMPLATE_FOLDERS = ['.', 'docs', '.github'];
const TEMPLATE_NAMES = new Set(['pull_request_template', 'pull_request_template.md', 'pull_request_template.txt']);
// Only this name makes a folder a template folder; a folder with a file name is unusable.
const FOLDER_NAME = 'pull_request_template';
// Any entry with a supported name occupies the target, also an unusable one.
const TARGET_OCCUPIED = /^pull-request template: (unusable )?\.github\/pull_request_template\.md \(/iu;

// The repository root that `git rev-parse --show-toplevel` prints for `cwd`, or null
// when git fails; git's own message then is on stderr.
function gitRoot(cwd) {
  const result = spawnSync('git', ['rev-parse', '--show-toplevel'], { cwd, encoding: 'utf8' });
  if (result.error) {
    process.stderr.write(`pr-template: cannot run git rev-parse (${result.error.message}); install git and retry\n`);
    return null;
  }
  process.stderr.write(result.stderr);
  return result.status === 0 ? result.stdout.replace(/\n+$/u, '') : null;
}

// fs.statSync follows symlinks, as `test -f` and `test -d` do; a failed stat means no file.
function statOrNull(file) {
  try {
    return fs.statSync(file);
  } catch {
    return null;
  }
}

function isSymlink(file) {
  try {
    return fs.lstatSync(file).isSymbolicLink();
  } catch {
    return false;
  }
}

// The entries of a folder, or null after a message on stderr: an unreadable folder
// leaves the answer open, so the caller must not report "none".
function readFolder(folder, shown) {
  try {
    return fs.readdirSync(folder, { withFileTypes: true });
  } catch (error) {
    process.stderr.write(
      `pr-template: cannot list the folder ${shown} (${error.code ?? error.message}); make it readable and run the check again\n`,
    );
    return null;
  }
}

// A template folder is usable when it holds a regular `.md` or `.txt` file itself;
// a symlink inside the folder does not count. Returns null when the folder cannot be read.
function holdsTemplateFile(folder, shown) {
  const entries = readFolder(folder, shown);
  if (entries === null) return null;
  return entries.some((entry) => entry.isFile() && /\.(md|txt)$/iu.test(entry.name));
}

// Classify one entry with a supported name. Returns { usable, line }, or null when a
// folder inside it cannot be read.
function classify(root, shown, name) {
  const file = path.join(root, shown);
  const via = isSymlink(file) ? 'symlink to ' : '';
  const stat = statOrNull(file);
  if (stat?.isFile()) return { usable: true, line: `pull-request template: ${shown} (${via}file)` };
  if (stat?.isDirectory() && name.toLowerCase() === FOLDER_NAME) {
    const holds = holdsTemplateFile(file, `${shown}/`);
    if (holds === null) return null;
    return holds
      ? { usable: true, line: `pull-request template: ${shown} (${via}folder)` }
      : { usable: false, line: `pull-request template: unusable ${shown} (${via}folder without a .md or .txt file)` };
  }
  if (stat?.isDirectory()) {
    return { usable: false, line: `pull-request template: unusable ${shown} (${via}folder with a file name)` };
  }
  if (via) return { usable: false, line: `pull-request template: unusable ${shown} (broken symlink)` };
  return { usable: false, line: `pull-request template: unusable ${shown} (not a regular file)` };
}

// The detect lines for the repository at `root` (absolute), or at the git root of the
// current folder when `root` is null. On { ok: false }, `lines` holds the lines found
// before the failure, and the cause is on stderr.
export function prTemplateLines(root) {
  const top = root ?? gitRoot(process.cwd());
  if (top === null) return { ok: false, lines: [] };
  const lines = [];
  let usable = false;
  for (const dir of TEMPLATE_FOLDERS) {
    const folder = path.join(top, dir);
    if (!statOrNull(folder)?.isDirectory()) continue;
    // `find <dir>` does not descend into a starting point that is a symlink, so a
    // linked `docs` or `.github` lists no entry.
    if (isSymlink(folder)) continue;
    const entries = readFolder(folder, dir);
    if (entries === null) return { ok: false, lines };
    // The supported names are ASCII, so the default sort is byte order.
    const names = entries
      .map((entry) => entry.name)
      .filter((name) => TEMPLATE_NAMES.has(name.toLowerCase()))
      .sort();
    for (const name of names) {
      const entry = classify(top, `${dir}/${name}`, name);
      if (entry === null) return { ok: false, lines };
      usable ||= entry.usable;
      lines.push(entry.line);
    }
  }
  if (!usable) lines.push(NONE_LINE);
  return { ok: true, lines };
}

// The write gate for `.github/pull_request_template.md`: one line from the detect lines.
function gateLine(top, lines) {
  if (lines.some((line) => TARGET_OCCUPIED.test(line))) return 'target occupied: write nothing';
  if (lines.at(-1) === NONE_LINE && !isSymlink(path.join(top, '.github'))) return 'target free';
  return 'no write: a usable template exists, or .github is a symlink';
}

function main(args) {
  const [command, ...rest] = args;
  if (!['detect', 'gate'].includes(command) || rest.length > 0) {
    process.stderr.write(`${USAGE}\n`);
    return 1;
  }
  const top = gitRoot(process.cwd());
  const result = top === null ? { ok: false, lines: [] } : prTemplateLines(top);
  if (!result.ok) {
    // The shell wrapper dropped the lines found before the failure; print only the ERROR line.
    process.stdout.write(`${ERROR_LINE}\n`);
    return 2;
  }
  const out = command === 'detect' ? result.lines : [gateLine(top, result.lines)];
  process.stdout.write(`${out.join('\n')}\n`);
  return 0;
}

// Run the CLI only when node started this file (through any symlink), not on import.
if (process.argv[1] && import.meta.url === pathToFileURL(fs.realpathSync(process.argv[1])).href) {
  process.exitCode = main(process.argv.slice(2));
}
