/**
 * `~/.claude/settings.json` merge helpers. Pure functions take the two parsed
 * documents and return the merged document; the FS step (backup, tmp+rename,
 * log line) lives in the sync orchestrator. jq-oracle equivalence is covered by
 * cli/test/unit/settings.test.ts and deployed behavior by the golden suites.
 */
import { deepMerge, isObject, uniqueStrings, type Json } from "./jq"

/** `$user * $repo` — SoT keys win, permissions arrays replaced wholesale. */
export function reconcileSettings(repo: Json, user: Json): Json {
  return deepMerge(user, repo)
}

/**
 * `($user * $repo)` + permissions.{allow,deny,ask} unioned (user + repo,
 * `unique` — i.e. codepoint-sorted and deduplicated, matching jq).
 */
export function mergeSettings(repo: Json, user: Json): Json {
  const merged = deepMerge(user, repo)
  if (!isObject(merged)) return merged
  const permissions = isObject(merged["permissions"]) ? merged["permissions"] : {}
  merged["permissions"] = {
    ...permissions,
    allow: unionPermissions(user, repo, "allow"),
    deny: unionPermissions(user, repo, "deny"),
    ask: unionPermissions(user, repo, "ask")
  }
  return merged
}

function unionPermissions(user: Json, repo: Json, key: string): Array<string> {
  return uniqueStrings([...permissionArray(user, key), ...permissionArray(repo, key)])
}

function permissionArray(doc: Json, key: string): Array<string> {
  if (!isObject(doc)) return []
  const permissions = doc["permissions"]
  if (!isObject(permissions)) return []
  const arr = permissions[key]
  return Array.isArray(arr) ? arr.filter((x): x is string => typeof x === "string") : []
}
