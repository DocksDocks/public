// Shared parts of the agent-doc checks of agent-first-setup (agent-first-check.mjs) and
// claude-md-migration (bridge-check.mjs): the repository root, the file listing, the legacy
// `.claude/` entries, the routing rows of the root AGENTS.md, the nested AGENTS.md nodes, and
// the durable-doc scan. The canonical file is in agent-first-setup; claude-md-migration ships
// a byte-identical copy, because a skill folder cannot import from another skill folder.
//
// Each function ports one part of a shell block that the two skills ran before. A port keeps
// the semantics of that block: git pathspecs, POSIX `[[:space:]]`, the leftmost-longest
// matches of awk, and byte order where the block sorted with `sort` or a glob.
//
// This module has no CLI. A listing or a read that cannot finish throws CheckError after it
// writes the cause to stderr; `guarded` turns that error into the ERROR line of the caller.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

// The folder names that each skill skips when it walks a folder outside git.
export const AGENT_FIRST_PRUNE = ['.git', 'node_modules', 'vendor'];
export const BRIDGE_PRUNE = ['.git', 'node_modules', 'vendor', 'dist', 'build', 'out', 'target', '.next'];

// POSIX `[[:space:]]` in the C locale; JS `\s` would also match Unicode spaces.
export const SPACE = ' \\t\\n\\v\\f\\r';
const ROOT_AGENTS = 'AGENTS.md';
// A package under node_modules is not part of this repository.
export const EXCLUDE_NODE_MODULES = ':(exclude,glob)**/node_modules/**';
// Room for the listing of a very large repository; the default of 1 MiB would cut it off.
const LISTING_BUFFER = 256 * 1024 * 1024;
const LISTING_FAILED = 'file listing failed (see the message above)';
// The errno codes that mean "no file is there", as `test -f` sees it. Any other code means
// that an entry is there, but the check cannot read it.
const MISSING_CODES = new Set(['ENOENT', 'ENOTDIR']);
const FENCE = new RegExp(`^[${SPACE}]*\`\`\``, 'u');
export const CODE_SPAN = /`[^`]*`/gu;

// awk's tolower and grep -i in the C locale change only ASCII letters; String#toLowerCase
// alone would also fold letters such as the Kelvin sign into `k`.
export const asciiLower = (text) => text.replace(/[A-Z]+/gu, (letters) => letters.toLowerCase());

// A check that cannot finish. Its cause is already on stderr; `message` completes the ERROR
// line of the caller, for example `cannot read docs/AGENTS.md`.
export class CheckError extends Error {}

// The lines of one check, or one `ERROR <label> <message>` line in their place when the check
// throws CheckError. A failed check is never a pass, so it must not print a partial result.
export function guarded(label, lines) {
  try {
    return lines();
  } catch (error) {
    if (!(error instanceof CheckError)) throw error;
    return [`ERROR ${label} ${error.message}`];
  }
}

function listingError(folder, error) {
  process.stderr.write(
    `agent-docs: cannot list the folder ${folder} (${error.code ?? error.message}); make it readable and run the check again\n`,
  );
  return new CheckError(LISTING_FAILED);
}

// `sort` and shell globs in the C locale compare bytes; String#localeCompare and the
// default sort compare UTF-16 code units, which differ above the Basic Multilingual Plane.
export function byteOrder(a, b) {
  return Buffer.compare(Buffer.from(a), Buffer.from(b));
}

// fs.statSync follows symlinks, as `test -e`, `test -f`, and `test -d` do.
function statOrNull(file) {
  try {
    return fs.statSync(file);
  } catch {
    return null;
  }
}

export function isFile(file) {
  return statOrNull(file)?.isFile() ?? false;
}

export function isFolder(file) {
  return statOrNull(file)?.isDirectory() ?? false;
}

// `test -L`: a failed lstat, for example below a file, means no symlink.
export function isSymlink(file) {
  try {
    return fs.lstatSync(file).isSymbolicLink();
  } catch {
    return false;
  }
}

// The entries of `folder`, through a symlink too, as a glob sees them; none when no folder is
// there. A folder that is there but cannot be listed throws CheckError.
export function readFolder(folder) {
  try {
    return fs.readdirSync(folder, { withFileTypes: true });
  } catch (error) {
    if (MISSING_CODES.has(error.code)) return [];
    throw listingError(folder, error);
  }
}

// The entries of `folder` as `find <folder> -mindepth 1 -maxdepth 1` lists them, dot names
// included, sorted by byte order of the name. None when `folder` is a symlink, because find
// does not follow a symlink given as its starting point.
export function findEntries(folder) {
  if (isSymlink(folder)) return [];
  return readFolder(folder).sort((a, b) => byteOrder(a.name, b.name));
}

const CLAUDE_FOLDER = '.claude';
const CLAUDE_SKILLS = '.claude/skills';
const CLAUDE_AGENTS = '.claude/agents';
const CLAUDE_SETTINGS = ['.claude/settings.json', '.claude/settings.local.json'];
// The `.claude/` entries that have their own line; each other entry is a `legacy other:` entry.
const CLAUDE_OWN_LINES = new Set(['CLAUDE.md', 'skills', 'agents', 'settings.json', 'settings.local.json']);

// True when the absolute path `inner` is `outer` or below it.
function isWithin(outer, inner) {
  const relative = path.relative(outer, inner);
  return relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

// The link target of `file` as read, when `file` is a symlink whose real path is outside the
// current folder (the repository root); else null. A dangling link resolves its target from
// the real folder of the link. A link that cannot be read throws CheckError.
function externalTarget(file) {
  if (!isSymlink(file)) return null;
  try {
    const target = fs.readlinkSync(file);
    const real =
      statOrNull(file) === null ? path.resolve(fs.realpathSync(path.dirname(file)), target) : fs.realpathSync(file);
    return isWithin(fs.realpathSync('.'), real) ? null : target;
  } catch (error) {
    throw listingError(file, error);
  }
}

// True when the `.claude/skills` folder of the root is no link to a place outside the
// repository, and no `.claude` link above it is either. The checks then may list its entries.
export function claudeSkillsInRepository() {
  return externalTarget(CLAUDE_FOLDER) === null && externalTarget(CLAUDE_SKILLS) === null;
}

// The legacy Claude Code entries of the `.claude/` folder in the current folder (the
// repository root): `external`, each of `.claude`, `.claude/skills`, and `.claude/agents` that
// is a symlink to a place outside the repository, as { path, target }, with no entry below it;
// the skills folder; each agent file that `.claude/agents/*.md` expands to (no dot names, in
// byte order); each settings file; and `others`, each other entry of `.claude/` (dot names
// too, in byte order). Throws CheckError when `.claude` or `.claude/agents` is there but
// cannot be listed.
export function legacyClaudeEntries() {
  const external = [];
  const outside = (folder) => {
    const target = externalTarget(folder);
    if (target !== null) external.push({ path: folder, target });
    return target !== null;
  };
  if (outside(CLAUDE_FOLDER)) return { external, skills: null, agents: [], settings: [], others: [] };
  const skillsOutside = outside(CLAUDE_SKILLS);
  const agentsOutside = outside(CLAUDE_AGENTS);
  const others = readFolder(CLAUDE_FOLDER)
    .map((entry) => entry.name)
    .filter((name) => !CLAUDE_OWN_LINES.has(name))
    .sort(byteOrder)
    .map((name) => `${CLAUDE_FOLDER}/${name}`);
  const agents = agentsOutside
    ? []
    : readFolder(CLAUDE_AGENTS)
        .map((entry) => entry.name)
        .filter((name) => !name.startsWith('.') && name.endsWith('.md'))
        .sort(byteOrder)
        .map((name) => `${CLAUDE_AGENTS}/${name}`)
        .filter(isFile);
  return {
    external,
    skills: !skillsOutside && isFolder(CLAUDE_SKILLS) ? CLAUDE_SKILLS : null,
    agents,
    settings: CLAUDE_SETTINGS.filter(isFile),
    others,
  };
}

// The `legacy external:`, `legacy skills:`, `legacy agents:`, `legacy settings:`, and
// `legacy other:` lines of legacyClaudeEntries.
export function legacyClaudeLines() {
  const { external, skills, agents, settings, others } = legacyClaudeEntries();
  return [
    ...external.map((link) => `legacy external: ${link.path} -> ${link.target}`),
    ...(skills === null ? [] : [`legacy skills: ${skills}`]),
    ...agents.map((agent) => `legacy agents: ${agent}`),
    ...settings.map((file) => `legacy settings: ${file}`),
    ...others.map((entry) => `legacy other: ${entry}`),
  ];
}

// The root context files that omp can load, and the root personal file.
export const ROOT_CONTEXT_FILES = ['CLAUDE.md', '.claude/CLAUDE.md'];
export const ROOT_PERSONAL_FILES = ['CLAUDE.local.md'];

// `files` and each of the root files `names` that is a file (a symlink to a file too), unique
// and in byte order. A git listing skips an ignored file, but omp still loads an ignored
// CLAUDE.md or .claude/CLAUDE.md. A `.claude` link to a place outside the repository adds no
// file. A `.claude` link that cannot be read throws CheckError.
export function withRootFiles(files, names) {
  const claudeOutside = externalTarget(CLAUDE_FOLDER) !== null;
  const found = names.filter((name) => isFile(name) && !(claudeOutside && name.startsWith(`${CLAUDE_FOLDER}/`)));
  return [...new Set([...files, ...found])].sort(byteOrder);
}

// The most symlinks that one chain follows; Linux stops after 40 too, so a longer chain or a
// loop resolves to no file.
const MAX_LINK_HOPS = 40;

// `file` as an absolute path with the real path of its folder, so that two paths to one entry
// through folder symlinks compare equal; the last part stays as is, because it may be a
// symlink. Null when the folder cannot be resolved.
function canonical(file) {
  try {
    return path.join(fs.realpathSync(path.dirname(path.resolve(file))), path.basename(file));
  } catch {
    return null;
  }
}

// The canonical path that the symlink `link`, itself a canonical path, points to. The kernel
// walks the target part by part, so a `..` after a folder symlink leaves the target of that
// symlink: `alias/..` with `alias -> nested/sub` is nested. Thus the target joins the folder of
// the link as a string, and only its real parent folder gets the base name; path.resolve would
// drop `alias/..` before any symlink is read. Throws when a part cannot be resolved.
function linkTarget(link) {
  const target = fs.readlinkSync(link);
  const joined = path.isAbsolute(target) ? target : `${path.dirname(link)}/${target}`;
  const cut = joined.lastIndexOf('/');
  return path.join(fs.realpathSync.native(joined.slice(0, cut) || '/'), joined.slice(cut + 1));
}

// The canonical paths that the symlink chain of `file` reaches, hop by hop, as the kernel
// resolves them. The chain stops at an entry that is no symlink or cannot be read, or after
// MAX_LINK_HOPS.
function linkChain(file) {
  const chain = [];
  let current = canonical(file);
  while (current !== null && chain.length < MAX_LINK_HOPS && isSymlink(current)) {
    try {
      current = linkTarget(current);
    } catch {
      break;
    }
    chain.push(current);
  }
  return chain;
}

// True when `file`, a CLAUDE.md or a .claude/CLAUDE.md, is a symlink whose own chain reaches
// the AGENTS.md path of its folder (for a .claude/CLAUDE.md, of the folder above), and that
// AGENTS.md is a file. Such a link holds no text of its own, so there is nothing to migrate.
// A CLAUDE.md that the AGENTS.md links to is no such link: its removal would leave the
// AGENTS.md dangling. No separate test of the chain of the AGENTS.md is needed for that: each
// hop follows from its canonical path alone, so a chain from `file` through the AGENTS.md and
// a chain from the AGENTS.md back to `file` make a loop of symlinks, and then the AGENTS.md
// resolves to no file.
export function isAgentsLink(file) {
  if (!isSymlink(file)) return false;
  let folder = path.posix.dirname(file);
  if (path.posix.basename(folder) === CLAUDE_FOLDER) folder = path.posix.dirname(folder);
  const agents = canonical(path.resolve(folder, ROOT_AGENTS));
  return agents !== null && isFile(agents) && linkChain(file).includes(agents);
}

// The text of a file, or null when no file is there; grep and awk then fail the same way. A
// file that is there but cannot be read throws CheckError, because its text is unknown.
// `latin1` gives one character per byte, as awk and grep read in the C locale.
export function readText(file, encoding = 'utf8') {
  try {
    return fs.readFileSync(file, encoding);
  } catch (error) {
    if (MISSING_CODES.has(error.code)) return null;
    process.stderr.write(
      `agent-docs: cannot read ${file} (${error.code ?? error.message}); make it readable and run the check again\n`,
    );
    throw new CheckError(`cannot read ${file}`);
  }
}

// The records that awk and grep read: one per `\n`, and a last line without `\n` counts too.
export function textLines(text) {
  const lines = text.split('\n');
  if (lines.at(-1) === '') lines.pop();
  return lines;
}

// The lines outside fenced blocks as [lineNumber, line], numbered from 1 as awk's NR.
// A line that opens or closes a fence is no prose line.
export function proseLines(text) {
  const prose = [];
  let inFence = false;
  textLines(text).forEach((line, index) => {
    if (FENCE.test(line)) inFence = !inFence;
    else if (!inFence) prose.push([index + 1, line]);
  });
  return prose;
}

// The output of `git rev-parse --show-toplevel`, or null outside git. The skill blocks sent
// git's message to /dev/null here, because outside git is an expected answer, not an error.
export function repositoryRoot() {
  const result = spawnSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' });
  if (result.error || result.status !== 0) return null;
  return result.stdout.replace(/\n+$/u, '');
}

// `git ls-files -co [--exclude-standard] -- <pathspecs>` in `root`. `-z` ends each path with a
// NUL and prints it raw; without it, git quotes a path with a byte above ASCII. A failed or
// cut-off listing throws CheckError, because an empty listing would read as a pass.
function gitFiles(root, pathspecs, excludeStandard) {
  const args = ['-c', 'core.quotePath=false', 'ls-files', '-z', '-co'];
  if (excludeStandard) args.push('--exclude-standard');
  args.push('--', ...pathspecs);
  const result = spawnSync('git', args, { cwd: root, encoding: 'utf8', maxBuffer: LISTING_BUFFER });
  if (result.error) {
    process.stderr.write(
      `agent-docs: git ls-files failed (${result.error.message}); fix the cause and run the check again\n`,
    );
    throw new CheckError(LISTING_FAILED);
  }
  process.stderr.write(result.stderr);
  if (result.status !== 0) {
    const end = result.status === null ? `the signal ${result.signal}` : `the status ${result.status}`;
    process.stderr.write(`agent-docs: git ls-files stopped with ${end}; fix the cause and run the check again\n`);
    throw new CheckError(LISTING_FAILED);
  }
  const files = result.stdout.split('\0');
  // The NUL after the last path leaves an empty string at the end, as an empty listing does.
  files.pop();
  return files;
}

// A git glob pattern as a regular expression over the whole path. Supports `**/`, `/**/`,
// `/**`, `*`, and `?`, which are all the forms the two skills use; any other character
// matches itself.
function globPattern(glob) {
  let source = '';
  for (let i = 0; i < glob.length; i += 1) {
    if (glob.startsWith('**/', i) && (i === 0 || glob[i - 1] === '/')) {
      source += '(?:.*/)?';
      i += 2;
    } else if (glob.startsWith('/**', i) && i + 3 === glob.length) {
      source += '/.*';
      i += 2;
    } else if (glob[i] === '*') source += '[^/]*';
    else if (glob[i] === '?') source += '[^/]';
    else source += glob[i].replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
  }
  return new RegExp(`^${source}$`, 'u');
}

// A `:(glob)` or `:(exclude,glob)` pathspec as { exclude, pattern }.
function parsePathspec(pathspec) {
  const parts = /^:\(([^)]*)\)(.*)$/u.exec(pathspec);
  const magic = new Set(parts?.[1].split(','));
  if (!parts || !magic.has('glob') || ![...magic].every((word) => word === 'glob' || word === 'exclude')) {
    throw new Error(`agent-docs: the tree walk supports only :(glob) and :(exclude,glob) pathspecs, not ${pathspec}`);
  }
  return { exclude: magic.has('exclude'), pattern: globPattern(parts[2]) };
}

// Every entry below `folder` that is no folder, as a path relative to `root`; with `filesOnly`,
// only the regular files, as `find -type f` lists them. A folder named in `prune` is skipped at
// any depth, as `find ... -prune` does; a symlink to a folder is not followed, as find does not
// follow it. A folder that cannot be listed throws CheckError.
function walkEntries(root, folder, options, found) {
  let entries;
  try {
    entries = fs.readdirSync(path.join(root, folder), { withFileTypes: true });
  } catch (error) {
    throw listingError(folder || '.', error);
  }
  for (const entry of entries) {
    const relative = folder === '' ? entry.name : `${folder}/${entry.name}`;
    if (entry.isDirectory()) {
      if (!options.prune.includes(entry.name)) walkEntries(root, relative, options, found);
    } else if (!options.filesOnly || entry.isFile()) found.push(relative);
  }
}

function walkFiles(root, pathspecs, options) {
  const specs = pathspecs.map(parsePathspec);
  const includes = specs.filter((spec) => !spec.exclude);
  const excludes = specs.filter((spec) => spec.exclude);
  const found = [];
  walkEntries(root, '', options, found);
  return found
    .filter((file) => includes.some((spec) => spec.pattern.test(file)))
    .filter((file) => !excludes.some((spec) => spec.pattern.test(file)))
    .sort(byteOrder);
}

// The files that match git `pathspecs`, as paths relative to `root`. Inside git, the lines of
// `git ls-files -co [--exclude-standard] -- <pathspecs>` run in `root`; outside git, a walk
// of `root` that skips each folder named in `prune`, sorted by byte order. `filesOnly` keeps
// only regular files in the walk. A listing that fails throws CheckError.
export function listFiles({ root, pathspecs, excludeStandard = false, prune, inGit, filesOnly = false }) {
  return inGit ? gitFiles(root, pathspecs, excludeStandard) : walkFiles(root, pathspecs, { prune, filesOnly });
}

// Every AGENTS.md, the root one included. One under node_modules belongs to a package, not
// to this repository, so it is never a node. `listing` holds the listFiles options other than
// `pathspecs` and `excludeStandard`.
export function agentsDocs(listing) {
  const pathspecs = [`:(glob)**/${ROOT_AGENTS}`, EXCLUDE_NODE_MODULES];
  return listFiles({ ...listing, pathspecs, excludeStandard: true });
}

// Every AGENTS.md below the root: the nodes that the root table must route.
export function nestedNodes(listing) {
  return agentsDocs(listing).filter((file) => file !== ROOT_AGENTS);
}

const TABLE_LINE = new RegExp(`^[${SPACE}]*\\|`, 'u');
const CELL_SPACE = new RegExp(`^[${SPACE}]+|[${SPACE}]+$`, 'gu');
const ROUTE_CELL = /^`@?[^` ]*AGENTS\.md`$/u;

// The routes of a root AGENTS.md: each table line whose first cell is `<dir>/AGENTS.md` in
// backticks, with a leading `@` and then a leading `./` stripped. Unique, in byte order.
export function routingRows(agentsMdText) {
  const routes = new Set();
  for (const line of textLines(agentsMdText)) {
    if (!TABLE_LINE.test(line)) continue;
    const cell = (line.split('|')[1] ?? '').replace(CELL_SPACE, '');
    if (ROUTE_CELL.test(cell)) routes.add(cell.replaceAll('`', '').replace(/^@/u, '').replace(/^\.\//u, ''));
  }
  return [...routes].sort(byteOrder);
}

// Join without path.join, which would turn `a/../b` into `b`: the shell resolves each part,
// so `test -f a/../b` fails when `a` is missing.
const fromRoot = (root, file) => (path.isAbsolute(file) ? file : `${root}/${file}`);

// The routing gaps of the repository at `listing.root`: each node that no row of the root
// AGENTS.md routes, and each route whose file does not exist.
export function routingGaps(listing) {
  const rootText = readText(fromRoot(listing.root, ROOT_AGENTS));
  const routes = rootText === null ? [] : routingRows(rootText);
  return {
    unroutedNodes: nestedNodes(listing).filter((node) => !routes.includes(node)),
    deadRoutes: routes.filter((route) => !isFile(fromRoot(listing.root, route))),
  };
}

// awk reads bytes, so a curly quote is three characters here, and `[^”]` excludes each
// of the three bytes of `”`, as it does in awk.
const latin1 = (text) => Buffer.from(text, 'utf8').toString('latin1');
const URL_TEXT = /https?:\/\/[^ )>]*/gu;
const QUOTED = new RegExp(`"[^"]*"|${latin1('“')}[^${latin1('”')}]*${latin1('”')}`, 'gu');
const STEP_NUMBER = /(phase|step|tier)[ -]?[0-9]+/gu;
const LINE_ANCHOR = /[A-Za-z0-9_./-]+\.[A-Za-z]+:[0-9]+/u;
const TIME_RELATIVE = /(^|[^a-z])(currently|as of|now has|recently)([^a-z]|$)/u;
const BARE_COUNT = /(^|[^0-9.])[0-9]+ (skills|nodes|files|tests|tables|tabs|commands|agents|plugins|rules)([^a-z]|$)/u;

// The `path:line` anchors of one line, each without its `:line`.
function lineAnchors(text) {
  const anchors = [];
  let rest = text;
  for (let match = LINE_ANCHOR.exec(rest); match !== null; match = LINE_ANCHOR.exec(rest)) {
    anchors.push(match[0].replace(/:[0-9]+$/u, ''));
    rest = rest.slice(match.index + match[0].length);
  }
  return anchors;
}

// A line anchor counts only when its path exists from the repository root (the current
// folder) or from the folder of the file, so a fictional example path passes.
function anchorExists(anchor, file) {
  return fs.existsSync(anchor) || fs.existsSync(`${path.posix.dirname(file)}/${anchor}`);
}

function scanLine(file, number, line, label) {
  const withoutUrls = line.replace(URL_TEXT, '');
  const prose = asciiLower(withoutUrls.replace(CODE_SPAN, '').replace(QUOTED, '')).replace(STEP_NUMBER, '');
  const findings = lineAnchors(withoutUrls)
    .filter((anchor) => anchorExists(anchor, file))
    .map((anchor) => `${label} line-anchor ${file}:${number} (${anchor} exists)`);
  if (TIME_RELATIVE.test(prose)) findings.push(`${label} time-relative ${file}:${number}`);
  if (!prose.includes('verify:') && BARE_COUNT.test(prose)) findings.push(`${label} bare-count ${file}:${number}`);
  return findings;
}

// The durable-doc scan: time-relative phrases, bare counts, and line anchors whose path
// exists. Fenced blocks and URLs are skipped everywhere; code spans and quoted text are
// skipped for the time and count rules only, so a line anchor in backticks still counts.
// `findingLabel` starts each line: `FINDING C5` for agent-first-setup, `VOLATILE` for
// claude-md-migration. A file that cannot be read gives `ERROR <errorLabel> cannot read <file>`
// in place of its lines; a listed file that is gone gives no line, as awk prints none for
// it. Paths are relative to the current folder.
export function durableDocScan(files, { findingLabel, errorLabel }) {
  return files.flatMap((file) =>
    guarded(errorLabel, () => {
      const text = readText(file, 'latin1');
      if (text === null) return [];
      return proseLines(text).flatMap(([number, line]) => scanLine(file, number, line, findingLabel));
    }),
  );
}
