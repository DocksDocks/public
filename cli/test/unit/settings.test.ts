/**
 * Compare settings merge output with the jq programs that defined the
 * deployed merge contract. jq is optional on the host running unit tests.
 */
import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { jqStringify, parseJson, type Json } from "../../src/engine-native/jq";
import { mergeSettings, reconcileSettings } from "../../src/engine-native/settings";

const REPO_DIR = resolve(import.meta.dirname, "..", "..", "..");
const SOT_SETTINGS = parseJson(
  readFileSync(join(REPO_DIR, "SoT", ".claude", "settings.json"), "utf8"),
)!;
const DRIFT_SETTINGS = parseJson(
  readFileSync(
    join(REPO_DIR, "cli", "test", "fixtures", "home-drift", ".claude", "settings.json"),
    "utf8",
  ),
)!;

const JQ_MERGE = `
    .[0] as $repo | .[1] as $user |
    ($user * $repo) |
    .permissions.allow = (($user.permissions.allow // []) + ($repo.permissions.allow // []) | unique) |
    .permissions.deny  = (($user.permissions.deny  // []) + ($repo.permissions.deny  // []) | unique) |
    .permissions.ask   = (($user.permissions.ask   // []) + ($repo.permissions.ask   // []) | unique)
  `;
const JQ_RECONCILE = `.[0] as $repo | .[1] as $user | $user * $repo`;

function jqSlurp(program: string, docs: Array<Json>): string {
  const res = spawnSync("jq", ["-s", program], {
    input: docs.map((d) => JSON.stringify(d)).join("\n"),
    encoding: "utf8",
  });
  if (res.status !== 0) throw new Error(`jq failed: ${res.stderr}`);
  // Normalize line endings before comparing JSON structure, order, and format.
  return res.stdout.replaceAll("\r\n", "\n");
}

const hasJq = spawnSync("jq", ["--version"], { encoding: "utf8" }).status === 0;

describe.skipIf(!hasJq)("jq differential (byte-for-byte vs inlined legacy programs)", () => {
  it("merge matches jq on SoT x drift fixture", () => {
    expect(jqStringify(mergeSettings(SOT_SETTINGS, DRIFT_SETTINGS))).toBe(
      jqSlurp(JQ_MERGE, [SOT_SETTINGS, DRIFT_SETTINGS]),
    );
  });

  it("reconcile matches jq on SoT x drift fixture", () => {
    expect(jqStringify(reconcileSettings(SOT_SETTINGS, DRIFT_SETTINGS))).toBe(
      jqSlurp(JQ_RECONCILE, [SOT_SETTINGS, DRIFT_SETTINGS]),
    );
  });

  it("matches jq when neither document declares permissions", () => {
    const repo: Json = { env: { SHARED: "kit", NEW: "kit" }, hooks: { Start: ["kit"] } };
    const user: Json = {
      env: { SHARED: "user", KEEP: "user" },
      hooks: { Start: ["user"], Local: ["user"] },
      userOnly: true,
    };
    expect(jqStringify(mergeSettings(repo, user))).toBe(jqSlurp(JQ_MERGE, [repo, user]));
    expect(jqStringify(reconcileSettings(repo, user))).toBe(jqSlurp(JQ_RECONCILE, [repo, user]));
  });

  it("matches jq when all three permission arrays conflict", () => {
    const repo: Json = {
      permissions: { allow: ["B", "A"], deny: ["D", "B"], ask: ["Y", "X"] },
    };
    const user: Json = {
      permissions: { allow: ["A", "C"], deny: ["D", "A"], ask: ["X", "Z"] },
    };
    expect(jqStringify(mergeSettings(repo, user))).toBe(jqSlurp(JQ_MERGE, [repo, user]));
  });
});
