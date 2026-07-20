/**
 * Unit layer for EngineNative modules (Effect standard: @effect/vitest).
 *
 * Two oracles for the settings merge:
 *   1. Semantics cases pinned by hand (SoT-wins, permissions union
 *      sorted+deduped, user-only keys preserved, nested env merge).
 *   2. jq differential — the legacy jq programs are inlined below as the
 *      test-only specification. jq remains a test-only dependency for this
 *      oracle and the suite skips it when jq is absent.
 */
import { describe, expect, it } from "@effect/vitest"
import { Effect } from "effect"
import { spawnSync } from "node:child_process"
import { readFileSync } from "node:fs"
import { join, resolve } from "node:path"
import { materializeClaudeSettings } from "../../src/engine-native/claudeRuntime"
import { deepMerge, isObject, jqStringify, parseJson, uniqueStrings, type Json } from "../../src/engine-native/jq"
import { mergeSettings, reconcileSettings } from "../../src/engine-native/settings"

const REPO_DIR = resolve(import.meta.dirname, "..", "..", "..")
const SOT_SETTINGS = parseJson(readFileSync(join(REPO_DIR, "SoT", ".claude", "settings.json"), "utf8"))!
const DRIFT_SETTINGS = parseJson(
  readFileSync(join(REPO_DIR, "cli", "test", "fixtures", "home-drift", ".claude", "settings.json"), "utf8")
)!

describe("jq primitives", () => {
  it.effect("deepMerge: right wins, objects recurse, arrays replaced", () =>
    Effect.sync(() => {
      const merged = deepMerge(
        { a: 1, env: { KEEP: "u", BOTH: "u" }, arr: [1, 2, 3] },
        { b: 2, env: { BOTH: "r", NEW: "r" }, arr: [9] }
      )
      expect(merged).toEqual({ a: 1, env: { KEEP: "u", BOTH: "r", NEW: "r" }, arr: [9], b: 2 })
    })
  )

  it.effect("deepMerge: key order is left-first then right-only appended (jq `*`)", () =>
    Effect.sync(() => {
      const merged = deepMerge({ z: 1, m: 2 }, { m: 3, a: 4 }) as Record<string, Json>
      expect(Object.keys(merged)).toEqual(["z", "m", "a"])
    })
  )

  it.effect("uniqueStrings: codepoint sort + dedup (jq `unique`)", () =>
    Effect.sync(() => {
      expect(uniqueStrings(["b", "a", "b", "A", "Z"])).toEqual(["A", "Z", "a", "b"])
    })
  )

  it.effect("parseJson: invalid input yields undefined (jq empty guard)", () =>
    Effect.sync(() => {
      const invalid = readFileSync(
        join(REPO_DIR, "cli", "test", "fixtures", "home-invalid-json", ".claude", "settings.json"),
        "utf8"
      )
      expect(parseJson(invalid)).toBeUndefined()
    })
  )
})

describe("settings merge semantics", () => {
  it.effect("keeps the authoring template sentinel-only and removes Stop", () =>
    Effect.sync(() => {
      if (!isObject(SOT_SETTINGS) || !isObject(SOT_SETTINGS["hooks"])) throw new Error("invalid SoT settings fixture")
      expect(SOT_SETTINGS["hooks"]["Stop"]).toBeUndefined()
      const text = JSON.stringify(SOT_SETTINGS)
      expect(text.match(/__DOCKS_KIT_BUN__/g)).toHaveLength(2)
      expect(text.match(/__DOCKS_KIT_SESSION_START__/g)).toHaveLength(1)
      expect(text.match(/__DOCKS_KIT_NOTIFY__/g)).toHaveLength(1)
      expect(text.match(/__DOCKS_KIT_STATUSLINE__/g)).toHaveLength(1)

      const deployed = materializeClaudeSettings(SOT_SETTINGS, {
        bun: "/home/test/.bun/bin/bun",
        statusline: "/home/test/.claude/bin/statusline.mjs",
        sessionStart: "/home/test/.claude/bin/session-start.mjs",
        notify: "/home/test/.claude/bin/notify.mjs"
      })
      expect(JSON.stringify(deployed)).not.toContain("__DOCKS_KIT_")
    })
  )

  it.effect("merge: SoT keys win, user-only keys survive, permissions unioned", () =>
    Effect.sync(() => {
      const merged = mergeSettings(SOT_SETTINGS, DRIFT_SETTINGS) as Record<string, Json>
      expect(merged["model"]).toEqual((SOT_SETTINGS as Record<string, Json>)["model"])
      expect((merged["env"] as Record<string, Json>)["MY_CUSTOM_VAR"]).toBe("1")
      const allow = (merged["permissions"] as Record<string, Json>)["allow"] as Array<string>
      expect(allow).toContain("Bash(my-tool *)")
      expect(allow).toEqual(uniqueStrings(allow)) // sorted + deduped like jq
    })
  )

  it.effect("reconcile: permissions arrays replaced wholesale by SoT", () =>
    Effect.sync(() => {
      const reconciled = reconcileSettings(SOT_SETTINGS, DRIFT_SETTINGS) as Record<string, Json>
      const sotAllow = ((SOT_SETTINGS as Record<string, Json>)["permissions"] as Record<string, Json>)["allow"]
      expect((reconciled["permissions"] as Record<string, Json>)["allow"]).toEqual(sotAllow)
      expect((reconciled["env"] as Record<string, Json>)["MY_CUSTOM_VAR"]).toBe("1")
    })
  )
})

// ------------------------------------------------------- jq differential ----

const JQ_MERGE = `
    .[0] as $repo | .[1] as $user |
    ($user * $repo) |
    .permissions.allow = (($user.permissions.allow // []) + ($repo.permissions.allow // []) | unique) |
    .permissions.deny  = (($user.permissions.deny  // []) + ($repo.permissions.deny  // []) | unique) |
    .permissions.ask   = (($user.permissions.ask   // []) + ($repo.permissions.ask   // []) | unique)
  `
const JQ_RECONCILE = `.[0] as $repo | .[1] as $user | $user * $repo`

function jqSlurp(program: string, docs: Array<Json>): string {
  const res = spawnSync("jq", ["-s", program], { input: docs.map((d) => JSON.stringify(d)).join("\n"), encoding: "utf8" })
  if (res.status !== 0) throw new Error(`jq failed: ${res.stderr}`)
  // Normalize line endings before comparing JSON structure, order, and format.
  return res.stdout.replaceAll("\r\n", "\n")
}

const hasJq = spawnSync("jq", ["--version"], { encoding: "utf8" }).status === 0

describe.skipIf(!hasJq)("jq differential (byte-for-byte vs inlined legacy programs)", () => {
  it("merge matches jq on SoT x drift fixture", () => {
    expect(jqStringify(mergeSettings(SOT_SETTINGS, DRIFT_SETTINGS))).toBe(
      jqSlurp(JQ_MERGE, [SOT_SETTINGS, DRIFT_SETTINGS])
    )
  })

  it("reconcile matches jq on SoT x drift fixture", () => {
    expect(jqStringify(reconcileSettings(SOT_SETTINGS, DRIFT_SETTINGS))).toBe(
      jqSlurp(JQ_RECONCILE, [SOT_SETTINGS, DRIFT_SETTINGS])
    )
  })

  it("merge matches jq when the user file has no permissions block", () => {
    const user: Json = { env: { ONLY: "user" } }
    expect(jqStringify(mergeSettings(SOT_SETTINGS, user))).toBe(jqSlurp(JQ_MERGE, [SOT_SETTINGS, user]))
  })
})
