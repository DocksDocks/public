import { existsSync } from "node:fs"
import { dirname, join, resolve } from "node:path"

const isKitHome = (dir: string): boolean =>
  existsSync(join(dir, "SoT")) && existsSync(join(dir, "package.json"))

/**
 * Resolve the kit home (the directory holding SoT/ + package.json):
 * DOCKS_KIT_HOME env → nearest ancestor of cwd (repo-checkout usage) →
 * the package's own root (bunx / bun add -g usage: main.ts lives at
 * <root>/cli/src, and the npm package bundles SoT/ alongside).
 */
export const kitHome = (): string => {
  const env = process.env["DOCKS_KIT_HOME"]
  if (env !== undefined && env !== "") {
    if (isKitHome(env)) return env
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
  throw new Error(
    "docks-kit home not found — run inside the kit repo or set DOCKS_KIT_HOME"
  )
}
