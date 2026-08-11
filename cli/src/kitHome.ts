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

const findKitHome = (start: string | undefined): string | undefined => {
  if (start === undefined || start === "") return undefined
  let dir = resolve(start)
  for (;;) {
    if (isKitHome(dir)) return dir
    const parent = dirname(dir)
    if (parent === dir) return undefined
    dir = parent
  }
}

export interface KitHomeSources {
  readonly env: string | undefined
  /** `import.meta.dir` is a Bun extension, so a non-Bun loader leaves it undefined. */
  readonly moduleDir: string | undefined
  readonly execPath: string
  readonly cwd: string
}

/**
 * Resolve DOCKS_KIT_HOME, then the nearest kit ancestor of the module,
 * executable, or working directory, then the executable directory. Running
 * installation sources take priority so an unrelated checkout cannot replace
 * the installation that is executing.
 */
export const resolveKitHome = (sources: KitHomeSources): string => {
  if (sources.env !== undefined && sources.env !== "") {
    const envHome = resolve(sources.env)
    if (isKitHome(envHome)) return envHome
    throw new Error(
      `DOCKS_KIT_HOME=${sources.env} is not a docks-kit package root (package.json name must be "docks-kit")`
    )
  }

  return (
    findKitHome(sources.moduleDir) ??
    findKitHome(dirname(sources.execPath)) ??
    findKitHome(sources.cwd) ??
    dirname(sources.execPath)
  )
}

export const kitHome = (): string =>
  resolveKitHome({
    env: process.env["DOCKS_KIT_HOME"],
    moduleDir: import.meta.dir,
    execPath: process.execPath,
    cwd: process.cwd()
  })
