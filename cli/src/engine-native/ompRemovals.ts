/**
 * EngineNative `sync omp` retired-entry pruning. `ompYaml.ts mergeOmpConfig` and
 * `mergeOmpModels` are additive: their `mergeMappings, deployed-key retention
 * loop` returns every deployed key absent from the SoT to the merged result,
 * and `mergeBashPatterns` keeps a deployed rule the SoT stops shipping as a user
 * rule. Removing a key or rule from `SoT/.omp/config.yml` or
 * `SoT/.omp/models.yml` therefore never removes it from the deployed file. This
 * pass force-prunes an inventory of retired kit-owned keys and rules on every
 * sync, without `--reconcile`. Message strings and prune semantics are part of
 * the contract.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { isDeepStrictEqual } from "node:util";
import { isMap, isScalar, isSeq, parseDocument, type YAMLMap } from "yaml";
import type { Ctx } from "./index";
import { bashPatternKey, bashRuleKey } from "./ompYaml";

type RetiredScalar = string | number | boolean;

/**
 * Keys the kit used to deploy, each paired with the exact value it deployed. A
 * key is pruned only while the deployed value still equals that value, so a
 * user who changed the setting keeps it. Every recorded value also equals omp's
 * current default, so pruning changes no behavior today and lets a later
 * upstream default change take effect.
 */
const OMP_RETIRED_VALUES: ReadonlyArray<readonly [string, RetiredScalar]> = [
  ["symbolPreset", "unicode"],
  ["theme.dark", "titanium"],
  ["statusLine.preset", "default"],
  ["statusLine.showHookStatus", true],
  ["statusLine.sessionAccent", true],
  ["statusLine.transparent", false],
  ["terminal.showProgress", false],
  ["tui.textSizing", false],
  ["tui.tight", false],
  ["display.shimmer", "classic"],
  ["omitThinking", false],
  ["hideThinkingBlock", false],
  ["autocompleteMaxVisible", 10],
  ["emojiAutocomplete", true],
  ["readLineNumbers", false],
  ["interruptMode", "immediate"],
  ["autoResume", false],
  ["startup.changelogMode", "summary"],
];

/**
 * Keys retired outright and pruned at any value, because the key itself no
 * longer means anything. omp migrates `providers.webSearchOrder` in memory into
 * `modelRoles.web` plus `retry.fallbackChains.web` and then drops it, but never
 * writes that expansion back to the file.
 */
const OMP_RETIRED_KEYS: ReadonlyArray<string> = ["providers.webSearchOrder"];

/**
 * models.yml blocks the kit used to deploy, each with the exact value it
 * deployed. A block is pruned only while the deployed block still equals that
 * value, so a user edit survives.
 *
 * `claude-opus-5-5` carried limits, ladder, and prices while the shared catalog
 * served the id as an empty stub. The catalog now publishes the same limits,
 * prices, and ladder. The block's `defaultLevel: high` applied only to a bare
 * selector, and every kit selector names its level.
 */
const OMP_RETIRED_MODEL_BLOCKS: ReadonlyArray<readonly [string, unknown]> = [
  [
    "providers.anthropic.modelOverrides.claude-opus-5-5",
    {
      name: "Claude Opus 5.5",
      reasoning: true,
      input: ["text", "image"],
      contextWindow: 1000000,
      maxTokens: 128000,
      cost: { input: 4, output: 20, cacheRead: 0.2, cacheWrite: 5 },
      thinking: {
        mode: "effort",
        efforts: ["low", "medium", "high", "xhigh", "max"],
        defaultLevel: "high",
      },
    },
  ],
];

/**
 * `bash.patterns` rules the kit used to deploy, each with the exact match and
 * approval it deployed. A deployed rule is pruned only while it equals one of
 * these under the merge's rule normalization, so a user rule with another match
 * or approval survives.
 *
 * The kit prompted before every file removal: rm and its wrappers, find
 * -delete, git rm, git worktree remove, and gio trash. The three `-- *` allows
 * existed only to skip those prompts.
 *
 * The kit also prompted before a `git push` word that starts with `$` or a
 * backtick. It now denies a `$` or a backtick anywhere after `git push`, so
 * the old prompt copies would otherwise stay behind as user prompts.
 */
const OMP_RETIRED_BASH_RULES: ReadonlyArray<{
  readonly match: string;
  readonly approval: "allow" | "prompt";
}> = [
  { match: "git rm -- *", approval: "allow" },
  { match: "git worktree remove -- *", approval: "allow" },
  { match: "gio trash -- *", approval: "allow" },
  { match: "rm", approval: "prompt" },
  { match: "rm *", approval: "prompt" },
  { match: "*/rm", approval: "prompt" },
  { match: "*/rm *", approval: "prompt" },
  { match: "xargs rm", approval: "prompt" },
  { match: "xargs rm *", approval: "prompt" },
  { match: "xargs * rm", approval: "prompt" },
  { match: "xargs * rm *", approval: "prompt" },
  { match: "env * rm", approval: "prompt" },
  { match: "env * rm *", approval: "prompt" },
  { match: "command rm", approval: "prompt" },
  { match: "command rm *", approval: "prompt" },
  { match: "exec rm", approval: "prompt" },
  { match: "exec rm *", approval: "prompt" },
  { match: "nohup rm", approval: "prompt" },
  { match: "nohup rm *", approval: "prompt" },
  { match: "nice rm", approval: "prompt" },
  { match: "nice rm *", approval: "prompt" },
  { match: "nice * rm", approval: "prompt" },
  { match: "nice * rm *", approval: "prompt" },
  { match: "time rm", approval: "prompt" },
  { match: "time rm *", approval: "prompt" },
  { match: "timeout * rm", approval: "prompt" },
  { match: "timeout * rm *", approval: "prompt" },
  { match: "stdbuf * rm", approval: "prompt" },
  { match: "stdbuf * rm *", approval: "prompt" },
  { match: "find -delete*", approval: "prompt" },
  { match: "find * -delete*", approval: "prompt" },
  { match: "find -exec*rm *", approval: "prompt" },
  { match: "find * -exec*rm *", approval: "prompt" },
  { match: "git rm", approval: "prompt" },
  { match: "git rm *", approval: "prompt" },
  { match: "git worktree remove", approval: "prompt" },
  { match: "git worktree remove *", approval: "prompt" },
  { match: "gio trash", approval: "prompt" },
  { match: "gio trash *", approval: "prompt" },
  { match: "git push $*", approval: "prompt" },
  { match: "git push * $*", approval: "prompt" },
  { match: "git push `*", approval: "prompt" },
  { match: "git push * `*", approval: "prompt" },
];

/** Normalized rule key to the name a prune message reports. */
const OMP_RETIRED_BASH_KEYS: ReadonlyMap<string, string> = new Map(
  OMP_RETIRED_BASH_RULES.map(({ match, approval }) => [
    bashRuleKey(match, approval),
    `bash.patterns "${match}" (${approval})`,
  ]),
);

type RetiredEntry = readonly [string, (node: unknown) => boolean];

/** Removes retired content from a deployed root mapping and names each removal. */
type Pruner = (root: YAMLMap) => Array<string>;

function indexOfKey(mapping: YAMLMap, key: string): number {
  return mapping.items.findIndex((pair) => {
    const name: unknown = pair.key;
    if (typeof name === "string") return name === key;
    return isScalar(name) && name.value === key;
  });
}

/**
 * Deletes `segments` when `matches` accepts the leaf value, then removes every
 * ancestor mapping the deletion left empty. An ancestor holding another key
 * survives, so `statusLine` keeps `compactThinkingLevel` while `tui` disappears
 * once both of its keys are gone.
 */
function deletePath(
  root: YAMLMap,
  segments: ReadonlyArray<string>,
  matches: (value: unknown) => boolean,
): boolean {
  const owners: Array<YAMLMap> = [root];
  let cursor: YAMLMap = root;
  for (const segment of segments.slice(0, -1)) {
    const index = indexOfKey(cursor, segment);
    const pair = index < 0 ? undefined : cursor.items[index];
    if (pair === undefined || !isMap(pair.value)) return false;
    cursor = pair.value;
    owners.push(cursor);
  }

  const leaf = segments[segments.length - 1];
  if (leaf === undefined) return false;
  const leafIndex = indexOfKey(cursor, leaf);
  if (leafIndex < 0) return false;
  const leafPair = cursor.items[leafIndex];
  if (leafPair === undefined || !matches(leafPair.value)) return false;

  // `commentBefore` can hold several blocks separated by a blank line. Only the
  // final block sits against this key; anything above it is a file or section
  // header that happens to precede the key, so it survives the removal instead
  // of leaving with it.
  const leafKey: unknown = leafPair.key;
  const priorComment =
    isScalar(leafKey) && typeof leafKey.commentBefore === "string"
      ? leafKey.commentBefore.slice(0, Math.max(0, leafKey.commentBefore.lastIndexOf("\n\n")))
      : "";
  cursor.items.splice(leafIndex, 1);
  if (priorComment !== "") {
    const heir: unknown = cursor.items[leafIndex]?.key;
    if (isScalar(heir)) {
      heir.commentBefore =
        typeof heir.commentBefore === "string"
          ? `${priorComment}\n\n${heir.commentBefore}`
          : priorComment;
    } else {
      // The key was last in its mapping, so there is no later key to carry the
      // header. A trailing mapping comment keeps the text in the file.
      cursor.comment =
        typeof cursor.comment === "string" ? `${cursor.comment}\n${priorComment}` : priorComment;
    }
  }

  for (let depth = owners.length - 1; depth >= 1; depth--) {
    const mapping = owners[depth];
    if (mapping === undefined || mapping.items.length > 0) break;
    const owner = owners[depth - 1];
    const segment = segments[depth - 1];
    if (owner === undefined || segment === undefined) break;
    const index = indexOfKey(owner, segment);
    if (index >= 0) owner.items.splice(index, 1);
  }
  return true;
}

/** Pruner that deletes each matching retired key path. */
function retiredKeys(entries: ReadonlyArray<RetiredEntry>): Pruner {
  return (root) => {
    const pruned: Array<string> = [];
    for (const [path, matches] of entries) {
      if (deletePath(root, path.split("."), matches)) pruned.push(path);
    }
    return pruned;
  };
}

/** Deletes each retired kit rule from the deployed `bash.patterns` sequence. */
const retiredBashRules: Pruner = (root) => {
  const bash: unknown = root.get("bash");
  const patterns: unknown = isMap(bash) ? bash.get("patterns") : undefined;
  if (!isSeq(patterns)) return [];
  const pruned: Array<string> = [];
  patterns.items = patterns.items.filter((item) => {
    const key = bashPatternKey(item);
    const name = key === undefined ? undefined : OMP_RETIRED_BASH_KEYS.get(key);
    if (name === undefined) return true;
    pruned.push(name);
    return false;
  });
  return pruned;
};

/** Applies each pruner to one deployed omp YAML file. */
function pruneRetired(
  ctx: Ctx,
  file: string,
  label: string,
  pruners: ReadonlyArray<Pruner>,
): number {
  const { change, echo, verbose, warn } = ctx.services.logger;
  if (!existsSync(file)) return 0;

  const doc = parseDocument(readFileSync(file, "utf8"));
  const parseError = doc.errors[0];
  if (parseError !== undefined) {
    warn(`omp ${label} unreadable, retired entries not pruned: ${parseError.message}`);
    return 0;
  }
  const contents = doc.contents;
  if (!isMap(contents)) return 0;

  const pruned = pruners.flatMap((prune) => prune(contents));

  if (pruned.length === 0) {
    verbose(`omp ${label} carries no retired entries`);
    return 0;
  }
  if (ctx.dryRun) {
    echo(`[dry-run] prune ${file}: ${pruned.join(", ")}`);
    return pruned.length;
  }
  writeFileSync(file, String(doc));
  change(`omp ${label} pruned ${pruned.length} retired entr(ies): ${pruned.join(", ")}`);
  return pruned.length;
}

/** Prunes retired kit-owned keys and bash rules from a deployed omp config.yml. */
export function syncOmpRemovals(ctx: Ctx, configFile: string): number {
  return pruneRetired(ctx, configFile, "config.yml", [
    retiredKeys([
      ...OMP_RETIRED_VALUES.map(([path, value]): RetiredEntry => [
        path,
        (node) => isScalar(node) && node.value === value,
      ]),
      ...OMP_RETIRED_KEYS.map((path): RetiredEntry => [path, () => true]),
    ]),
    retiredBashRules,
  ]);
}

/** Prunes retired kit-owned blocks from a deployed omp models.yml. */
export function syncOmpModelRemovals(ctx: Ctx, modelsFile: string): number {
  return pruneRetired(ctx, modelsFile, "models.yml", [
    retiredKeys(
      OMP_RETIRED_MODEL_BLOCKS.map(([path, block]): RetiredEntry => [
        path,
        (node) => isMap(node) && isDeepStrictEqual(node.toJSON(), block),
      ]),
    ),
  ]);
}
