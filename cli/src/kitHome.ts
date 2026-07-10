import { readFileSync } from "node:fs"
import { dirname, join, resolve } from "node:path"

const isKitHome = (dir: string): boolean => {
  try {
    const manifest = JSON.parse(readFileSync(join(dir, "package.json"), "utf8")) as { name?: unknown }
    return manifest.name === "docks-kit"
  } catch {
    return false
  }
}

/**
 * Resolve the optional checkout/package home used for display and updates:
 * DOCKS_KIT_HOME env → nearest ancestor of cwd (repo-checkout usage) →
 * the package's own root (bunx / bun add -g usage) → standalone executable
 * directory. Payload availability is independent of this location.
 */
export const kitHome = (): string => {
  const env = process.env["DOCKS_KIT_HOME"]
  if (env !== undefined && env !== "") {
    if (isKitHome(env)) return resolve(env)
    throw new Error(`DOCKS_KIT_HOME=${env} does not contain SoT/ + package.json`)
  }
  let dir = process.cwd()
  for (;;) {
    if (isKitHome(dir)) return dir
    const parent = dirname(dir)
    if (parent === dir) break
    dir = parent
  }
  const packageRoot = resolve(import.meta.dir, "..", "..")
  if (isKitHome(packageRoot)) return packageRoot
  return dirname(process.execPath)
}
