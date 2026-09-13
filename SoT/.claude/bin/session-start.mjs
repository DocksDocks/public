/**
 * @typedef {string | number | boolean | JsonRecord | JsonArray | null | undefined} JsonValue
 * @typedef {{ [key: string]: JsonValue }} JsonRecord
 * @typedef {Array<JsonValue>} JsonArray
 * @typedef {Record<string, string | undefined> | JsonRecord} EnvInput
 * @typedef {object} SessionStartOptions
 * @property {EnvInput} [env]
 * @property {Date} [now]
 * @property {string} [home]
 * @property {(path: string) => string} [readText]
 * @property {(value: string) => void} [writeStdout]
 */
import { readFileSync } from "node:fs"
import { homedir } from "node:os"

/**
 * @param {object | string | number | boolean | null | undefined} value
 * @returns {value is JsonRecord}
 */
function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

/**
 * @param {JsonValue} value
 * @param {string} fallback
 * @returns {string}
 */
function nonEmpty(value, fallback) {
  return typeof value === "string" && value !== "" ? value : fallback
}

/**
 * @param {number} value
 * @returns {string}
 */
function pad(value) {
  return String(value).padStart(2, "0")
}

/**
 * @param {string} home
 * @param {(path: string) => string} readText
 * @returns {string}
 */
function configuredEffort(home, readText) {
  try {
    const parsed = JSON.parse(readText(`${home}/.claude/settings.json`))
    return isRecord(parsed) ? nonEmpty(parsed.effortLevel, "default") : "default"
  } catch {
    return "default"
  }
}

/**
 * @param {Date} now
 * @returns {string}
 */
function localZone(now) {
  const part = new Intl.DateTimeFormat("en-US", { timeZoneName: "short" })
    .formatToParts(now)
    .find((value) => value.type === "timeZoneName")
  return part?.value ?? ""
}

/**
 * @param {SessionStartOptions} [options]
 * @returns {string[]}
 */
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

/**
 * @param {SessionStartOptions} [options]
 * @returns {Promise<number>}
 */
export async function main(options = {}) {
  const writeStdout = options.writeStdout ?? ((value) => process.stdout.write(value))
  const output = {
    hookSpecificOutput: {
      hookEventName: "SessionStart",
      additionalContext: sessionStartLines(options).join("\n")
    }
  }
  writeStdout(`${JSON.stringify(output)}\n`)
  return 0
}

if (import.meta.main) process.exit(await main())
