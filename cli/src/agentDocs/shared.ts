/**
 * Shared parts of the agent-doc checks of agent-first-setup (`agent-first`) and claude-md-migration (`bridge-check`):
 * the repository root, the file listing, the legacy `.claude/` entries, the routing rows of the root AGENTS.md, the
 * nested AGENTS.md nodes, and the durable-doc scan.
 *
 * Each function ports one part of a shell block that the two skills ran before. A port keeps the semantics of that
 * block: git pathspecs, POSIX `[[:space:]]`, the leftmost-longest matches of awk, and byte order where the block
 * sorted with `sort` or a glob.
 *
 * A listing or a read that cannot finish fails with CheckError after it writes the cause to stderr; `guarded` turns
 * that error into the ERROR line of the caller.
 */
import path from "node:path";

import { Effect, Schema } from "effect";

import type { FileError, SpawnError } from "../plan/types";
import {
  AgentDocsFiles,
  AgentDocsGit,
  errorDetail,
  type FolderEntry,
  writeStderr,
} from "./services";

// The folder names that each skill skips when it walks a folder outside git.
export const AGENT_FIRST_PRUNE: ReadonlyArray<string> = [".git", "node_modules", "vendor"];
export const BRIDGE_PRUNE: ReadonlyArray<string> = [
  ".git",
  "node_modules",
  "vendor",
  "dist",
  "build",
  "out",
  "target",
  ".next",
];

// POSIX `[[:space:]]` in the C locale; JS `\s` would also match Unicode spaces.
export const SPACE = " \\t\\n\\v\\f\\r";
const ROOT_AGENTS = "AGENTS.md";
// A package under node_modules is not part of this repository.
export const EXCLUDE_NODE_MODULES = ":(exclude,glob)**/node_modules/**";
const LISTING_FAILED = "file listing failed (see the message above)";
// The errno codes that mean "no file is there", as `test -f` sees it. Any other code means that an entry is there,
// but the check cannot read it.
const MISSING_CODES: ReadonlySet<string | undefined> = new Set(["ENOENT", "ENOTDIR"]);
const FENCE = new RegExp(`^[${SPACE}]*\`\`\``, "u");
export const CODE_SPAN = /`[^`]*`/gu;

/**
 * awk's tolower and grep -i in the C locale change only ASCII letters; String#toLowerCase alone would also fold
 * letters such as the Kelvin sign into `k`.
 */
export const asciiLower = (text: string): string =>
  text.replace(/[A-Z]+/gu, (letters) => letters.toLowerCase());

/**
 * A check that cannot finish. Its cause is already on stderr; `message` completes the ERROR line of the caller, for
 * example `cannot read docs/AGENTS.md`.
 */
export class CheckError extends Schema.TaggedError<CheckError, { readonly brand: unique symbol }>()(
  "CheckError",
  {
    message: Schema.String,
  },
) {}

/** Arguments that a helper does not accept. The command edge prints `usage` on stderr and exits 1. */
export class UsageError extends Schema.TaggedError<UsageError, { readonly brand: unique symbol }>()(
  "UsageError",
  {
    usage: Schema.String,
  },
) {}

/** The lines of a check that can fail. A SpawnError, the runtime refusing git's arguments, ends the command. */
export type CheckLines<R> = Effect.Effect<ReadonlyArray<string>, CheckError | SpawnError, R>;

/**
 * The lines of one check, or one `ERROR <label> <message>` line in their place when the check fails with CheckError.
 * A failed check is never a pass, so it must not print a partial result.
 */
export const guarded = <R>(
  label: string,
  lines: CheckLines<R>,
): Effect.Effect<ReadonlyArray<string>, SpawnError, R> =>
  Effect.catchTag(lines, "CheckError", (error) =>
    Effect.succeed([`ERROR ${label} ${error.message}`]),
  );

/** The lines of `check` for each item; an item that cannot be read gives its ERROR line. */
export const eachGuarded = <A, R>(
  check: string,
  items: ReadonlyArray<A>,
  lines: (item: A) => CheckLines<R>,
): Effect.Effect<ReadonlyArray<string>, SpawnError, R> =>
  Effect.map(
    Effect.forEach(items, (item) => guarded(check, lines(item))),
    (all) => all.flat(),
  );

const listingError = Effect.fn("agentDocs.listingError")(function* (
  folder: string,
  error: FileError,
) {
  yield* writeStderr(
    `agent-docs: cannot list the folder ${folder} (${errorDetail(error)}); make it readable and run the check again\n`,
  );
  return yield* new CheckError({ message: LISTING_FAILED });
});

/**
 * `sort` and shell globs in the C locale compare bytes; String#localeCompare and the default sort compare UTF-16 code
 * units, which differ above the Basic Multilingual Plane.
 */
export const byteOrder = (a: string, b: string): number =>
  Buffer.compare(Buffer.from(a), Buffer.from(b));

// stat follows symlinks, as `test -e`, `test -f`, and `test -d` do.
export const isFile = Effect.fn("agentDocs.isFile")(function* (file: string) {
  const files = yield* AgentDocsFiles;
  return (yield* files.stat(file)) === "file";
});

export const isFolder = Effect.fn("agentDocs.isFolder")(function* (file: string) {
  const files = yield* AgentDocsFiles;
  return (yield* files.stat(file)) === "directory";
});

/**
 * The entries of `folder`, through a symlink too, as a glob sees them; none when no folder is there. A folder that is
 * there but cannot be listed fails with CheckError.
 */
export const readFolder = Effect.fn("agentDocs.readFolder")(function* (folder: string) {
  const files = yield* AgentDocsFiles;
  return yield* files
    .readFolder(folder)
    .pipe(
      Effect.catchTag("FileError", (error) =>
        MISSING_CODES.has(error.code)
          ? Effect.succeed<ReadonlyArray<FolderEntry>>([])
          : listingError(folder, error),
      ),
    );
});

/**
 * The entries of `folder` as `find <folder> -mindepth 1 -maxdepth 1` lists them, dot names included, sorted by byte
 * order of the name. None when `folder` is a symlink, because find does not follow a symlink given as its starting
 * point.
 */
export const findEntries = Effect.fn("agentDocs.findEntries")(function* (folder: string) {
  const files = yield* AgentDocsFiles;
  if (yield* files.isSymlink(folder)) return [];
  return [...(yield* readFolder(folder))].sort((a, b) => byteOrder(a.name, b.name));
});

const CLAUDE_FOLDER = ".claude";
const CLAUDE_SKILLS = ".claude/skills";
const CLAUDE_AGENTS = ".claude/agents";
const CLAUDE_SETTINGS: ReadonlyArray<string> = [
  ".claude/settings.json",
  ".claude/settings.local.json",
];
// The `.claude/` entries that have their own line; each other entry is a `legacy other:` entry.
const CLAUDE_OWN_LINES: ReadonlySet<string> = new Set([
  "CLAUDE.md",
  "skills",
  "agents",
  "settings.json",
  "settings.local.json",
]);

/** True when the absolute path `inner` is `outer` or below it. */
function isWithin(outer: string, inner: string): boolean {
  const relative = path.relative(outer, inner);
  return relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

/**
 * The link target of `file` as read, when `file` is a symlink whose real path is outside the current folder (the
 * repository root); else null. A dangling link resolves its target from the real folder of the link. A link that
 * cannot be read fails with CheckError.
 */
const externalTarget = Effect.fn("agentDocs.externalTarget")(function* (file: string) {
  const files = yield* AgentDocsFiles;
  if (!(yield* files.isSymlink(file))) return null;
  const resolved = Effect.gen(function* () {
    const target = yield* files.readLink(file);
    const real =
      (yield* files.stat(file)) === undefined
        ? path.resolve(yield* files.realPath(path.dirname(file)), target)
        : yield* files.realPath(file);
    return isWithin(yield* files.realPath("."), real) ? null : target;
  });
  return yield* resolved.pipe(Effect.catchTag("FileError", (error) => listingError(file, error)));
});

/**
 * True when the `.claude/skills` folder of the root is no link to a place outside the repository, and no `.claude`
 * link above it is either. The checks then may list its entries.
 */
export const claudeSkillsInRepository = Effect.fn("agentDocs.claudeSkillsInRepository")(
  function* () {
    return (
      (yield* externalTarget(CLAUDE_FOLDER)) === null &&
      (yield* externalTarget(CLAUDE_SKILLS)) === null
    );
  },
);

export interface ExternalLink {
  readonly path: string;
  readonly target: string;
}

export interface LegacyClaudeEntries {
  readonly external: ReadonlyArray<ExternalLink>;
  readonly skills: string | null;
  readonly agents: ReadonlyArray<string>;
  readonly settings: ReadonlyArray<string>;
  readonly others: ReadonlyArray<string>;
}

/**
 * The legacy Claude Code entries of the `.claude/` folder in the current folder (the repository root): `external`,
 * each of `.claude`, `.claude/skills`, and `.claude/agents` that is a symlink to a place outside the repository, as
 * { path, target }, with no entry below it; the skills folder; each agent file that `.claude/agents/*.md` expands to
 * (no dot names, in byte order); each settings file; and `others`, each other entry of `.claude/` (dot names too, in
 * byte order). Fails with CheckError when `.claude` or `.claude/agents` is there but cannot be listed.
 */
export const legacyClaudeEntries = Effect.fn("agentDocs.legacyClaudeEntries")(function* () {
  const external: Array<ExternalLink> = [];
  const outside = Effect.fn("agentDocs.legacyClaudeEntries.outside")(function* (folder: string) {
    const target = yield* externalTarget(folder);
    if (target !== null) external.push({ path: folder, target });
    return target !== null;
  });
  if (yield* outside(CLAUDE_FOLDER)) {
    const entries: LegacyClaudeEntries = {
      external,
      skills: null,
      agents: [],
      settings: [],
      others: [],
    };
    return entries;
  }
  const skillsOutside = yield* outside(CLAUDE_SKILLS);
  const agentsOutside = yield* outside(CLAUDE_AGENTS);
  const others = (yield* readFolder(CLAUDE_FOLDER))
    .map((entry) => entry.name)
    .filter((name) => !CLAUDE_OWN_LINES.has(name))
    .sort(byteOrder)
    .map((name) => `${CLAUDE_FOLDER}/${name}`);
  const agents = agentsOutside
    ? []
    : yield* Effect.filter(
        (yield* readFolder(CLAUDE_AGENTS))
          .map((entry) => entry.name)
          .filter((name) => !name.startsWith(".") && name.endsWith(".md"))
          .sort(byteOrder)
          .map((name) => `${CLAUDE_AGENTS}/${name}`),
        (file) => isFile(file),
      );
  const entries: LegacyClaudeEntries = {
    external,
    skills: !skillsOutside && (yield* isFolder(CLAUDE_SKILLS)) ? CLAUDE_SKILLS : null,
    agents,
    settings: yield* Effect.filter(CLAUDE_SETTINGS, (file) => isFile(file)),
    others,
  };
  return entries;
});

/**
 * The `legacy external:`, `legacy skills:`, `legacy agents:`, `legacy settings:`, and `legacy other:` lines of
 * legacyClaudeEntries.
 */
export const legacyClaudeLines = Effect.fn("agentDocs.legacyClaudeLines")(function* () {
  const { external, skills, agents, settings, others } = yield* legacyClaudeEntries();
  const lines: ReadonlyArray<string> = [
    ...external.map((link) => `legacy external: ${link.path} -> ${link.target}`),
    ...(skills === null ? [] : [`legacy skills: ${skills}`]),
    ...agents.map((agent) => `legacy agents: ${agent}`),
    ...settings.map((file) => `legacy settings: ${file}`),
    ...others.map((entry) => `legacy other: ${entry}`),
  ];
  return lines;
});

// The root context files that omp can load, and the root personal file.
export const ROOT_CONTEXT_FILES: ReadonlyArray<string> = ["CLAUDE.md", ".claude/CLAUDE.md"];
export const ROOT_PERSONAL_FILES: ReadonlyArray<string> = ["CLAUDE.local.md"];

/**
 * `files` and each of the root files `names` that is a file (a symlink to a file too), unique and in byte order. A
 * git listing skips an ignored file, but omp still loads an ignored CLAUDE.md or .claude/CLAUDE.md. A `.claude` link
 * to a place outside the repository adds no file. A `.claude` link that cannot be read fails with CheckError.
 */
export const withRootFiles = Effect.fn("agentDocs.withRootFiles")(function* (
  files: ReadonlyArray<string>,
  names: ReadonlyArray<string>,
) {
  const claudeOutside = (yield* externalTarget(CLAUDE_FOLDER)) !== null;
  const found = yield* Effect.filter(names, (name) =>
    Effect.map(
      isFile(name),
      (file) => file && !(claudeOutside && name.startsWith(`${CLAUDE_FOLDER}/`)),
    ),
  );
  return [...new Set([...files, ...found])].sort(byteOrder);
});

// The most symlinks that one chain follows; Linux stops after 40 too, so a longer chain or a loop resolves to no file.
const MAX_LINK_HOPS = 40;

/**
 * `file` as an absolute path with the real path of its folder, so that two paths to one entry through folder
 * symlinks compare equal; the last part stays as is, because it may be a symlink. Null when the folder cannot be
 * resolved.
 */
const canonical = Effect.fn("agentDocs.canonical")(function* (file: string) {
  const files = yield* AgentDocsFiles;
  return yield* files.realPath(path.dirname(path.resolve(file))).pipe(
    Effect.map((folder) => path.join(folder, path.basename(file))),
    Effect.catchTag("FileError", () => Effect.succeed(null)),
  );
});

/**
 * The canonical path that the symlink `link`, itself a canonical path, points to. The kernel walks the target part
 * by part, so a `..` after a folder symlink leaves the target of that symlink: `alias/..` with `alias -> nested/sub`
 * is nested. Thus the target joins the folder of the link as a string, and only its real parent folder gets the base
 * name; path.resolve would drop `alias/..` before any symlink is read. Fails when a part cannot be resolved.
 */
const linkTarget = Effect.fn("agentDocs.linkTarget")(function* (link: string) {
  const files = yield* AgentDocsFiles;
  const target = yield* files.readLink(link);
  const joined = path.isAbsolute(target) ? target : `${path.dirname(link)}/${target}`;
  const cut = joined.lastIndexOf("/");
  return path.join(yield* files.realPathNative(joined.slice(0, cut) || "/"), joined.slice(cut + 1));
});

/**
 * The canonical paths that the symlink chain of `file` reaches, hop by hop, as the kernel resolves them. The chain
 * stops at an entry that is no symlink or cannot be read, or after MAX_LINK_HOPS.
 */
const linkChain = Effect.fn("agentDocs.linkChain")(function* (file: string) {
  const files = yield* AgentDocsFiles;
  const chain: Array<string> = [];
  let current = yield* canonical(file);
  while (current !== null && chain.length < MAX_LINK_HOPS && (yield* files.isSymlink(current))) {
    const next = yield* linkTarget(current).pipe(
      Effect.catchTag("FileError", () => Effect.succeed(null)),
    );
    if (next === null) break;
    current = next;
    chain.push(current);
  }
  return chain;
});

/**
 * True when `file`, a CLAUDE.md or a .claude/CLAUDE.md, is a symlink whose own chain reaches the AGENTS.md path of
 * its folder (for a .claude/CLAUDE.md, of the folder above), and that AGENTS.md is a file. Such a link holds no text
 * of its own, so there is nothing to migrate. A CLAUDE.md that the AGENTS.md links to is no such link: its removal
 * would leave the AGENTS.md dangling. No separate test of the chain of the AGENTS.md is needed for that: each hop
 * follows from its canonical path alone, so a chain from `file` through the AGENTS.md and a chain from the AGENTS.md
 * back to `file` make a loop of symlinks, and then the AGENTS.md resolves to no file.
 */
export const isAgentsLink = Effect.fn("agentDocs.isAgentsLink")(function* (file: string) {
  const files = yield* AgentDocsFiles;
  if (!(yield* files.isSymlink(file))) return false;
  let folder = path.posix.dirname(file);
  if (path.posix.basename(folder) === CLAUDE_FOLDER) folder = path.posix.dirname(folder);
  const agents = yield* canonical(path.resolve(folder, ROOT_AGENTS));
  return agents !== null && (yield* isFile(agents)) && (yield* linkChain(file)).includes(agents);
});

/**
 * The text of a file, or null when no file is there; grep and awk then fail the same way. A file that is there but
 * cannot be read fails with CheckError, because its text is unknown. `latin1` gives one character per byte, as awk
 * and grep read in the C locale.
 */
export const readText = Effect.fn("agentDocs.readText")(function* (
  file: string,
  encoding: "utf8" | "latin1" = "utf8",
) {
  const files = yield* AgentDocsFiles;
  return yield* files.readFile(file, encoding).pipe(
    Effect.catchTag("FileError", (error) => {
      if (MISSING_CODES.has(error.code)) return Effect.succeed(null);
      return writeStderr(
        `agent-docs: cannot read ${file} (${errorDetail(error)}); make it readable and run the check again\n`,
      ).pipe(Effect.andThen(new CheckError({ message: `cannot read ${file}` })));
    }),
  );
});

/** The records that awk and grep read: one per `\n`, and a last line without `\n` counts too. */
export function textLines(text: string): Array<string> {
  const lines = text.split("\n");
  if (lines.at(-1) === "") lines.pop();
  return lines;
}

/**
 * The lines outside fenced blocks as [lineNumber, line], numbered from 1 as awk's NR. A line that opens or closes a
 * fence is no prose line.
 */
export function proseLines(text: string): Array<readonly [number, string]> {
  const prose: Array<readonly [number, string]> = [];
  let inFence = false;
  textLines(text).forEach((line, index) => {
    if (FENCE.test(line)) inFence = !inFence;
    else if (!inFence) prose.push([index + 1, line]);
  });
  return prose;
}

/**
 * The output of `git rev-parse --show-toplevel`, or null outside git. The skill blocks sent git's message to
 * /dev/null here, because outside git is an expected answer, not an error.
 */
export const repositoryRoot = Effect.fn("agentDocs.repositoryRoot")(function* () {
  const git = yield* AgentDocsGit;
  const result = yield* git.run(["rev-parse", "--show-toplevel"]);
  if (result.error !== undefined || result.status !== 0) return null;
  return result.stdout.replace(/\n+$/u, "");
});

/**
 * `git ls-files -co [--exclude-standard] -- <pathspecs>` in `root`. `-z` ends each path with a NUL and prints it raw;
 * without it, git quotes a path with a byte above ASCII. A failed or cut-off listing fails with CheckError, because
 * an empty listing would read as a pass.
 */
const gitFiles = Effect.fn("agentDocs.gitFiles")(function* (
  root: string,
  pathspecs: ReadonlyArray<string>,
  excludeStandard: boolean,
) {
  const git = yield* AgentDocsGit;
  const args = ["-c", "core.quotePath=false", "ls-files", "-z", "-co"];
  if (excludeStandard) args.push("--exclude-standard");
  args.push("--", ...pathspecs);
  const result = yield* git.run(args, root);
  if (result.error !== undefined) {
    yield* writeStderr(
      `agent-docs: git ls-files failed (${result.error.message}); fix the cause and run the check again\n`,
    );
    return yield* new CheckError({ message: LISTING_FAILED });
  }
  yield* writeStderr(result.stderr);
  if (result.status !== 0) {
    const end =
      result.status === null
        ? `the signal ${String(result.signal)}`
        : `the status ${String(result.status)}`;
    yield* writeStderr(
      `agent-docs: git ls-files stopped with ${end}; fix the cause and run the check again\n`,
    );
    return yield* new CheckError({ message: LISTING_FAILED });
  }
  const files = result.stdout.split("\0");
  // The NUL after the last path leaves an empty string at the end, as an empty listing does.
  files.pop();
  return files;
});

/**
 * A git glob pattern as a regular expression over the whole path. Supports `**\/`, `/**\/`, `/**`, `*`, and `?`,
 * which are all the forms the two skills use; any other character matches itself.
 */
function globPattern(glob: string): RegExp {
  let source = "";
  for (let i = 0; i < glob.length; i += 1) {
    if (glob.startsWith("**/", i) && (i === 0 || glob[i - 1] === "/")) {
      source += "(?:.*/)?";
      i += 2;
    } else if (glob.startsWith("/**", i) && i + 3 === glob.length) {
      source += "/.*";
      i += 2;
    } else if (glob[i] === "*") source += "[^/]*";
    else if (glob[i] === "?") source += "[^/]";
    else source += (glob[i] ?? "").replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  }
  return new RegExp(`^${source}$`, "u");
}

interface Pathspec {
  readonly exclude: boolean;
  readonly pattern: RegExp;
}

/** A `:(glob)` or `:(exclude,glob)` pathspec as { exclude, pattern }. */
function parsePathspec(pathspec: string): Pathspec {
  const parts = /^:\(([^)]*)\)(.*)$/u.exec(pathspec);
  const magic = new Set(parts?.[1]?.split(","));
  if (
    !parts ||
    !magic.has("glob") ||
    ![...magic].every((word) => word === "glob" || word === "exclude")
  ) {
    throw new Error(
      `agent-docs: the tree walk supports only :(glob) and :(exclude,glob) pathspecs, not ${pathspec}`,
    );
  }
  return { exclude: magic.has("exclude"), pattern: globPattern(parts[2] ?? "") };
}

interface WalkOptions {
  readonly prune: ReadonlyArray<string>;
  readonly filesOnly: boolean;
}

/**
 * Every entry below `folder` that is no folder, as a path relative to `root`; with `filesOnly`, only the regular
 * files, as `find -type f` lists them. A folder named in `prune` is skipped at any depth, as `find ... -prune` does; a
 * symlink to a folder is not followed, as find does not follow it. A folder that cannot be listed fails with
 * CheckError.
 */
const walkEntries: (
  root: string,
  folder: string,
  options: WalkOptions,
  found: Array<string>,
) => Effect.Effect<void, CheckError, AgentDocsFiles> = Effect.fn("agentDocs.walkEntries")(
  function* (root: string, folder: string, options: WalkOptions, found: Array<string>) {
    const files = yield* AgentDocsFiles;
    const entries = yield* files
      .readFolder(path.join(root, folder))
      .pipe(Effect.catchTag("FileError", (error) => listingError(folder || ".", error)));
    for (const entry of entries) {
      const relative = folder === "" ? entry.name : `${folder}/${entry.name}`;
      if (entry.kind === "directory") {
        if (!options.prune.includes(entry.name)) yield* walkEntries(root, relative, options, found);
      } else if (!options.filesOnly || entry.kind === "file") found.push(relative);
    }
  },
);

const walkFiles = Effect.fn("agentDocs.walkFiles")(function* (
  root: string,
  pathspecs: ReadonlyArray<string>,
  options: WalkOptions,
) {
  const specs = pathspecs.map(parsePathspec);
  const includes = specs.filter((spec) => !spec.exclude);
  const excludes = specs.filter((spec) => spec.exclude);
  const found: Array<string> = [];
  yield* walkEntries(root, "", options, found);
  return found
    .filter((file) => includes.some((spec) => spec.pattern.test(file)))
    .filter((file) => !excludes.some((spec) => spec.pattern.test(file)))
    .sort(byteOrder);
});

/** The listing of one repository: its root, the folders the walk skips, and whether git answers for it. */
export interface Listing {
  readonly root: string;
  readonly prune: ReadonlyArray<string>;
  readonly inGit: boolean;
}

export interface ListFilesOptions extends Listing {
  readonly pathspecs: ReadonlyArray<string>;
  readonly excludeStandard?: boolean;
  readonly filesOnly?: boolean;
}

/** The paths of one listing; a listing that cannot finish fails with CheckError. */
export type FileListing = Effect.Effect<
  ReadonlyArray<string>,
  CheckError | SpawnError,
  AgentDocsFiles | AgentDocsGit
>;

/**
 * The files that match git `pathspecs`, as paths relative to `root`. Inside git, the lines of
 * `git ls-files -co [--exclude-standard] -- <pathspecs>` run in `root`; outside git, a walk of `root` that skips each
 * folder named in `prune`, sorted by byte order. `filesOnly` keeps only regular files in the walk. A listing that
 * fails fails with CheckError.
 */
export const listFiles = ({
  root,
  pathspecs,
  excludeStandard = false,
  prune,
  inGit,
  filesOnly = false,
}: ListFilesOptions): FileListing =>
  inGit
    ? gitFiles(root, pathspecs, excludeStandard)
    : walkFiles(root, pathspecs, { prune, filesOnly });

/** Every AGENTS.md, the root one included. One under node_modules belongs to a package, not to this repository. */
export const agentsDocs = (listing: Listing): FileListing =>
  listFiles({
    ...listing,
    pathspecs: [`:(glob)**/${ROOT_AGENTS}`, EXCLUDE_NODE_MODULES],
    excludeStandard: true,
  });

/** Every AGENTS.md below the root: the nodes that the root table must route. */
export const nestedNodes = (listing: Listing): FileListing =>
  Effect.map(agentsDocs(listing), (files) => files.filter((file) => file !== ROOT_AGENTS));

const TABLE_LINE = new RegExp(`^[${SPACE}]*\\|`, "u");
const CELL_SPACE = new RegExp(`^[${SPACE}]+|[${SPACE}]+$`, "gu");
const ROUTE_CELL = /^`@?[^` ]*AGENTS\.md`$/u;

/**
 * The routes of a root AGENTS.md: each table line whose first cell is `<dir>/AGENTS.md` in backticks, with a leading
 * `@` and then a leading `./` stripped. Unique, in byte order.
 */
export function routingRows(agentsMdText: string): Array<string> {
  const routes = new Set<string>();
  for (const line of textLines(agentsMdText)) {
    if (!TABLE_LINE.test(line)) continue;
    const cell = (line.split("|")[1] ?? "").replace(CELL_SPACE, "");
    if (ROUTE_CELL.test(cell))
      routes.add(cell.replaceAll("`", "").replace(/^@/u, "").replace(/^\.\//u, ""));
  }
  return [...routes].sort(byteOrder);
}

// Join without path.join, which would turn `a/../b` into `b`: the shell resolves each part, so `test -f a/../b`
// fails when `a` is missing.
const fromRoot = (root: string, file: string): string =>
  path.isAbsolute(file) ? file : `${root}/${file}`;

/**
 * The routing gaps of the repository at `listing.root`: each node that no row of the root AGENTS.md routes, and each
 * route whose file does not exist.
 */
/** The routing gaps of a repository. */
export interface RoutingGaps {
  readonly unroutedNodes: ReadonlyArray<string>;
  readonly deadRoutes: ReadonlyArray<string>;
}

export const routingGaps = Effect.fn("agentDocs.routingGaps")(function* (listing: Listing) {
  const rootText = yield* readText(fromRoot(listing.root, ROOT_AGENTS));
  const routes = rootText === null ? [] : routingRows(rootText);
  const gaps: RoutingGaps = {
    unroutedNodes: (yield* nestedNodes(listing)).filter((node) => !routes.includes(node)),
    deadRoutes: yield* Effect.filter(routes, (route) =>
      Effect.map(isFile(fromRoot(listing.root, route)), (file) => !file),
    ),
  };
  return gaps;
});

// awk reads bytes, so a curly quote is three characters here, and `[^”]` excludes each of the three bytes of `”`,
// as it does in awk.
const latin1 = (text: string): string => Buffer.from(text, "utf8").toString("latin1");
const URL_TEXT = /https?:\/\/[^ )>]*/gu;
const QUOTED = new RegExp(`"[^"]*"|${latin1("“")}[^${latin1("”")}]*${latin1("”")}`, "gu");
const STEP_NUMBER = /(phase|step|tier)[ -]?[0-9]+/gu;
const LINE_ANCHOR = /[A-Za-z0-9_./-]+\.[A-Za-z]+:[0-9]+/u;
const TIME_RELATIVE = /(^|[^a-z])(currently|as of|now has|recently)([^a-z]|$)/u;
const BARE_COUNT =
  /(^|[^0-9.])[0-9]+ (skills|nodes|files|tests|tables|tabs|commands|agents|plugins|rules)([^a-z]|$)/u;

/** The `path:line` anchors of one line, each without its `:line`. */
function lineAnchors(text: string): Array<string> {
  const anchors: Array<string> = [];
  let rest = text;
  for (let match = LINE_ANCHOR.exec(rest); match !== null; match = LINE_ANCHOR.exec(rest)) {
    anchors.push(match[0].replace(/:[0-9]+$/u, ""));
    rest = rest.slice(match.index + match[0].length);
  }
  return anchors;
}

/**
 * A line anchor counts only when its path exists from the repository root (the current folder) or from the folder of
 * the file, so a fictional example path passes.
 */
const anchorExists = Effect.fn("agentDocs.anchorExists")(function* (anchor: string, file: string) {
  const files = yield* AgentDocsFiles;
  return (
    (yield* files.exists(anchor)) || (yield* files.exists(`${path.posix.dirname(file)}/${anchor}`))
  );
});

const scanLine = Effect.fn("agentDocs.scanLine")(function* (
  file: string,
  number: number,
  line: string,
  label: string,
) {
  const withoutUrls = line.replace(URL_TEXT, "");
  const prose = asciiLower(withoutUrls.replace(CODE_SPAN, "").replace(QUOTED, "")).replace(
    STEP_NUMBER,
    "",
  );
  const findings = (yield* Effect.filter(lineAnchors(withoutUrls), (anchor) =>
    anchorExists(anchor, file),
  )).map((anchor) => `${label} line-anchor ${file}:${number} (${anchor} exists)`);
  if (TIME_RELATIVE.test(prose)) findings.push(`${label} time-relative ${file}:${number}`);
  if (!prose.includes("verify:") && BARE_COUNT.test(prose))
    findings.push(`${label} bare-count ${file}:${number}`);
  return findings;
});

/**
 * The durable-doc scan: time-relative phrases, bare counts, and line anchors whose path exists. Fenced blocks and
 * URLs are skipped everywhere; code spans and quoted text are skipped for the time and count rules only, so a line
 * anchor in backticks still counts. `findingLabel` starts each line: `FINDING C5` for agent-first-setup, `VOLATILE`
 * for claude-md-migration. A file that cannot be read gives `ERROR <errorLabel> cannot read <file>` in place of its
 * lines; a listed file that is gone gives no line, as awk prints none for it. Paths are relative to the current
 * folder.
 */
export const durableDocScan = (
  files: ReadonlyArray<string>,
  labels: { readonly findingLabel: string; readonly errorLabel: string },
): Effect.Effect<ReadonlyArray<string>, SpawnError, AgentDocsFiles> =>
  eachGuarded(labels.errorLabel, files, (file) =>
    Effect.gen(function* () {
      const text = yield* readText(file, "latin1");
      if (text === null) return [];
      const lines: Array<string> = [];
      for (const [number, line] of proseLines(text))
        lines.push(...(yield* scanLine(file, number, line, labels.findingLabel)));
      return lines;
    }),
  );
