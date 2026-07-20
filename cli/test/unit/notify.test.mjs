import { resolve } from "node:path"
import { spawnSync as nodeSpawnSync } from "node:child_process"
import { describe, expect, it, vi } from "vitest"
import { main, selectPlayer } from "../../../SoT/.claude/bin/notify.mjs"

const REPO_DIR = resolve(import.meta.dirname, "..", "..", "..")
const SCRIPT = resolve(REPO_DIR, "SoT", ".claude", "bin", "notify.mjs")
const SOUND = "/home/test/.claude/notification.mp3"

function whichFrom(names) {
  return (name) => names.includes(name) ? `/usr/bin/${name}` : null
}

describe("Notification player selection", () => {
  it("prefers afplay on Darwin", () => {
    expect(selectPlayer({ platform: "darwin", sound: SOUND, which: whichFrom(["afplay", "ffplay"]) })).toEqual([
      "/usr/bin/afplay",
      SOUND
    ])
  })

  it("uses ffplay then paplay then aplay priority elsewhere", () => {
    expect(selectPlayer({ platform: "linux", sound: SOUND, which: whichFrom(["ffplay", "paplay", "aplay"]) })).toEqual([
      "/usr/bin/ffplay",
      "-nodisp",
      "-autoexit",
      "-loglevel",
      "quiet",
      SOUND
    ])
    expect(selectPlayer({ platform: "linux", sound: SOUND, which: whichFrom(["paplay", "aplay"]) })).toEqual(["/usr/bin/paplay", SOUND])
    expect(selectPlayer({ platform: "linux", sound: SOUND, which: () => null })).toBeUndefined()
  })
})

describe("Notification program seam", () => {
  it("spawns the selected player with all channels ignored", async () => {
    const spawnSync = vi.fn(() => ({ exitCode: 0 }))
    expect(await main({
      platform: "linux",
      sound: SOUND,
      fileExists: async () => true,
      which: whichFrom(["paplay"]),
      spawnSync
    })).toBe(0)
    expect(spawnSync).toHaveBeenCalledWith(["/usr/bin/paplay", SOUND], {
      stdin: "ignore",
      stdout: "ignore",
      stderr: "ignore"
    })
  })

  it("returns a selected player failure without falling through", async () => {
    const spawnSync = vi.fn(() => ({ exitCode: 7 }))
    expect(await main({
      platform: "linux",
      sound: SOUND,
      fileExists: async () => true,
      which: whichFrom(["ffplay", "paplay"]),
      spawnSync
    })).toBe(7)
    expect(spawnSync).toHaveBeenCalledTimes(1)
  })

  it("is a silent no-op for missing audio or no player", async () => {
    const spawnSync = vi.fn()
    expect(await main({
      platform: "linux",
      sound: SOUND,
      fileExists: async () => false,
      which: whichFrom(["paplay"]),
      spawnSync
    })).toBe(0)
    expect(await main({
      platform: "linux",
      sound: SOUND,
      fileExists: async () => true,
      which: () => null,
      spawnSync
    })).toBe(0)
    expect(spawnSync).not.toHaveBeenCalled()
  })

  it("direct-runs silently when authoring audio is absent", () => {
    const result = nodeSpawnSync("bun", [SCRIPT], { encoding: "utf8" })
    expect(result.status).toBe(0)
    expect(result.stdout).toBe("")
    expect(result.stderr).toBe("")
  })
})
