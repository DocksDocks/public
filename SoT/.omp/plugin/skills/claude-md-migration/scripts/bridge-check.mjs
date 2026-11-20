#!/usr/bin/env node
// Audit the agent-doc layout before claude-md-migration writes (Step 2), and verify the
// migration after the writes (Step 6). Both commands read only; they write no file. The
// meaning of each line and the reaction to it live in the SKILL.md of claude-md-migration.
//
// Usage (from any folder inside the repository, or from the project folder outside git):
//   node bridge-check.mjs audit
//   node bridge-check.mjs verify [--expect <path>]...
//
// Output lines:
//   audit   four `EXISTS <entry>` or `MISSING <entry>` lines, in the order AGENTS.md,
//           CLAUDE.md (root), .claude/CLAUDE.md, CLAUDE.local.md; then the legacy entries of
//           the root .claude folder: `legacy external: <path> -> <link target>` for each of
//           .claude, .claude/skills, and .claude/agents that is a symlink to a place outside
//           the repository (no line for an entry below it), `legacy skills: .claude/skills`
//           when that folder exists, one `legacy agents: <path>` line for each
//           .claude/agents/*.md file, one `legacy settings: <path>` line for each of
//           .claude/settings.json and .claude/settings.local.json, and one
//           `legacy other: .claude/<name>` line for each other .claude entry; then one
//           `legacy: <path>` line for each CLAUDE.md and .claude/CLAUDE.md, root and nested
//           (the root ones also when git ignores them), or `legacy link: <path>` for one that
//           is a symlink to the AGENTS.md of its folder; one `personal: <path>` line for each
//           CLAUDE.local.md; and `plugin author: yes (.omp-plugin/marketplace.json)`,
//           `plugin author: yes (package.json omp object)`, or `plugin author: no`.
//   verify  `BROKEN: AGENTS.md missing`; `BROKEN: legacy CLAUDE.md still present: <path>`;
//           `BROKEN: <path> missing` for each --expect path that is no file;
//           `HANDOFF context-tree: unrouted node <path>`; `HANDOFF context-tree: dead route
//           <path>`; `VOLATILE time-relative|bare-count <file>:<line>` and
//           `VOLATILE line-anchor <file>:<line> (<path> exists)` for every AGENTS.md.
//           No output means the migration is complete. `HANDOFF` and `VOLATILE` lines are
//           report items, not failures. The .claude entries are no part of this check.
//   Either command prints `ERROR <part>: file listing failed (see the message above)` for a
//   listing that fails, and `ERROR <part>: cannot read <file>` for a file that is there but
//   cannot be read, in place of the lines of that part (`legacy entries:`, `legacy:`,
//   `personal:`, `plugin author:`, `routing:`, or `volatile:`). The cause is on stderr.
//   Paths are relative to the repository root, without a leading `./`. No listing enters
//   node_modules. The CLAUDE.local.md listing, and every listing outside git, walks the
//   folder and skips each .git, node_modules, vendor, dist, build, out, target, and .next
//   folder. The walk of CLAUDE.local.md keeps only regular files, as the Step 2 `find -type
//   f` does; the walk of CLAUDE.md also keeps each symlink that resolves to a file. A git
//   listing and the AGENTS.md node walk keep symlinks.
//
// Exit status: 2 after an ERROR line, 1 for a usage error, otherwise 0.
import fs from 'node:fs';
import process from 'node:process';
import { pathToFileURL } from 'node:url';
import {
  agentsDocs,
  BRIDGE_PRUNE,
  durableDocScan,
  EXCLUDE_NODE_MODULES,
  guarded,
  isAgentsLink,
  isFile,
  legacyClaudeLines,
  listFiles,
  ROOT_CONTEXT_FILES,
  ROOT_PERSONAL_FILES,
  readText,
  repositoryRoot,
  routingGaps,
  withRootFiles,
} from './agent-docs.mjs';

const USAGE = 'usage: bridge-check.mjs audit | verify [--expect <path>]...';
// The Step 2 entries in output order: the label is the path.
const AUDIT_FILES = ['AGENTS.md', 'CLAUDE.md', '.claude/CLAUDE.md', 'CLAUDE.local.md'];
const AUDIT_LABELS = { 'CLAUDE.md': 'CLAUDE.md (root)' };
const PLUGIN_CATALOG = '.omp-plugin/marketplace.json';
const PACKAGE_MANIFEST = 'package.json';

// The listing arguments of one repository: the root and whether git answers for it.
const listing = (repo) => ({ root: repo.root, prune: BRIDGE_PRUNE, inGit: repo.inGit });

// Every CLAUDE.md and .claude/CLAUDE.md, root and nested; gitignored build output is skipped,
// but the root ones count also when git ignores them, because omp loads them. The walk
// outside git keeps each regular file and each symlink that resolves to a file, so a nested
// legacy link is listed and a dangling one is not; the git listing keeps symlinks, as
// `git ls-files` did.
function legacyFiles(repo) {
  const pathspecs = [':(glob)**/CLAUDE.md', EXCLUDE_NODE_MODULES];
  const files = listFiles({ ...listing(repo), pathspecs, excludeStandard: true });
  return withRootFiles(repo.inGit ? files : files.filter(isFile), ROOT_CONTEXT_FILES);
}

// CLAUDE.local.md is usually gitignored, so the walk finds it also inside git.
function personalFiles(repo) {
  const pathspecs = [':(glob)**/CLAUDE.local.md'];
  const files = listFiles({ ...listing(repo), pathspecs, inGit: false, filesOnly: true });
  return withRootFiles(files, ROOT_PERSONAL_FILES);
}

// The plugin-author line: an omp plugin catalog, or a package.json with an `omp` object, makes
// the repository the source of an omp plugin. A package.json that does not parse has no
// `omp` object.
function pluginAuthorLine() {
  if (isFile(PLUGIN_CATALOG)) return `plugin author: yes (${PLUGIN_CATALOG})`;
  const text = readText(PACKAGE_MANIFEST);
  let manifest = null;
  try {
    manifest = text === null ? null : JSON.parse(text);
  } catch {
    manifest = null;
  }
  const omp = manifest?.omp;
  const hasOmpObject = omp !== null && typeof omp === 'object' && !Array.isArray(omp);
  return hasOmpObject ? `plugin author: yes (${PACKAGE_MANIFEST} omp object)` : 'plugin author: no';
}

// The root .claude entries are only reported; agent-first-setup cleans them up.
function auditLines(repo) {
  return [
    ...AUDIT_FILES.map((file) => `${isFile(file) ? 'EXISTS' : 'MISSING'} ${AUDIT_LABELS[file] ?? file}`),
    ...guarded('legacy entries:', legacyClaudeLines),
    ...guarded('legacy:', () =>
      legacyFiles(repo).map((file) => (isAgentsLink(file) ? `legacy link: ${file}` : `legacy: ${file}`)),
    ),
    ...guarded('personal:', () => personalFiles(repo).map((file) => `personal: ${file}`)),
    ...guarded('plugin author:', () => [pluginAuthorLine()]),
  ];
}

// The root routing belongs to context-tree; this skill only reports it.
function routingLines(repo) {
  const { unroutedNodes, deadRoutes } = routingGaps(listing(repo));
  return [
    ...unroutedNodes.map((node) => `HANDOFF context-tree: unrouted node ${node}`),
    ...deadRoutes.map((route) => `HANDOFF context-tree: dead route ${route}`),
  ];
}

function verifyLines(repo, expectedFiles) {
  return [
    ...(isFile('AGENTS.md') ? [] : ['BROKEN: AGENTS.md missing']),
    ...guarded('legacy:', () => legacyFiles(repo).map((file) => `BROKEN: legacy CLAUDE.md still present: ${file}`)),
    ...expectedFiles.filter((file) => !isFile(file)).map((file) => `BROKEN: ${file} missing`),
    ...guarded('routing:', () => routingLines(repo)),
    ...guarded('volatile:', () =>
      durableDocScan(agentsDocs(listing(repo)), { findingLabel: 'VOLATILE', errorLabel: 'volatile:' }),
    ),
  ];
}

// The paths of `--expect <path>` pairs, or null when an argument is no such pair.
function parseExpectedFiles(args) {
  const files = [];
  for (let i = 0; i < args.length; i += 2) {
    if (args[i] !== '--expect' || !args[i + 1]) return null;
    files.push(args[i + 1]);
  }
  return files;
}

// { command, expectedFiles }, or null for a usage error.
function parseArguments(args) {
  const [command, ...rest] = args;
  if (command === 'audit' && rest.length === 0) return { command, expectedFiles: [] };
  const expectedFiles = command === 'verify' ? parseExpectedFiles(rest) : null;
  return expectedFiles === null ? null : { command, expectedFiles };
}

function main(args) {
  const parsed = parseArguments(args);
  if (parsed === null) {
    process.stderr.write(`${USAGE}\n`);
    return 1;
  }
  const gitRoot = repositoryRoot();
  const repo = { root: gitRoot ?? process.cwd(), inGit: gitRoot !== null };
  // Every check reads paths relative to the root, as the skill runs its blocks from there.
  process.chdir(repo.root);
  const lines = parsed.command === 'audit' ? auditLines(repo) : verifyLines(repo, parsed.expectedFiles);
  if (lines.length > 0) process.stdout.write(`${lines.join('\n')}\n`);
  return lines.some((line) => line.startsWith('ERROR')) ? 2 : 0;
}

// Run the CLI only when node started this file (through any symlink), not on import.
if (process.argv[1] && import.meta.url === pathToFileURL(fs.realpathSync(process.argv[1])).href) {
  process.exitCode = main(process.argv.slice(2));
}
