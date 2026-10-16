/**
 * YAML merge for the omp config.yml and models.yml files. omp serialises both
 * files itself, so the kit uses the yaml package rather than a line-based
 * merge. Deployed-only keys are retained, except where the file-specific
 * wrapper drops them: config.yml drops slash-bearing keys directly under
 * retry.fallbackChains, because omp treats those as model or provider
 * wildcards ahead of role chains, so a stale wildcard would silently override
 * the kit-managed role chains. models.yml drops nothing; a user file may carry
 * provider credentials and custom models the kit never declares.
 *
 * A SoT sequence replaces the deployed sequence, except `bash.patterns` in
 * config.yml: `mergeBashPatterns` keeps the user's command rules and groups all
 * rules by approval.
 */
import { isMap, isScalar, isSeq, parseDocument, type YAMLMap, type YAMLSeq } from "yaml";

/** Decides whether a deployed-only key at `path` is dropped instead of kept. */
type DropDeployedKey = (path: ReadonlyArray<string>, key: string) => boolean;

/** Merges the deployed sequence at `path` into the SoT sequence in place. */
type MergeSequence = (path: ReadonlyArray<string>, sotSeq: YAMLSeq, deployedSeq: YAMLSeq) => void;

const fallbackChainsPath = ["retry", "fallbackChains"] as const;

function stringKey(key: unknown): string | undefined {
  if (typeof key === "string") return key;
  if (isScalar(key) && typeof key.value === "string") return key.value;
  return undefined;
}

function keyName(key: unknown): string {
  return isScalar(key) ? String(key.value) : String(key);
}

const dropFallbackWildcard: DropDeployedKey = (path, key) =>
  path.length === fallbackChainsPath.length &&
  path[0] === fallbackChainsPath[0] &&
  path[1] === fallbackChainsPath[1] &&
  key.includes("/");

const keepEveryKey: DropDeployedKey = () => false;

const keepSotSequence: MergeSequence = () => {};

/**
 * Identity of one `bash.patterns` rule, normalized the way omp reads it: the
 * approval is trimmed and lowercased, and whitespace runs in `match` collapse to
 * one space.
 */
export function bashRuleKey(match: string, approval: string): string {
  return `${approval.trim().toLowerCase()}\u0000${match.trim().replace(/\s+/gu, " ")}`;
}

/** `bashRuleKey` of one deployed rule node, or undefined for an entry omp would ignore. */
export function bashPatternKey(node: unknown): string | undefined {
  if (!isMap(node)) return undefined;
  const match = node.get("match");
  const approval = node.get("approval");
  if (typeof match !== "string" || typeof approval !== "string") return undefined;
  return bashRuleKey(match, approval);
}

/**
 * omp evaluates `bash.patterns` in order, and the first matching rule wins. The
 * merge groups the rules: kit deny, user deny, user prompt, kit exception allow,
 * kit prompt, the other user rules in their deployed order, then kit allow. A
 * kit exception is a kit allow that the SoT lists before its first prompt: an
 * option-terminated form such as `git rm -- *` that a broader kit prompt
 * (`git rm *`) would otherwise shadow, because a glob cannot exclude it. A user
 * deny or prompt therefore always precedes every kit allow, and no user or
 * tail allow loosens a deny or a prompt. A deployed rule equal to a kit rule is
 * the kit copy, so a re-sync changes nothing. A rule the kit stops shipping
 * stays as a user rule.
 */
const mergeBashPatterns: MergeSequence = (path, sotSeq, deployedSeq) => {
  if (path.length !== 2 || path[0] !== "bash" || path[1] !== "patterns") return;
  const kitKeys = new Set(sotSeq.items.map(bashPatternKey));
  const kit: Record<"deny" | "exception" | "prompt" | "allow", Array<unknown>> = {
    deny: [],
    exception: [],
    prompt: [],
    allow: [],
  };
  const user: Record<"deny" | "prompt" | "other", Array<unknown>> = {
    deny: [],
    prompt: [],
    other: [],
  };
  for (const item of sotSeq.items) {
    const approval = bashPatternKey(item)?.split("\u0000")[0];
    if (approval === "deny" || approval === "prompt") kit[approval].push(item);
    else if (kit.prompt.length === 0 && approval === "allow") kit.exception.push(item);
    else kit.allow.push(item);
  }
  for (const item of deployedSeq.items) {
    const key = bashPatternKey(item);
    if (key !== undefined && kitKeys.has(key)) continue;
    const approval = key?.split("\u0000")[0];
    user[approval === "deny" || approval === "prompt" ? approval : "other"].push(item);
  }
  sotSeq.items = [
    ...kit.deny,
    ...user.deny,
    ...user.prompt,
    ...kit.exception,
    ...kit.prompt,
    ...user.other,
    ...kit.allow,
  ];
};

function pruneMapping(mapping: YAMLMap, path: ReadonlyArray<string>, drop: DropDeployedKey): void {
  for (let index = mapping.items.length - 1; index >= 0; index--) {
    const pair = mapping.items[index];
    if (pair === undefined) continue;

    if (drop(path, keyName(pair.key))) {
      mapping.items.splice(index, 1);
      continue;
    }

    const key = stringKey(pair.key);
    if (key !== undefined && isMap(pair.value)) {
      pruneMapping(pair.value, [...path, key], drop);
    }
  }
}

function mergeMappings(
  sotMapping: YAMLMap,
  deployedMapping: YAMLMap,
  path: ReadonlyArray<string>,
  drop: DropDeployedKey,
  mergeSequence: MergeSequence,
): void {
  for (const sotPair of sotMapping.items) {
    const key = stringKey(sotPair.key);
    if (key === undefined) continue;

    const deployedPair = deployedMapping.items.find(
      (candidate) => stringKey(candidate.key) === key,
    );
    if (deployedPair !== undefined && isMap(sotPair.value) && isMap(deployedPair.value)) {
      mergeMappings(sotPair.value, deployedPair.value, [...path, key], drop, mergeSequence);
    }
    if (deployedPair !== undefined && isSeq(sotPair.value) && isSeq(deployedPair.value)) {
      mergeSequence([...path, key], sotPair.value, deployedPair.value);
    }
  }

  for (const deployedPair of deployedMapping.items) {
    const key = stringKey(deployedPair.key);
    const isManaged =
      key !== undefined && sotMapping.items.some((candidate) => stringKey(candidate.key) === key);
    if (isManaged) continue;

    if (drop(path, keyName(deployedPair.key))) continue;
    if (key !== undefined && isMap(deployedPair.value)) {
      pruneMapping(deployedPair.value, [...path, key], drop);
    }
    sotMapping.items.push(deployedPair);
  }
}

function mergeYamlDocuments(
  sotText: string,
  deployedText: string,
  name: string,
  drop: DropDeployedKey,
  mergeSequence: MergeSequence,
): string {
  const deployedDoc = parseDocument(deployedText);
  const deployedError = deployedDoc.errors[0];
  if (deployedError !== undefined) {
    throw new Error(`Invalid deployed omp ${name} YAML: ${deployedError.message}`);
  }

  const deployedContents = deployedDoc.contents;
  if (
    deployedContents === null ||
    deployedContents === undefined ||
    (isScalar(deployedContents) && deployedContents.value === null)
  ) {
    return sotText;
  }
  if (!isMap(deployedContents)) {
    throw new Error(`Deployed omp ${name} YAML root must be a mapping`);
  }

  const sotDoc = parseDocument(sotText);
  const sotError = sotDoc.errors[0];
  if (sotError !== undefined) {
    throw new Error(`Invalid SoT omp ${name} YAML: ${sotError.message}`);
  }
  if (!isMap(sotDoc.contents)) {
    throw new Error(`SoT omp ${name} YAML root must be a mapping`);
  }

  mergeMappings(sotDoc.contents, deployedContents, [], drop, mergeSequence);
  return sotDoc.toString();
}

/**
 * config.yml merge: keeps user-only keys and user `bash.patterns` rules, drops
 * stale fallback-chain wildcards.
 */
export function mergeOmpConfig(sotText: string, deployedText: string): string {
  return mergeYamlDocuments(
    sotText,
    deployedText,
    "config.yml",
    dropFallbackWildcard,
    mergeBashPatterns,
  );
}

/** models.yml merge: keeps every user-only key, including credentials and custom models. */
export function mergeOmpModels(sotText: string, deployedText: string): string {
  return mergeYamlDocuments(sotText, deployedText, "models.yml", keepEveryKey, keepSotSequence);
}
