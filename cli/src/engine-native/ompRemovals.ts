/**
 * EngineNative `sync omp` retired-key pruning. `ompYaml.ts mergeOmpConfig` and
 * `mergeOmpModels` are additive: their `mergeMappings, deployed-key retention
 * loop` returns every deployed key absent from the SoT to the merged result.
 * Removing a key from `SoT/.omp/config.yml` or `SoT/.omp/models.yml` therefore
 * never removes it from the deployed file. This pass force-prunes an inventory
 * of retired kit-owned keys on every sync, without `--reconcile`. Message
 * strings and prune semantics are part of the contract.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { isDeepStrictEqual } from "node:util";
import { isMap, isScalar, parseDocument, type YAMLMap } from "yaml";
import type { Ctx } from "./index";

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

type RetiredEntry = readonly [string, (node: unknown) => boolean];

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

/** Prunes each matching retired entry from one deployed omp YAML file. */
function pruneRetired(
  ctx: Ctx,
  file: string,
  label: string,
  entries: ReadonlyArray<RetiredEntry>,
): number {
  const { change, echo, verbose, warn } = ctx.services.logger;
  if (!existsSync(file)) return 0;

  const doc = parseDocument(readFileSync(file, "utf8"));
  const parseError = doc.errors[0];
  if (parseError !== undefined) {
    warn(`omp ${label} unreadable, retired keys not pruned: ${parseError.message}`);
    return 0;
  }
  const contents = doc.contents;
  if (!isMap(contents)) return 0;

  const pruned: Array<string> = [];
  for (const [path, matches] of entries) {
    if (deletePath(contents, path.split("."), matches)) pruned.push(path);
  }

  if (pruned.length === 0) {
    verbose(`omp ${label} carries no retired keys`);
    return 0;
  }
  if (ctx.dryRun) {
    echo(`[dry-run] prune ${file}: ${pruned.join(", ")}`);
    return pruned.length;
  }
  writeFileSync(file, String(doc));
  change(`omp ${label} pruned ${pruned.length} retired key(s): ${pruned.join(", ")}`);
  return pruned.length;
}

/** Prunes retired kit-owned keys from a deployed omp config.yml. */
export function syncOmpRemovals(ctx: Ctx, configFile: string): number {
  return pruneRetired(ctx, configFile, "config.yml", [
    ...OMP_RETIRED_VALUES.map(([path, value]): RetiredEntry => [
      path,
      (node) => isScalar(node) && node.value === value,
    ]),
    ...OMP_RETIRED_KEYS.map((path): RetiredEntry => [path, () => true]),
  ]);
}

/** Prunes retired kit-owned blocks from a deployed omp models.yml. */
export function syncOmpModelRemovals(ctx: Ctx, modelsFile: string): number {
  return pruneRetired(
    ctx,
    modelsFile,
    "models.yml",
    OMP_RETIRED_MODEL_BLOCKS.map(([path, block]): RetiredEntry => [
      path,
      (node) => isMap(node) && isDeepStrictEqual(node.toJSON(), block),
    ]),
  );
}
