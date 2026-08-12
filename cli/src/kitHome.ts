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

const explicitKitHome = (dir: string, source: string): string => {
  const packageJson = join(dir, "package.json")
  let text: string
  try {
    text = readFileSync(packageJson, "utf8")
  } catch (error) {
    const code =
      typeof error === "object" && error !== null && "code" in error
        ? String(error.code)
        : undefined
    if (code === "ENOENT") {
      throw new Error(`DOCKS_KIT_HOME=${source} does not contain package.json`)
    }
    const detail = error instanceof Error ? error.message : String(error)
    const category = code === undefined ? "" : ` (${code})`
    throw new Error(
      `DOCKS_KIT_HOME=${source} package.json cannot be read${category}: ${detail}`
    )
  }

  let manifest: unknown
  try {
    manifest = JSON.parse(text)
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    throw new Error(`DOCKS_KIT_HOME=${source} package.json contains invalid JSON: ${detail}`)
  }

  if (
    typeof manifest !== "object" ||
    manifest === null ||
    !("name" in manifest) ||
    manifest.name !== "docks-kit"
  ) {
    throw new Error(
      `DOCKS_KIT_HOME=${source} is not a docks-kit package root (package.json name must be "docks-kit")`
    )
  }
  return dir
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
    return explicitKitHome(resolve(sources.env), sources.env)
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
