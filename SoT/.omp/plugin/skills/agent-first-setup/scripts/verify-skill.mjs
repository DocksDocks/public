#!/usr/bin/env node
// Check the project `verify` skill and guard each write that creates it. The skill lives
// at `.agents/skills/verify/SKILL.md`. The steps and the meaning of each line live in
// references/verify-skill-template.md.
//
// Usage (from the repository root):
//   node verify-skill.mjs detect
//   node verify-skill.mjs write-gate <path>...
//   node verify-skill.mjs entry-gate
//
// Output lines:
//   detect      `verify skill: present` or `verify skill: missing`; one
//               `verify unverified: <n>:<line>` line for each line of the skill that holds
//               `not observed:`; `ERROR verify skill check failed: cannot read <file>` when
//               the skill cannot be read.
//   write-gate  one `target occupied: <path> ...` line for each path that must not be
//               written: a symlink, a path that holds a `..` segment, or a path whose nearest
//               existing folder cannot be entered or resolves outside the current folder.
//               Nothing for a writable path.
//   entry-gate  `target occupied: .agents/skills/verify exists` when an entry is there, a
//               dangling symlink included.
//
// Exit status: 2 after an ERROR line, 1 for a usage error, otherwise 0. `target occupied`
// lines do not change the status.
//
// Export: verifySkillLines() returns the detect lines as { ok, lines }.
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { pathToFileURL } from 'node:url';

const USAGE = 'usage: verify-skill.mjs detect | write-gate <path>... | entry-gate';
const SKILL_DIR = '.agents/skills/verify';
const SKILL_FILE = `${SKILL_DIR}/SKILL.md`;
const UNVERIFIED_MARK = 'not observed:';

// fs.statSync follows symlinks, as `test -f` does; a failed stat means no entry.
function statOrNull(file) {
  try {
    return fs.statSync(file, { bigint: true });
  } catch {
    return null;
  }
}

// True when an entry is at `file`, a dangling symlink included (`test -e || test -L`).
function entryExists(file) {
  try {
    fs.lstatSync(file);
    return true;
  } catch {
    return false;
  }
}

// `test -L`: a failed lstat, for example below a file, means no symlink.
function isSymlink(file) {
  try {
    return fs.lstatSync(file).isSymbolicLink();
  } catch {
    return false;
  }
}

// The detect lines for the current folder. On { ok: false }, `lines` still holds every
// line, the ERROR line included, and the cause is on stderr.
export function verifySkillLines() {
  const lines = [];
  let ok = true;
  if (statOrNull(SKILL_FILE)?.isFile()) {
    lines.push('verify skill: present');
    try {
      const text = fs.readFileSync(SKILL_FILE, 'utf8');
      // `grep -n` numbers lines from 1 and ends the last line at the end of the file.
      text
        .replace(/\n$/u, '')
        .split('\n')
        .forEach((line, index) => {
          if (line.includes(UNVERIFIED_MARK)) lines.push(`verify unverified: ${index + 1}:${line}`);
        });
    } catch (error) {
      process.stderr.write(
        `verify-skill: cannot read ${SKILL_FILE} (${error.code ?? error.message}); make it readable and run detect again\n`,
      );
      lines.push(`ERROR verify skill check failed: cannot read ${SKILL_FILE}`);
      ok = false;
    }
  } else {
    lines.push('verify skill: missing');
  }
  return { ok, lines };
}

// The folder that `cd` would enter for `target`: its nearest existing ancestor folder.
function nearestFolder(target) {
  let folder = path.dirname(target);
  while (!statOrNull(folder)?.isDirectory()) {
    const parent = path.dirname(folder);
    if (parent === folder) break;
    folder = parent;
  }
  return folder;
}

// The refusal for one path that a step wants to write, or null when the write may go on.
// A write must never go through a symlink or land outside the repository.
function refusal(root, target) {
  if (isSymlink(target)) {
    return `target occupied: ${target} is a symlink`;
  }
  // The kernel resolves `link/..` to the parent of the link target, while path.dirname and
  // the nearest-folder search remove `..` as text. No path with `..` passes, so both agree.
  if (target.split('/').includes('..')) return `target occupied: ${target} holds a .. segment`;
  let resolved;
  try {
    const folder = nearestFolder(target);
    // `cd` needs search permission on the folder; realpath alone does not check it.
    fs.accessSync(folder, fs.constants.X_OK);
    // The native realpath resolves each part as the kernel does; the JavaScript one removes
    // `..` as text before it follows a symlink.
    resolved = fs.realpathSync.native(folder);
  } catch {
    return `target occupied: cannot resolve the folder of ${target}`;
  }
  if (!`${resolved}/`.startsWith(`${root}/`)) return `target occupied: ${target} resolves outside the repository`;
  return null;
}

function writeGateLines(targets) {
  // process.cwd() is the physical path, as `pwd -P` prints it.
  const root = process.cwd();
  return targets.map((target) => refusal(root, target)).filter((line) => line !== null);
}

function entryGateLines() {
  return entryExists(SKILL_DIR) ? [`target occupied: ${SKILL_DIR} exists`] : [];
}

function main(args) {
  const [command, ...rest] = args;
  let result;
  if (command === 'detect' && rest.length === 0) result = verifySkillLines();
  else if (command === 'write-gate' && rest.length > 0) result = { ok: true, lines: writeGateLines(rest) };
  else if (command === 'entry-gate' && rest.length === 0) result = { ok: true, lines: entryGateLines() };
  else {
    process.stderr.write(`${USAGE}\n`);
    return 1;
  }
  if (result.lines.length > 0) process.stdout.write(`${result.lines.join('\n')}\n`);
  return result.ok ? 0 : 2;
}

// Run the CLI only when node started this file (through any symlink), not on import.
if (process.argv[1] && import.meta.url === pathToFileURL(fs.realpathSync(process.argv[1])).href) {
  process.exitCode = main(process.argv.slice(2));
}
