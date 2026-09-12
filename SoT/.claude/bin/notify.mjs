/**
 * @typedef {(name: string) => string | null | undefined} WhichFn
 * @typedef {(path: string) => Promise<boolean>} FileExistsFn
 * @typedef {object} QuietSpawnOptions
 * @property {"ignore" | "pipe" | "inherit"} [stdin]
 * @property {"ignore" | "pipe" | "inherit"} [stdout]
 * @property {"ignore" | "pipe" | "inherit"} [stderr]
 * @typedef {(argv: string[], options: QuietSpawnOptions) => void} QuietSpawner
 * @typedef {object} PlayerOptions
 * @property {string} [platform]
 * @property {string} [sound]
 * @property {WhichFn} [which]
 * @typedef {object} NotifyOptions
 * @property {string} [platform]
 * @property {string} [sound]
 * @property {WhichFn} [which]
 * @property {FileExistsFn} [fileExists]
 * @property {QuietSpawner} [spawnSync]
 */
const DEFAULT_SOUND = `${import.meta.dir}/../notification.mp3`

/**
 * @param {PlayerOptions} [options]
 * @returns {string[] | undefined}
 */
export function selectPlayer(options = {}) {
  const platform = options.platform ?? process.platform
  const sound = options.sound ?? DEFAULT_SOUND
  const which = options.which ?? ((name) => Bun.which(name))
  if (platform === "darwin") {
    const afplay = which("afplay")
    if (typeof afplay === "string" && afplay !== "") return [afplay, sound]
  }
  const ffplay = which("ffplay")
  if (typeof ffplay === "string" && ffplay !== "") {
    return [ffplay, "-nodisp", "-autoexit", "-loglevel", "quiet", sound]
  }
  const paplay = which("paplay")
  if (typeof paplay === "string" && paplay !== "") return [paplay, sound]
  const aplay = which("aplay")
  if (typeof aplay === "string" && aplay !== "") return [aplay, "-q", sound]
  return undefined
}

/**
 * @param {NotifyOptions} [options]
 * @returns {Promise<number>}
 */
export async function main(options = {}) {
  const sound = options.sound ?? DEFAULT_SOUND
  const fileExists = options.fileExists ?? ((path) => Bun.file(path).exists())
  if (!await fileExists(sound)) return 0
  const command = selectPlayer({ ...options, sound })
  if (command === undefined) return 0
  const spawnSync = options.spawnSync ?? ((argv, spawnOptions) => Bun.spawnSync(argv, spawnOptions))
  spawnSync(command, { stdin: "ignore", stdout: "ignore", stderr: "ignore" })
  return 0
}

if (import.meta.main) process.exit(await main())
