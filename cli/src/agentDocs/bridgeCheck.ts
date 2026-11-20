/**
 * `docks-kit agent-docs bridge-check audit | verify [--expect <path>]...`: audit the agent-doc layout before
 * claude-md-migration writes (Step 2), and verify the migration after the writes (Step 6). Both commands read only;
 * they write no file. The meaning of each line and the reaction to it live in the SKILL.md of claude-md-migration.
 * Run it from any folder inside the repository, or from the project folder outside git.
 *
 * Output lines:
 *   audit   four `EXISTS <entry>` or `MISSING <entry>` lines, in the order AGENTS.md, CLAUDE.md (root),
 *           .claude/CLAUDE.md, CLAUDE.local.md; then the legacy entries of the root .claude folder (see
 *           `legacyClaudeLines`); then one `legacy: <path>` line for each CLAUDE.md and .claude/CLAUDE.md, root and
 *           nested (the root ones also when git ignores them), or `legacy link: <path>` for one that is a symlink to
 *           the AGENTS.md of its folder; one `personal: <path>` line for each CLAUDE.local.md; and
 *           `plugin author: yes (.omp-plugin/marketplace.json)`, `plugin author: yes (package.json omp object)`, or
 *           `plugin author: no`.
 *   verify  `BROKEN: AGENTS.md missing`; `BROKEN: legacy CLAUDE.md still present: <path>`; `BROKEN: <path> missing`
 *           for each --expect path that is no file; `HANDOFF context-tree: unrouted node <path>`;
 *           `HANDOFF context-tree: dead route <path>`; `VOLATILE time-relative|bare-count <file>:<line>` and
 *           `VOLATILE line-anchor <file>:<line> (<path> exists)` for every AGENTS.md. No output means the migration
 *           is complete. `HANDOFF` and `VOLATILE` lines are report items, not failures.
 *   Either command prints `ERROR <part>: file listing failed (see the message above)` for a listing that fails, and
 *   `ERROR <part>: cannot read <file>` for a file that is there but cannot be read, in place of the lines of that
 *   part. The cause is on stderr. Paths are relative to the repository root, without a leading `./`. No listing enters
 *   node_modules. The CLAUDE.local.md listing, and every listing outside git, walks the folder and skips each .git,
 *   node_modules, vendor, dist, build, out, target, and .next folder.
 *
 * Exit status: 2 after an ERROR line, 1 for a usage error, otherwise 0.
 */
import { Effect, Predicate } from "effect";

import {
  agentsDocs,
  BRIDGE_PRUNE,
  durableDocScan,
  EXCLUDE_NODE_MODULES,
  guarded,
  isAgentsLink,
  isFile,
  legacyClaudeLines,
  type Listing,
  listFiles,
  ROOT_CONTEXT_FILES,
  ROOT_PERSONAL_FILES,
  readText,
  repositoryRoot,
  routingGaps,
  UsageError,
  withRootFiles,
} from "./shared";
import { AgentDocsFiles, printLines } from "./services";

const USAGE = "usage: docks-kit agent-docs bridge-check audit | verify [--expect <path>]...";
// The Step 2 entries in output order.
const AUDIT_FILES: ReadonlyArray<string> = [
  "AGENTS.md",
  "CLAUDE.md",
  ".claude/CLAUDE.md",
  "CLAUDE.local.md",
];
const AUDIT_LABELS: Readonly<Record<string, string>> = { "CLAUDE.md": "CLAUDE.md (root)" };
const PLUGIN_CATALOG = ".omp-plugin/marketplace.json";
const PACKAGE_MANIFEST = "package.json";

/** The repository: its root and whether git answers for it. */
interface Repository {
  readonly root: string;
  readonly inGit: boolean;
}

const listing = (repo: Repository): Listing => ({
  root: repo.root,
  prune: BRIDGE_PRUNE,
  inGit: repo.inGit,
});

/**
 * Every CLAUDE.md and .claude/CLAUDE.md, root and nested; gitignored build output is skipped, but the root ones count
 * also when git ignores them, because omp loads them. The walk outside git keeps each regular file and each symlink
 * that resolves to a file, so a nested legacy link is listed and a dangling one is not; the git listing keeps
 * symlinks, as `git ls-files` did.
 */
const legacyFiles = Effect.fn("bridgeCheck.legacyFiles")(function* (repo: Repository) {
  const pathspecs = [":(glob)**/CLAUDE.md", EXCLUDE_NODE_MODULES];
  const files = yield* listFiles({ ...listing(repo), pathspecs, excludeStandard: true });
  return yield* withRootFiles(
    repo.inGit ? files : yield* Effect.filter(files, (file) => isFile(file)),
    ROOT_CONTEXT_FILES,
  );
});

/** CLAUDE.local.md is usually gitignored, so the walk finds it also inside git. */
const personalFiles = Effect.fn("bridgeCheck.personalFiles")(function* (repo: Repository) {
  const pathspecs = [":(glob)**/CLAUDE.local.md"];
  const files = yield* listFiles({ ...listing(repo), pathspecs, inGit: false, filesOnly: true });
  return yield* withRootFiles(files, ROOT_PERSONAL_FILES);
});

/** The parsed JSON text, or null when it does not parse. */
function parsedJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/**
 * The plugin-author line: an omp plugin catalog, or a package.json with an `omp` object, makes the repository the
 * source of an omp plugin. A package.json that does not parse has no `omp` object.
 */
const pluginAuthorLine = Effect.fn("bridgeCheck.pluginAuthorLine")(function* () {
  if (yield* isFile(PLUGIN_CATALOG)) return `plugin author: yes (${PLUGIN_CATALOG})`;
  const text = yield* readText(PACKAGE_MANIFEST);
  const manifest = text === null ? null : parsedJson(text);
  const omp = Predicate.hasProperty(manifest, "omp") ? manifest.omp : undefined;
  // Predicate.isObject holds for no array and no null, as the script's check does.
  return Predicate.isObject(omp)
    ? `plugin author: yes (${PACKAGE_MANIFEST} omp object)`
    : "plugin author: no";
});

/** The root .claude entries are only reported; agent-first-setup cleans them up. */
const auditLines = Effect.fn("bridgeCheck.auditLines")(function* (repo: Repository) {
  const lines: Array<string> = [];
  for (const file of AUDIT_FILES)
    lines.push(`${(yield* isFile(file)) ? "EXISTS" : "MISSING"} ${AUDIT_LABELS[file] ?? file}`);
  lines.push(
    ...(yield* guarded("legacy entries:", legacyClaudeLines())),
    ...(yield* guarded(
      "legacy:",
      Effect.flatMap(legacyFiles(repo), (files) =>
        Effect.forEach(files, (file) =>
          Effect.map(isAgentsLink(file), (link) =>
            link ? `legacy link: ${file}` : `legacy: ${file}`,
          ),
        ),
      ),
    )),
    ...(yield* guarded(
      "personal:",
      Effect.map(personalFiles(repo), (files) => files.map((file) => `personal: ${file}`)),
    )),
    ...(yield* guarded(
      "plugin author:",
      Effect.map(pluginAuthorLine(), (line) => [line]),
    )),
  );
  return lines;
});

/** The root routing belongs to context-tree; this skill only reports it. */
const routingLines = Effect.fn("bridgeCheck.routingLines")(function* (repo: Repository) {
  const { unroutedNodes, deadRoutes } = yield* routingGaps(listing(repo));
  return [
    ...unroutedNodes.map((node) => `HANDOFF context-tree: unrouted node ${node}`),
    ...deadRoutes.map((route) => `HANDOFF context-tree: dead route ${route}`),
  ];
});

const verifyLines = Effect.fn("bridgeCheck.verifyLines")(function* (
  repo: Repository,
  expectedFiles: ReadonlyArray<string>,
) {
  return [
    ...((yield* isFile("AGENTS.md")) ? [] : ["BROKEN: AGENTS.md missing"]),
    ...(yield* guarded(
      "legacy:",
      Effect.map(legacyFiles(repo), (files) =>
        files.map((file) => `BROKEN: legacy CLAUDE.md still present: ${file}`),
      ),
    )),
    ...(yield* Effect.filter(expectedFiles, (file) =>
      Effect.map(isFile(file), (found) => !found),
    )).map((file) => `BROKEN: ${file} missing`),
    ...(yield* guarded("routing:", routingLines(repo))),
    ...(yield* guarded(
      "volatile:",
      Effect.flatMap(agentsDocs(listing(repo)), (docs) =>
        durableDocScan(docs, { findingLabel: "VOLATILE", errorLabel: "volatile:" }),
      ),
    )),
  ];
});

/** The paths of `--expect <path>` pairs, or null when an argument is no such pair. */
function parseExpectedFiles(args: ReadonlyArray<string>): Array<string> | null {
  const files: Array<string> = [];
  for (let i = 0; i < args.length; i += 2) {
    const file = args[i + 1];
    if (args[i] !== "--expect" || !file) return null;
    files.push(file);
  }
  return files;
}

interface ParsedArguments {
  readonly command: "audit" | "verify";
  readonly expectedFiles: ReadonlyArray<string>;
}

/** The command and its expected files, or null for a usage error. */
function parseArguments(args: ReadonlyArray<string>): ParsedArguments | null {
  const [command, ...rest] = args;
  if (command === "audit" && rest.length === 0) return { command, expectedFiles: [] };
  const expectedFiles = command === "verify" ? parseExpectedFiles(rest) : null;
  return expectedFiles === null ? null : { command: "verify", expectedFiles };
}

/** Run `bridge-check <args>` and return its exit status; a usage error fails with UsageError. */
export const runBridgeCheck = Effect.fn("bridgeCheck.run")(function* (args: ReadonlyArray<string>) {
  const parsed = parseArguments(args);
  if (parsed === null) return yield* new UsageError({ usage: USAGE });
  const files = yield* AgentDocsFiles;
  const gitRoot = yield* repositoryRoot();
  const repo: Repository = {
    root: gitRoot ?? (yield* files.workingFolder),
    inGit: gitRoot !== null,
  };
  // Every check reads paths relative to the root, as the skill runs its blocks from there.
  yield* files.changeFolder(repo.root);
  const lines =
    parsed.command === "audit"
      ? yield* auditLines(repo)
      : yield* verifyLines(repo, parsed.expectedFiles);
  yield* printLines(lines);
  return lines.some((line) => line.startsWith("ERROR")) ? 2 : 0;
});
