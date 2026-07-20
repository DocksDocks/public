import { p } from "./exec"
import { isObject, parseJson, type Json } from "./jq"

const BUN_SENTINEL = "__DOCKS_KIT_BUN__"
const SESSION_START_SENTINEL = "__DOCKS_KIT_SESSION_START__"
const NOTIFY_SENTINEL = "__DOCKS_KIT_NOTIFY__"
const STATUSLINE_SENTINEL = "__DOCKS_KIT_STATUSLINE__"

export interface ClaudeRuntimePaths {
  readonly bun: string
  readonly statusline: string
  readonly sessionStart: string
  readonly notify: string
}

export function claudeRuntimePaths(claudeDir: string, bun: string): ClaudeRuntimePaths {
  return {
    bun,
    statusline: p(claudeDir, "bin", "statusline.mjs"),
    sessionStart: p(claudeDir, "bin", "session-start.mjs"),
    notify: p(claudeDir, "bin", "notify.mjs")
  }
}

function cloneJson(value: Json): Json {
  const cloned = parseJson(JSON.stringify(value))
  if (cloned === undefined) throw new Error("Claude settings template cannot be serialized")
  return cloned
}

function countString(value: Json, expected: string): number {
  if (value === expected) return 1
  if (Array.isArray(value)) return value.reduce<number>((total, item) => total + countString(item, expected), 0)
  if (!isObject(value)) return 0
  return Object.values(value).reduce<number>((total, item) => total + countString(item, expected), 0)
}

function hooksObject(template: Json): { [key: string]: Json } {
  if (!isObject(template) || !isObject(template["hooks"])) throw new Error("Claude settings hooks object is missing")
  return template["hooks"]
}

function commandHandler(template: Json, event: "SessionStart" | "Notification"): { [key: string]: Json } {
  const entries = hooksObject(template)[event]
  if (!Array.isArray(entries) || entries.length !== 1 || !isObject(entries[0])) {
    throw new Error(`${event} sentinel location is invalid`)
  }
  const handlers = entries[0]["hooks"]
  if (!Array.isArray(handlers) || handlers.length !== 1 || !isObject(handlers[0])) {
    throw new Error(`${event} sentinel handler is invalid`)
  }
  return handlers[0]
}

function oneArg(handler: { [key: string]: Json }, sentinel: string, event: string): void {
  const args = handler["args"]
  if (!Array.isArray(args) || args.length !== 1 || args[0] !== sentinel) {
    throw new Error(`${event} argument sentinel location is invalid`)
  }
}

function validateTemplate(template: Json): void {
  const sessionStart = commandHandler(template, "SessionStart")
  const notification = commandHandler(template, "Notification")
  if (sessionStart["command"] !== BUN_SENTINEL) throw new Error("SessionStart Bun sentinel location is invalid")
  if (notification["command"] !== BUN_SENTINEL) throw new Error("Notification Bun sentinel location is invalid")
  oneArg(sessionStart, SESSION_START_SENTINEL, "SessionStart")
  oneArg(notification, NOTIFY_SENTINEL, "Notification")

  const hooks = hooksObject(template)
  if (hooks["Stop"] !== undefined) throw new Error("hooks.Stop must be absent from the Claude settings template")
  if (!isObject(template) || !isObject(template["statusLine"]) || template["statusLine"]["command"] !== STATUSLINE_SENTINEL) {
    throw new Error("Statusline sentinel location is invalid")
  }
  const counts: ReadonlyArray<[string, string, number]> = [
    ["Bun", BUN_SENTINEL, 2],
    ["SessionStart", SESSION_START_SENTINEL, 1],
    ["notify", NOTIFY_SENTINEL, 1],
    ["statusline", STATUSLINE_SENTINEL, 1]
  ]
  for (const [label, sentinel, expected] of counts) {
    if (countString(template, sentinel) !== expected) throw new Error(`${label} sentinel residue/cardinality is invalid`)
  }
}

function posixLiteral(value: string): string {
  return `'${value.replaceAll("'", `'"'"'`)}'`
}

export function statusLineCommand(runtime: ClaudeRuntimePaths): string {
  const bun = posixLiteral(runtime.bun)
  const script = posixLiteral(runtime.statusline)
  return `test -x ${bun} && test -f ${script} && exec ${bun} ${script} || true`
}

export function materializeClaudeSettings(
  template: Json,
  runtime: ClaudeRuntimePaths | undefined
): Json {
  validateTemplate(template)
  const result = cloneJson(template)
  const hooks = hooksObject(result)
  if (runtime === undefined) {
    delete hooks["SessionStart"]
    delete hooks["Notification"]
    if (!isObject(result)) throw new Error("Claude settings template must be an object")
    delete result["statusLine"]
  } else {
    const sessionStart = commandHandler(result, "SessionStart")
    sessionStart["command"] = runtime.bun
    sessionStart["args"] = [runtime.sessionStart]
    const notification = commandHandler(result, "Notification")
    notification["command"] = runtime.bun
    notification["args"] = [runtime.notify]
    if (!isObject(result) || !isObject(result["statusLine"])) throw new Error("Claude statusLine object is missing")
    result["statusLine"]["command"] = statusLineCommand(runtime)
  }

  for (const sentinel of [BUN_SENTINEL, SESSION_START_SENTINEL, NOTIFY_SENTINEL, STATUSLINE_SENTINEL]) {
    if (countString(result, sentinel) !== 0) throw new Error(`Claude settings sentinel residue: ${sentinel}`)
  }
  return result
}
