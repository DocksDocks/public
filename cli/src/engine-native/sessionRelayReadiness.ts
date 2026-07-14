import { spawnSync } from "node:child_process"

import { isObject, parseJson } from "./jq"

const SESSION_RELAY_PLUGIN_ID = "session-relay@docks"

export type SessionRelayReadinessReason =
  | "codex_cli_unavailable"
  | "plugin_list_failed"
  | "invalid_plugin_list"
  | "plugin_missing"
  | "plugin_ambiguous"
  | "plugin_not_installed"
  | "plugin_disabled"

export interface SessionRelayReadiness {
  readonly schema: 1
  readonly state: "ready" | "unavailable"
  readonly reason: SessionRelayReadinessReason | null
  readonly version: string | null
  readonly installed: boolean
  readonly enabled: boolean
  readonly scope: "new_sessions"
}

export interface CodexPluginListProbe {
  readonly status: number | null
  readonly stdout: string
  readonly errorCode: string | null
}

function unavailable(
  reason: SessionRelayReadinessReason,
  fields: { version?: string | null; installed?: boolean; enabled?: boolean } = {}
): SessionRelayReadiness {
  return {
    schema: 1,
    state: "unavailable",
    reason,
    version: fields.version ?? null,
    installed: fields.installed ?? false,
    enabled: fields.enabled ?? false,
    scope: "new_sessions"
  }
}

export function classifySessionRelayReadiness(probe: CodexPluginListProbe): SessionRelayReadiness {
  if (probe.errorCode === "ENOENT") return unavailable("codex_cli_unavailable")
  if (probe.errorCode !== null || probe.status !== 0) return unavailable("plugin_list_failed")

  const value = parseJson(probe.stdout)
  if (value === undefined || !isObject(value) || !Array.isArray(value["installed"])) {
    return unavailable("invalid_plugin_list")
  }

  const matches = value["installed"].filter(
    (entry) => isObject(entry) && entry["pluginId"] === SESSION_RELAY_PLUGIN_ID
  )
  if (matches.length === 0) return unavailable("plugin_missing")
  if (matches.length !== 1) return unavailable("plugin_ambiguous")

  const row = matches[0]
  if (row === undefined || !isObject(row)) return unavailable("invalid_plugin_list")
  const version = row["version"]
  const installed = row["installed"]
  const enabled = row["enabled"]
  if (typeof version !== "string" || version.length === 0 || typeof installed !== "boolean" || typeof enabled !== "boolean") {
    return unavailable("invalid_plugin_list")
  }
  if (!installed) return unavailable("plugin_not_installed", { version, enabled })
  if (!enabled) return unavailable("plugin_disabled", { version, installed })

  return {
    schema: 1,
    state: "ready",
    reason: null,
    version,
    installed,
    enabled,
    scope: "new_sessions"
  }
}

export function sessionRelayReadiness(): SessionRelayReadiness {
  const result = spawnSync("codex", ["plugin", "list", "--json"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"]
  })
  return classifySessionRelayReadiness({
    status: result.status,
    stdout: result.stdout ?? "",
    errorCode: (result.error as NodeJS.ErrnoException | undefined)?.code ?? null
  })
}
