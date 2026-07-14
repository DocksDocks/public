import { describe, expect, it } from "vitest"
import { classifySessionRelayReadiness } from "../../src/engine-native/sessionRelayReadiness"

const probe = (installed: ReadonlyArray<Record<string, unknown>>) => ({
  status: 0,
  stdout: JSON.stringify({ installed, available: [] }),
  errorCode: null
})

const relay = (overrides: Record<string, unknown> = {}) => ({
  pluginId: "session-relay@docks",
  name: "session-relay",
  marketplaceName: "docks",
  version: "0.11.0",
  installed: true,
  enabled: true,
  ...overrides
})

const unavailable = (
  reason: string,
  fields: { version?: string | null; installed?: boolean; enabled?: boolean } = {}
) => ({
  schema: 1,
  state: "unavailable",
  reason,
  version: fields.version ?? null,
  installed: fields.installed ?? false,
  enabled: fields.enabled ?? false,
  scope: "new_sessions"
})

describe("Session Relay readiness", () => {
  it("classifies a missing Codex CLI", () => {
    expect(classifySessionRelayReadiness({ status: null, stdout: "", errorCode: "ENOENT" })).toEqual(
      unavailable("codex_cli_unavailable")
    )
  })

  it("classifies a failed plugin-list command", () => {
    expect(classifySessionRelayReadiness({ status: 1, stdout: "", errorCode: null })).toEqual(
      unavailable("plugin_list_failed")
    )
  })

  it("rejects malformed or structurally invalid plugin-list output", () => {
    expect(classifySessionRelayReadiness({ status: 0, stdout: "not-json", errorCode: null })).toEqual(
      unavailable("invalid_plugin_list")
    )
    expect(classifySessionRelayReadiness({ status: 0, stdout: '{"installed":{}}', errorCode: null })).toEqual(
      unavailable("invalid_plugin_list")
    )
  })

  it("requires exactly one Session Relay row", () => {
    expect(classifySessionRelayReadiness(probe([]))).toEqual(unavailable("plugin_missing"))
    expect(classifySessionRelayReadiness(probe([relay(), relay()]))).toEqual(unavailable("plugin_ambiguous"))
  })

  it("distinguishes uninstalled and disabled rows", () => {
    expect(classifySessionRelayReadiness(probe([relay({ installed: false })]))).toEqual(
      unavailable("plugin_not_installed", { version: "0.11.0", enabled: true })
    )
    expect(classifySessionRelayReadiness(probe([relay({ enabled: false })]))).toEqual(
      unavailable("plugin_disabled", { version: "0.11.0", installed: true })
    )
  })

  it("reports one installed and enabled version as ready for new sessions", () => {
    expect(classifySessionRelayReadiness(probe([relay()]))).toEqual({
      schema: 1,
      state: "ready",
      reason: null,
      version: "0.11.0",
      installed: true,
      enabled: true,
      scope: "new_sessions"
    })
  })

  it("rejects a row without a non-empty version", () => {
    expect(classifySessionRelayReadiness(probe([relay({ version: "" })]))).toEqual(
      unavailable("invalid_plugin_list")
    )
  })
})
