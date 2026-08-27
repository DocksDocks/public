/**
 * YAML merge for omp config.yml. omp serialises this file itself, so the kit
 * uses the yaml package rather than a line-based merge. Deployed-only keys are
 * retained except for slash-bearing keys directly under retry.fallbackChains:
 * omp treats those as model or provider wildcards ahead of role chains, so a
 * stale wildcard would silently override the kit-managed role chains.
 */
import { isMap, isScalar, parseDocument, type YAMLMap } from "yaml"

const fallbackChainsPath = ["retry", "fallbackChains"] as const

function stringKey(key: unknown): string | undefined {
  if (typeof key === "string") return key
  if (isScalar(key) && typeof key.value === "string") return key.value
  return undefined
}

function isFallbackChains(path: ReadonlyArray<string>): boolean {
  return (
    path.length === fallbackChainsPath.length &&
    path[0] === fallbackChainsPath[0] &&
    path[1] === fallbackChainsPath[1]
  )
}

function pruneFallbackWildcards(mapping: YAMLMap, path: ReadonlyArray<string>): void {
  const underFallbackChains = isFallbackChains(path)
  for (let index = mapping.items.length - 1; index >= 0; index--) {
    const pair = mapping.items[index]
    if (pair === undefined) continue

    const keyName = isScalar(pair.key) ? String(pair.key.value) : String(pair.key)
    if (underFallbackChains && keyName.includes("/")) {
      mapping.items.splice(index, 1)
      continue
    }

    const key = stringKey(pair.key)
    if (key !== undefined && isMap(pair.value)) {
      pruneFallbackWildcards(pair.value, [...path, key])
    }
  }
}

function mergeMappings(
  sotMapping: YAMLMap,
  deployedMapping: YAMLMap,
  path: ReadonlyArray<string>
): void {
  for (const sotPair of sotMapping.items) {
    const key = stringKey(sotPair.key)
    if (key === undefined) continue

    const deployedPair = deployedMapping.items.find((candidate) => stringKey(candidate.key) === key)
    if (deployedPair !== undefined && isMap(sotPair.value) && isMap(deployedPair.value)) {
      mergeMappings(sotPair.value, deployedPair.value, [...path, key])
    }
  }

  for (const deployedPair of deployedMapping.items) {
    const key = stringKey(deployedPair.key)
    const isManaged =
      key !== undefined && sotMapping.items.some((candidate) => stringKey(candidate.key) === key)
    if (isManaged) continue

    const keyName = isScalar(deployedPair.key)
      ? String(deployedPair.key.value)
      : String(deployedPair.key)
    if (isFallbackChains(path) && keyName.includes("/")) continue
    if (key !== undefined && isMap(deployedPair.value)) {
      pruneFallbackWildcards(deployedPair.value, [...path, key])
    }
    sotMapping.items.push(deployedPair)
  }
}

export function mergeOmpConfig(sotText: string, deployedText: string): string {
  const deployedDoc = parseDocument(deployedText)
  const deployedError = deployedDoc.errors[0]
  if (deployedError !== undefined) {
    throw new Error(`Invalid deployed omp config YAML: ${deployedError.message}`)
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
    throw new Error("Deployed omp config YAML root must be a mapping")
  }

  const sotDoc = parseDocument(sotText)
  const sotError = sotDoc.errors[0]
  if (sotError !== undefined) {
    throw new Error(`Invalid SoT omp config YAML: ${sotError.message}`)
  }
  if (!isMap(sotDoc.contents)) {
    throw new Error("SoT omp config YAML root must be a mapping")
  }

  mergeMappings(sotDoc.contents, deployedContents, [])
  return sotDoc.toString()
}
