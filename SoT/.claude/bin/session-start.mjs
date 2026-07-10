import { readFileSync } from "node:fs"
import { homedir } from "node:os"

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function nonEmpty(value, fallback) {
  return typeof value === "string" && value !== "" ? value : fallback
}

function pad(value) {
  return String(value).padStart(2, "0")
}

function configuredEffort(home, readText) {
  try {
    const parsed = JSON.parse(readText(`${home}/.claude/settings.json`))
    return isRecord(parsed) ? nonEmpty(parsed.effortLevel, "default") : "default"
  } catch {
    return "default"
  }
}

function localZone(now) {
  const part = new Intl.DateTimeFormat("en-US", { timeZoneName: "short" })
    .formatToParts(now)
    .find((value) => value.type === "timeZoneName")
  return part?.value ?? ""
}

export function sessionStartLines(options = {}) {
  const env = isRecord(options.env) ? options.env : process.env
  const now = options.now instanceof Date ? options.now : new Date()
  const home = typeof options.home === "string" ? options.home : homedir()
  const readText = options.readText ?? ((path) => readFileSync(path, "utf8"))
  const weekday = new Intl.DateTimeFormat("en-US", { weekday: "long" }).format(now)
  const date = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
  const time = `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`
  const effort = nonEmpty(env.CLAUDE_CODE_EFFORT_LEVEL, configuredEffort(home, readText))
  const context = env.CLAUDE_CODE_DISABLE_1M_CONTEXT === "1" ? "200K" : "1M"
  const compactWindow = nonEmpty(env.CLAUDE_CODE_AUTO_COMPACT_WINDOW, "full")
  const subagent = nonEmpty(env.CLAUDE_CODE_SUBAGENT_MODEL, "default")
  return [
    `[CONTEXT] Current date: ${weekday}, ${date} ${time} ${localZone(now)}`,
    `[CONFIG] Context: ${context} | Compact-window: ${compactWindow} | Effort: ${effort} | Thinking: adaptive | Subagent: ${subagent}`
  ]
}

export async function main(options = {}) {
  const writeStdout = options.writeStdout ?? ((value) => process.stdout.write(value))
  writeStdout(`${sessionStartLines(options).join("\n")}\n`)
  return 0
}

if (import.meta.main) process.exit(await main())
