import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { basename, join, resolve } from "node:path"

import { claudeRuntimePaths, materializeClaudeSettings } from "../src/engine-native/claudeRuntime.ts"
import { makePlatform } from "../src/engine-native/services.ts"

const mode = process.argv[2] ?? "posix"
if (!["posix", "powershell", "git-bash"].includes(mode)) throw new Error(`unknown outer shell: ${mode}`)

const repo = resolve(import.meta.dir, "..", "..")
const root = mkdtempSync(join(tmpdir(), "statusline O'Brien-"))
const claudeDir = join(root, ".claude")
const binDir = join(claudeDir, "bin")
const decoder = new TextDecoder()

function record(argv, stdin, env = process.env) {
  const start = performance.now()
  const result = Bun.spawnSync(argv, {
    stdin: Buffer.from(stdin),
    stdout: "pipe",
    stderr: "pipe",
    env
  })
  return {
    elapsed: performance.now() - start,
    exitCode: result.exitCode,
    stdout: decoder.decode(result.stdout),
    stderr: decoder.decode(result.stderr)
  }
}

function assertRun(label, run, expectedStdout) {
  if (run.exitCode !== 0) throw new Error(`${label} exited ${run.exitCode}: ${run.stderr}`)
  if (run.stdout !== expectedStdout) {
    throw new Error(`${label} stdout mismatch\nexpected=${JSON.stringify(expectedStdout)}\nactual=${JSON.stringify(run.stdout)}`)
  }
  if (run.stderr !== "") throw new Error(`${label} stderr was not empty: ${JSON.stringify(run.stderr)}`)
}

function commandHandler(settings, event) {
  const handler = settings.hooks?.[event]?.[0]?.hooks?.[0]
  if (handler === undefined || typeof handler.command !== "string" || !Array.isArray(handler.args)) {
    throw new Error(`${event} direct handler is missing`)
  }
  return handler
}

function outerCommand(command) {
  if (mode === "posix") return ["bash", "-lc", command]
  if (mode === "powershell") return ["powershell.exe", "-NoProfile", "-NonInteractive", "-Command", command]
  return ["C:\\Program Files\\Git\\bin\\bash.exe", "-lc", command]
}

try {
  mkdirSync(binDir, { recursive: true })
  for (const file of ["statusline.mjs", "session-start.mjs", "notify.mjs"]) {
    copyFileSync(join(repo, "SoT", ".claude", "bin", file), join(binDir, file))
  }
  copyFileSync(join(repo, "notification.mp3"), join(claudeDir, "notification.mp3"))

  const bun = Bun.which("bun")
  if (bun === null || bun === "") throw new Error("bun executable was not resolved")
  if (process.platform === "win32" && !/\.exe$/i.test(bun)) throw new Error(`Windows Bun is not an .exe: ${bun}`)

  const template = JSON.parse(readFileSync(join(repo, "SoT", ".claude", "settings.json"), "utf8"))
  const runtime = claudeRuntimePaths(claudeDir, bun)
  const materialized = materializeClaudeSettings(template, runtime, makePlatform(process.platform))
  const settingsPath = join(claudeDir, "settings.json")
  writeFileSync(settingsPath, `${JSON.stringify(materialized, null, 2)}\n`)
  const settings = JSON.parse(readFileSync(settingsPath, "utf8"))
  if (JSON.stringify(settings).includes("__DOCKS_KIT_")) throw new Error("materialized settings contain a sentinel")
  if (settings.hooks?.Stop !== undefined) throw new Error("materialized settings contain hooks.Stop")

  const baseEnv = {
    ...process.env,
    HOME: root,
    USERPROFILE: root,
    CLAUDE_CODE_AUTO_COMPACT_WINDOW: "",
    TZ: "UTC"
  }

  const session = commandHandler(settings, "SessionStart")
  const sessionRun = record([session.command, ...session.args], "{}", baseEnv)
  if (sessionRun.exitCode !== 0 || sessionRun.stderr !== "") {
    throw new Error(`SessionStart failed: exit=${sessionRun.exitCode} stderr=${JSON.stringify(sessionRun.stderr)}`)
  }
  const sessionLines = sessionRun.stdout.trimEnd().split("\n")
  if (sessionLines.length !== 2 || !sessionLines[0].startsWith("[CONTEXT] Current date: ") || !sessionLines[1].startsWith("[CONFIG] Context: ")) {
    throw new Error(`SessionStart output shape mismatch: ${JSON.stringify(sessionRun.stdout)}`)
  }

  const notification = commandHandler(settings, "Notification")
  const notificationRun = record(
    [notification.command, ...notification.args],
    "{}",
    { ...baseEnv, PATH: "" }
  )
  assertRun("Notification", notificationRun, "")

  const input = {
    model: { display_name: "Opus 4.8 (1M context)" },
    workspace: { current_dir: root },
    context_window: { used_percentage: 25, context_window_size: 200000 },
    rate_limits: {
      five_hour: { used_percentage: 44, resets_at: null },
      seven_day: { used_percentage: 55, resets_at: null }
    }
  }
  const ESC = "\x1b["
  const PIPE = `${ESC}90m | ${ESC}0m`
  const DOT = `${ESC}90m • ${ESC}0m`
  const expected =
    `${ESC}38;5;208m${ESC}1mOpus 4.8${ESC}22m${ESC}0m` +
    `${PIPE}${ESC}1m${ESC}38;2;76;208;222m${basename(root)}${ESC}22m${ESC}0m` +
    `${PIPE}${ESC}38;2;130;160;230mctx 25%${ESC}0m ${ESC}2m${ESC}38;2;156;162;175m(50k/200k)${ESC}0m` +
    `${PIPE}${ESC}38;2;100;200;200m5h 44%${ESC}0m` +
    `${DOT}${ESC}38;2;230;180;90m7d 55%${ESC}0m\n`
  const stdin = JSON.stringify(input)
  if (mode !== "git-bash") {
    const directTimings = []
    for (let index = 0; index < 30; index += 1) {
      const run = record([runtime.bun, runtime.statusline], stdin, baseEnv)
      assertRun(`statusLine direct Bun run ${index + 1}`, run, expected)
      directTimings.push(run.elapsed)
    }
    const measuredDirect = directTimings.slice(5).sort((a, b) => a - b)
    const directP95 = measuredDirect[Math.ceil(measuredDirect.length * 0.95) - 1]
    const directCeiling = mode === "posix" ? 100 : 200
    if (directP95 > directCeiling) {
      throw new Error(`statusLine direct Bun p95 ${directP95.toFixed(2)}ms exceeds ${directCeiling}ms`)
    }
    console.log(`runtime-smoke: direct Bun exact bytes OK; p95=${directP95.toFixed(2)}ms ceiling=${directCeiling}ms`)
  }
  const timings = []
  for (let index = 0; index < 30; index += 1) {
    const run = record(outerCommand(settings.statusLine.command), stdin, baseEnv)
    assertRun(`statusLine ${mode} run ${index + 1}`, run, expected)
    timings.push(run.elapsed)
  }
  const measured = timings.slice(5).sort((a, b) => a - b)
  const p95 = measured[Math.ceil(measured.length * 0.95) - 1]
  const ceiling = mode === "posix" ? 250 : 750
  if (p95 > ceiling) throw new Error(`statusLine ${mode} p95 ${p95.toFixed(2)}ms exceeds ${ceiling}ms`)
  console.log(`runtime-smoke: ${mode} exact commands OK; p95=${p95.toFixed(2)}ms ceiling=${ceiling}ms`)
} finally {
  rmSync(root, { recursive: true, force: true })
}
