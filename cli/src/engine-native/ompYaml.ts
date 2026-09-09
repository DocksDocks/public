/**
 * YAML merge for the omp config.yml and models.yml files. omp serialises both
 * files itself, so the kit uses the yaml package rather than a line-based
 * merge. Deployed-only keys are retained, except where the file-specific
 * wrapper drops them: config.yml drops slash-bearing keys directly under
 * retry.fallbackChains, because omp treats those as model or provider
 * wildcards ahead of role chains, so a stale wildcard would silently override
 * the kit-managed role chains. models.yml drops nothing; a user file may carry
 * provider credentials and custom models the kit never declares.
 */
import { isMap, isScalar, parseDocument, type YAMLMap } from "yaml"

/** Decides whether a deployed-only key at `path` is dropped instead of kept. */
type DropDeployedKey = (path: ReadonlyArray<string>, key: string) => boolean

const fallbackChainsPath = ["retry", "fallbackChains"] as const

function stringKey(key: unknown): string | undefined {
  if (typeof key === "string") return key
  if (isScalar(key) && typeof key.value === "string") return key.value
  return undefined
}

function keyName(key: unknown): string {
  return isScalar(key) ? String(key.value) : String(key)
}

const dropFallbackWildcard: DropDeployedKey = (path, key) =>
  path.length === fallbackChainsPath.length &&
  path[0] === fallbackChainsPath[0] &&
  path[1] === fallbackChainsPath[1] &&
  key.includes("/")

const keepEveryKey: DropDeployedKey = () => false

function pruneMapping(mapping: YAMLMap, path: ReadonlyArray<string>, drop: DropDeployedKey): void {
  for (let index = mapping.items.length - 1; index >= 0; index--) {
    const pair = mapping.items[index]
    if (pair === undefined) continue

    if (drop(path, keyName(pair.key))) {
      mapping.items.splice(index, 1)
      continue
    }

    const key = stringKey(pair.key)
    if (key !== undefined && isMap(pair.value)) {
      pruneMapping(pair.value, [...path, key], drop)
    }
  }
}

function mergeMappings(
  sotMapping: YAMLMap,
  deployedMapping: YAMLMap,
  path: ReadonlyArray<string>,
  drop: DropDeployedKey
): void {
  for (const sotPair of sotMapping.items) {
    const key = stringKey(sotPair.key)
    if (key === undefined) continue

    const deployedPair = deployedMapping.items.find((candidate) => stringKey(candidate.key) === key)
    if (deployedPair !== undefined && isMap(sotPair.value) && isMap(deployedPair.value)) {
      mergeMappings(sotPair.value, deployedPair.value, [...path, key], drop)
    }
  }

  for (const deployedPair of deployedMapping.items) {
    const key = stringKey(deployedPair.key)
    const isManaged =
      key !== undefined && sotMapping.items.some((candidate) => stringKey(candidate.key) === key)
    if (isManaged) continue

    if (drop(path, keyName(deployedPair.key))) continue
    if (key !== undefined && isMap(deployedPair.value)) {
      pruneMapping(deployedPair.value, [...path, key], drop)
    }
    sotMapping.items.push(deployedPair)
  }
}

function mergeYamlDocuments(
  sotText: string,
  deployedText: string,
  name: string,
  drop: DropDeployedKey
): string {
  const deployedDoc = parseDocument(deployedText)
  const deployedError = deployedDoc.errors[0]
  if (deployedError !== undefined) {
    throw new Error(`Invalid deployed omp ${name} YAML: ${deployedError.message}`)
  }

  const deployedContents = deployedDoc.contents
  if (
    deployedContents === null ||
    deployedContents === undefined ||
    (isScalar(deployedContents) && deployedContents.value === null)
  ) {
    return sotText
  }
  if (!isMap(deployedContents)) {
    throw new Error(`Deployed omp ${name} YAML root must be a mapping`)
  }

  const sotDoc = parseDocument(sotText)
  const sotError = sotDoc.errors[0]
  if (sotError !== undefined) {
    throw new Error(`Invalid SoT omp ${name} YAML: ${sotError.message}`)
  }
  if (!isMap(sotDoc.contents)) {
    throw new Error(`SoT omp ${name} YAML root must be a mapping`)
  }

  mergeMappings(sotDoc.contents, deployedContents, [], drop)
  return sotDoc.toString()
}

/** config.yml merge: keeps user-only keys, drops stale fallback-chain wildcards. */
export function mergeOmpConfig(sotText: string, deployedText: string): string {
  return mergeYamlDocuments(sotText, deployedText, "config.yml", dropFallbackWildcard)
}

/** models.yml merge: keeps every user-only key, including credentials and custom models. */
export function mergeOmpModels(sotText: string, deployedText: string): string {
  return mergeYamlDocuments(sotText, deployedText, "models.yml", keepEveryKey)
}
