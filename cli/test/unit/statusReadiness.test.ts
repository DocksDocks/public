import { describe, expect, it } from "vitest"

import { cleanup, makeStubDir, runEngine, runPublicCli } from "../lib/harness"

const readyCodex = `case "$1" in
  --version) echo "codex-cli 0.144.4";;
  plugin) case "$2" in
    list) echo '{"installed":[{"pluginId":"session-relay@docks","version":"0.11.0","installed":true,"enabled":true}],"available":[]}' ;;
    add) exit 0;;
  esac;;
esac`

const missingRelayCodex = `case "$1" in
  --version) echo "codex-cli 0.144.4";;
  plugin) case "$2" in
    list) echo '{"installed":[],"available":[]}' ;;
    add) exit 0;;
  esac;;
esac`

describe("status Session Relay readiness", () => {
  it("adds the closed readiness object to JSON and a new-session line to human output", () => {
    const stubDir = makeStubDir({ codex: readyCodex })
    const jsonRun = runPublicCli(["status", "--json"], "home-fresh", stubDir)
    const humanRun = runPublicCli(["status"], "home-fresh", stubDir)
    try {
      expect(jsonRun.exitCode).toBe(0)
      expect(JSON.parse(jsonRun.stdout).sessionRelayReadiness).toEqual({
        schema: 1,
        state: "ready",
        reason: null,
        version: "0.11.0",
        installed: true,
        enabled: true,
        scope: "new_sessions"
      })
      expect(humanRun.exitCode).toBe(0)
      expect(humanRun.stdout).toContain("Session Relay: ready for new Codex sessions (v0.11.0)")
    } finally {
      cleanup([])
    }
  }, 15_000)

  it("warns when refresh succeeds but the supported inventory cannot confirm Session Relay", () => {
    const stubDir = makeStubDir({ codex: missingRelayCodex })
    const run = runEngine("native", ["sync", "codex"], "home-fresh", stubDir)
    try {
      expect(run.exitCode).toBe(0)
      expect(run.output).toContain("Session Relay readiness unavailable after refresh: plugin_missing")
    } finally {
      cleanup([run])
    }
  })
})
