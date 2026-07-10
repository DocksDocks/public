const ESC = "\x1b["
const PIPE = `${ESC}90m | ${ESC}0m`
const DOT = `${ESC}90m • ${ESC}0m`
const DIM = `${ESC}2m${ESC}38;2;156;162;175m`

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function finitePercentage(value) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 100
    ? value
    : undefined
}

function roundHalfEven(value) {
  const lower = Math.floor(value)
  const fraction = value - lower
  if (fraction < 0.5) return lower
  if (fraction > 0.5) return lower + 1
  return lower % 2 === 0 ? lower : lower + 1
}

function pathBasename(path) {
  const parts = path.split(/[\\/]+/).filter((part) => part !== "")
  return parts.at(-1) ?? ""
}

function modelName(input) {
  const model = isRecord(input.model) && typeof input.model.display_name === "string"
    ? input.model.display_name
    : ""
  const suffix = model.indexOf(" (")
  return suffix === -1 ? model : model.slice(0, suffix)
}

function workingDirectory(input, cwd) {
  if (isRecord(input.workspace) && typeof input.workspace.current_dir === "string" && input.workspace.current_dir !== "") {
    return input.workspace.current_dir
  }
  if (typeof input.cwd === "string" && input.cwd !== "") return input.cwd
  return cwd
}

function compactWindow(env, total) {
  const raw = env.CLAUDE_CODE_AUTO_COMPACT_WINDOW
  if (typeof raw !== "string" || !/^[0-9]+$/.test(raw)) return total
  const parsed = Number(raw)
  return Number.isSafeInteger(parsed) && parsed >= 1000 && parsed < total ? parsed : total
}

function formatTokensK(value) {
  if (value < 1000) return `${value}k`
  if (value % 1000 === 0) return `${value / 1000}M`
  return `${(roundHalfEven(value / 100) / 10).toFixed(1)}M`
}

function contextSegment(input, env) {
  if (!isRecord(input.context_window)) return ""
  const used = finitePercentage(input.context_window.used_percentage)
  if (used === undefined) return ""

  const total = input.context_window.context_window_size
  if (typeof total !== "number" || !Number.isFinite(total) || total <= 0) {
    return `${ESC}38;2;130;160;230mctx ${roundHalfEven(used)}%${ESC}0m`
  }

  const usedK = roundHalfEven((used / 100) * (total / 1000))
  const effectiveK = Math.trunc(compactWindow(env, total) / 1000)
  if (effectiveK <= 0) return `${ESC}38;2;130;160;230mctx ${roundHalfEven(used)}%${ESC}0m`
  const effectivePercentage = roundHalfEven((usedK / effectiveK) * 100)
  return `${ESC}38;2;130;160;230mctx ${effectivePercentage}%${ESC}0m ${DIM}(${formatTokensK(usedK)}/${formatTokensK(effectiveK)})${ESC}0m`
}

function resetDelta(value, nowMs) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) return ""
  const seconds = Math.trunc(value) - Math.floor(nowMs / 1000)
  if (seconds <= 0) return "now"
  const days = Math.trunc(seconds / 86_400)
  if (days > 0) return `${days}d`
  const hours = Math.trunc((seconds % 86_400) / 3_600)
  if (hours > 0) return `${hours}h`
  return `${Math.trunc((seconds % 3_600) / 60)}m`
}

function quotaWindow(value, label, color, nowMs) {
  if (!isRecord(value)) return ""
  const used = finitePercentage(value.used_percentage)
  if (used === undefined) return ""
  const delta = resetDelta(value.resets_at, nowMs)
  const reset = delta === "" ? "" : ` ${DIM}(${delta})${ESC}0m`
  return `${ESC}38;2;${color}m${label} ${roundHalfEven(used)}%${ESC}0m${reset}`
}

function decodeStdout(result) {
  const stdout = result?.stdout
  if (stdout === undefined || stdout === null) return ""
  return typeof stdout === "string" ? stdout : stdout.toString()
}

function resolveBranch(directory, which, spawnSync) {
  const git = which("git")
  if (typeof git !== "string" || git === "") return ""
  const commands = [
    [git, "-C", directory, "symbolic-ref", "--short", "HEAD"],
    [git, "-C", directory, "rev-parse", "--short", "HEAD"]
  ]
  for (const command of commands) {
    try {
      const result = spawnSync(command, { stdin: "ignore", stdout: "pipe", stderr: "ignore" })
      if (result?.success === true) return decodeStdout(result).trim()
    } catch {
      return ""
    }
  }
  return ""
}

export function formatStatusline(input, options = {}) {
  if (!isRecord(input)) return ""
  const env = isRecord(options.env) ? options.env : process.env
  const nowMs = typeof options.nowMs === "number" ? options.nowMs : Date.now()
  const cwd = typeof options.cwd === "string" ? options.cwd : process.cwd()
  const branch = typeof options.branch === "string" ? options.branch : ""
  const directory = workingDirectory(input, cwd)

  const model = `${ESC}38;5;208m${ESC}1m${modelName(input)}${ESC}22m${ESC}0m`
  const folder = `${ESC}1m${ESC}38;2;76;208;222m${pathBasename(directory)}${ESC}22m${ESC}0m`
  const branchSegment = branch === "" ? "" : `${DOT}${ESC}1m${ESC}38;2;192;103;222m${branch}${ESC}22m${ESC}0m`
  const context = contextSegment(input, env)

  const rateLimits = isRecord(input.rate_limits) ? input.rate_limits : {}
  const fiveHour = quotaWindow(rateLimits.five_hour, "5h", "100;200;200", nowMs)
  const sevenDay = quotaWindow(rateLimits.seven_day, "7d", "230;180;90", nowMs)
  const quota = fiveHour === "" && sevenDay === ""
    ? ""
    : `${PIPE}${fiveHour}${fiveHour !== "" && sevenDay !== "" ? DOT : ""}${sevenDay}`

  return `${model}${PIPE}${folder}${branchSegment}${context === "" ? "" : `${PIPE}${context}`}${quota}`
}

export async function main(options = {}) {
  const readStdin = options.readStdin ?? (() => Bun.stdin.text())
  const writeStdout = options.writeStdout ?? ((value) => process.stdout.write(value))
  let raw
  try {
    raw = await readStdin()
  } catch {
    return 0
  }

  let input
  try {
    input = JSON.parse(raw)
  } catch {
    return 0
  }
  if (!isRecord(input)) return 0

  const cwd = typeof options.cwd === "string" ? options.cwd : process.cwd()
  const directory = workingDirectory(input, cwd)
  const branch = resolveBranch(
    directory,
    options.which ?? ((name) => Bun.which(name)),
    options.spawnSync ?? ((argv, spawnOptions) => Bun.spawnSync(argv, spawnOptions))
  )
  const output = formatStatusline(input, {
    env: options.env ?? process.env,
    nowMs: options.nowMs ?? Date.now(),
    cwd,
    branch
  })
  if (output !== "") writeStdout(`${output}\n`)
  return 0
}

if (import.meta.main) process.exit(await main())
