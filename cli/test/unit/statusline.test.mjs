import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { spawnSync as nodeSpawnSync } from "node:child_process"
import { describe, expect, it } from "vitest"
import { formatStatusline, main } from "../../../SoT/.claude/bin/statusline.mjs"

const REPO_DIR = resolve(import.meta.dirname, "..", "..", "..")
const SCRIPT = resolve(REPO_DIR, "SoT", ".claude", "bin", "statusline.mjs")
const FIXTURES = resolve(REPO_DIR, "cli", "test", "fixtures", "statusline")
const NOW_MS = 1_700_000_000_500

const MODEL = "\x1b[38;5;208m\x1b[1mOpus 4.7\x1b[22m\x1b[0m"
const PIPE = "\x1b[90m | \x1b[0m"
const DOT = "\x1b[90m • \x1b[0m"
const FOLDER = "\x1b[1m\x1b[38;2;76;208;222mrepo\x1b[22m\x1b[0m"
const BRANCH = "\x1b[1m\x1b[38;2;192;103;222mfeature/native\x1b[22m\x1b[0m"
const CONTEXT = "\x1b[38;2;130;160;230mctx 54%\x1b[0m"
const FIVE_HOUR = "\x1b[38;2;100;200;200m5h 22%\x1b[0m"
const SEVEN_DAY = "\x1b[38;2;230;180;90m7d 24%\x1b[0m"
const DIM_45_83 = " \x1b[2m\x1b[38;2;156;162;175m(45k/83k)\x1b[0m"
const DIM_1H = " \x1b[2m\x1b[38;2;156;162;175m(1h)\x1b[0m"
const DIM_2D = " \x1b[2m\x1b[38;2;156;162;175m(2d)\x1b[0m"

function fixture(name) {
  return JSON.parse(readFileSync(resolve(FIXTURES, name), "utf8"))
}

// Vitest workers run under Node; these deployed programs must be exercised by Bun.
function runDirect(input, options = {}) {
  return nodeSpawnSync("bun", [SCRIPT], { input, encoding: "utf8", ...options })
}

function plainPrefix(model, folder) {
  return `\x1b[38;5;208m\x1b[1m${model}\x1b[22m\x1b[0m${PIPE}\x1b[1m\x1b[38;2;76;208;222m${folder}\x1b[22m\x1b[0m`
}

describe("statusline native formatter", () => {
  it("renders the pinned full ANSI layout from native fields", () => {
    expect(formatStatusline(fixture("full-input.json"), {
      env: { CLAUDE_CODE_AUTO_COMPACT_WINDOW: "83001" },
      nowMs: NOW_MS,
      cwd: "/ignored",
      branch: "feature/native"
    })).toBe(`${MODEL}${PIPE}${FOLDER}${DOT}${BRANCH}${PIPE}${CONTEXT}${DIM_45_83}${PIPE}${FIVE_HOUR}${DIM_1H}${DOT}${SEVEN_DAY}${DIM_2D}`)
  })

  it.each([
    [22.5, "22"],
    [23.5, "24"],
    [24.5, "24"],
    [25.5, "26"]
  ])("uses shell-compatible half-even rounding for %s", (value, rounded) => {
    const input = {
      model: { display_name: "Test" },
      workspace: { current_dir: "/tmp/rounding" },
      context_window: { used_percentage: value },
      rate_limits: { five_hour: { used_percentage: value } }
    }
    const output = formatStatusline(input, { branch: "", cwd: "/tmp", env: {}, nowMs: NOW_MS })
    expect(output).toContain(`ctx ${rounded}%`)
    expect(output).toContain(`5h ${rounded}%`)
  })

  it("floors a non-thousand compact cap and ignores a sub-1000 cap", () => {
    const input = fixture("no-rate-limits.json")
    const capped = formatStatusline(input, { env: { CLAUDE_CODE_AUTO_COMPACT_WINDOW: "83001" }, branch: "", cwd: "/tmp", nowMs: NOW_MS })
    expect(capped).toContain("ctx 60%")
    expect(capped).toContain("(50k/83k)")

    const tooSmall = formatStatusline(input, { env: { CLAUDE_CODE_AUTO_COMPACT_WINDOW: "999" }, branch: "", cwd: "/tmp", nowMs: NOW_MS })
    expect(tooSmall).toContain("ctx 25%")
    expect(tooSmall).toContain("(50k/200k)")
  })

  it("keeps integral and fractional million token formatting", () => {
    const integral = formatStatusline({
      model: { display_name: "Test" },
      workspace: { current_dir: "/tmp/tokens" },
      context_window: { used_percentage: 100, context_window_size: 1_000_000 }
    }, { branch: "", cwd: "/tmp", env: {}, nowMs: NOW_MS })
    expect(integral).toContain("(1M/1M)")

    const fractional = formatStatusline({
      model: { display_name: "Test" },
      workspace: { current_dir: "/tmp/tokens" },
      context_window: { used_percentage: 100, context_window_size: 1_250_000 }
    }, { branch: "", cwd: "/tmp", env: {}, nowMs: NOW_MS })
    expect(fractional).toContain("(1.2M/1.2M)")
  })

  it("degrades each nullable rate-limit and context field independently", () => {
    const absent = formatStatusline(fixture("no-rate-limits.json"), { branch: "", cwd: "/tmp", env: {}, nowMs: NOW_MS })
    expect(absent).not.toContain("5h ")
    expect(absent).not.toContain("7d ")

    const early = formatStatusline(fixture("early-null.json"), { branch: "", cwd: "/tmp", env: {}, nowMs: NOW_MS })
    expect(early).toBe(plainPrefix("", "project"))

    const fiveOnly = formatStatusline({
      model: { display_name: "Test" },
      workspace: { current_dir: "/tmp/quota" },
      rate_limits: { five_hour: { used_percentage: 0, resets_at: null }, seven_day: null }
    }, { branch: "", cwd: "/tmp", env: {}, nowMs: NOW_MS })
    expect(fiveOnly).toContain("5h 0%")
    expect(fiveOnly).not.toContain(" • ")
    expect(fiveOnly).not.toContain("(")

    const sevenOnly = formatStatusline({
      model: { display_name: "Test" },
      workspace: { current_dir: "/tmp/quota" },
      rate_limits: { five_hour: { used_percentage: -1 }, seven_day: { used_percentage: 100, resets_at: -1 } }
    }, { branch: "", cwd: "/tmp", env: {}, nowMs: NOW_MS })
    expect(sevenOnly).not.toContain("5h ")
    expect(sevenOnly).toContain("7d 100%")
    expect(sevenOnly).not.toContain("(")
  })

  it("uses integer epoch seconds when now has nonzero milliseconds", () => {
    const output = formatStatusline({
      model: { display_name: "Test" },
      workspace: { current_dir: "/tmp/reset" },
      rate_limits: { five_hour: { used_percentage: 50, resets_at: 1_700_000_060 } }
    }, { branch: "", cwd: "/tmp", env: {}, nowMs: NOW_MS })
    expect(output).toContain("5h 50%")
    expect(output).toContain("(1m)")
  })

  it("narrows non-finite and malformed field values without widening the boundary", () => {
    const output = formatStatusline({
      model: { display_name: 12 },
      workspace: { current_dir: null },
      cwd: "C:\\Users\\First Last\\fallback",
      context_window: { used_percentage: Number.NaN, context_window_size: Infinity },
      rate_limits: {
        five_hour: { used_percentage: Infinity, resets_at: 1_700_000_000 },
        seven_day: { used_percentage: "20", resets_at: "later" }
      }
    }, { branch: "", cwd: "/process/cwd", env: {}, nowMs: NOW_MS })
    expect(output).toBe(plainPrefix("", "fallback"))
  })
})

describe("statusline program seam", () => {
  it("falls back from symbolic branch to detached HEAD without cache state", async () => {
    const calls = []
    const writes = []
    const code = await main({
      readStdin: async () => JSON.stringify({ model: { display_name: "Test" }, workspace: { current_dir: "/work/repo" } }),
      writeStdout: (value) => void writes.push(value),
      env: {},
      nowMs: NOW_MS,
      cwd: "/ignored",
      which: (name) => name === "git" ? "/usr/bin/git" : null,
      spawnSync: (argv) => {
        calls.push(argv)
        return calls.length === 1
          ? { success: false, stdout: Buffer.from("") }
          : { success: true, stdout: Buffer.from("abc123\n") }
      }
    })
    expect(code).toBe(0)
    expect(calls).toEqual([
      ["/usr/bin/git", "-C", "/work/repo", "symbolic-ref", "--short", "HEAD"],
      ["/usr/bin/git", "-C", "/work/repo", "rev-parse", "--short", "HEAD"]
    ])
    expect(writes).toEqual([`${plainPrefix("Test", "repo")}${DOT}\x1b[1m\x1b[38;2;192;103;222mabc123\x1b[22m\x1b[0m\n`])
  })

  it.each(["not json", "[]", "null", "42"])('returns silent success for invalid stdin %j', async (raw) => {
    const writes = []
    expect(await main({
      readStdin: async () => raw,
      writeStdout: (value) => void writes.push(value),
      env: {},
      nowMs: NOW_MS,
      cwd: "/tmp",
      which: () => null,
      spawnSync: () => { throw new Error("must not spawn") }
    })).toBe(0)
    expect(writes).toEqual([])
  })

  it("returns silent success when stdin cannot be read", async () => {
    const writes = []
    expect(await main({
      readStdin: async () => { throw new Error("read failed") },
      writeStdout: (value) => void writes.push(value),
      env: {},
      nowMs: NOW_MS,
      cwd: "/tmp",
      which: () => null,
      spawnSync: () => { throw new Error("must not spawn") }
    })).toBe(0)
    expect(writes).toEqual([])
  })

  it("direct-runs with one newline and empty stderr", () => {
    const input = fixture("no-rate-limits.json")
    input.workspace.current_dir = "/definitely/not/a/repository"
    const result = runDirect(JSON.stringify(input), {
      env: { ...process.env, CLAUDE_CODE_AUTO_COMPACT_WINDOW: "" }
    })
    expect(result.status).toBe(0)
    expect(result.stderr).toBe("")
    expect(result.stdout).toBe(`${plainPrefix("Sonnet 4.6", "repository")}${PIPE}\x1b[38;2;130;160;230mctx 25%\x1b[0m \x1b[2m\x1b[38;2;156;162;175m(50k/200k)\x1b[0m\n`)
  })

  it("keeps direct-Bun startup within its calibrated overhead budget", () => {
    const input = JSON.stringify({ model: { display_name: "Test" }, workspace: { current_dir: "/definitely/not/a/repository" } })
    const bareTimings = []
    const statuslineTimings = []
    for (let run = 0; run < 30; run += 1) {
      const measureBare = () => {
        const start = performance.now()
        const result = nodeSpawnSync("bun", ["-e", "void 0"], { encoding: "utf8" })
        bareTimings.push(performance.now() - start)
        expect(result.status).toBe(0)
        expect(result.stderr).toBe("")
        expect(result.stdout).toBe("")
      }
      const measureStatusline = () => {
        const start = performance.now()
        const result = runDirect(input)
        statuslineTimings.push(performance.now() - start)
        expect(result.status).toBe(0)
        expect(result.stderr).toBe("")
        expect(result.stdout).toBe(`${plainPrefix("Test", "repository")}\n`)
      }
      // Alternate the order so startup drift cannot systematically favor either process.
      if (run % 2 === 0) {
        measureBare()
        measureStatusline()
      } else {
        measureStatusline()
        measureBare()
      }
    }
    const medianAfterWarmup = (timings) => {
      const measured = timings.slice(5).sort((a, b) => a - b)
      return measured[Math.floor(measured.length / 2)]
    }
    const bareMedian = medianAfterWarmup(bareTimings)
    const statuslineMedian = medianAfterWarmup(statuslineTimings)
    const ceiling = Math.max(100, bareMedian + 75)
    expect(statuslineMedian).toBeLessThanOrEqual(ceiling)
  })
})
