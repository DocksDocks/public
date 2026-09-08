import { readFileSync } from "node:fs"
import { join, resolve } from "node:path"

const REPO_DIR = resolve(import.meta.dirname, "..", "..", "..")

/**
 * Read a tool's `verified` version from `SoT/toolchain.json`.
 *
 * A test that asserts a kit-driven install must derive the version from the
 * manifest. A hardcoded literal decays on the next pin bump: the assertion
 * either fails for the wrong reason or, when the literal feeds a `replace` or
 * a fixture argument, keeps passing while it proves nothing.
 */
export function verifiedVersion(tool: string): string {
  const manifest: unknown = JSON.parse(readFileSync(join(REPO_DIR, "SoT", "toolchain.json"), "utf8"))
  if (manifest === null || typeof manifest !== "object" || !("tools" in manifest)) {
    throw new Error("toolchain manifest has no tools table")
  }
  const tools = manifest.tools
  if (tools === null || typeof tools !== "object" || !(tool in tools)) {
    throw new Error(`toolchain manifest has no ${tool} entry`)
  }
  const entry = (tools as Record<string, unknown>)[tool]
  if (entry === null || typeof entry !== "object" || !("verified" in entry)) {
    throw new Error(`toolchain entry ${tool} has no verified version`)
  }
  const verified = (entry as Record<string, unknown>)["verified"]
  if (typeof verified !== "string" || verified === "") {
    throw new Error(`toolchain entry ${tool} has a non-string verified version`)
  }
  return verified
}
