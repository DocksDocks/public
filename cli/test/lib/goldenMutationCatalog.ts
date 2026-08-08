import { join } from "node:path"

import { FIXTURES_DIR } from "./goldenResources"
import { stableStringify } from "./goldenSnapshot"

export interface MutationMatrixCase {
  fixture: string
  cmd: Array<string>
  stubs?: Record<string, string | null>
  variant?: string
}

export interface MutationReplayCase {
  fixture: string
  cmd: Array<string>
  cmd2?: Array<string>
  variant?: string
}

// Stub-body variants for toolchain gate/install/upgrade/failure branches.
const RTK_INIT_FAILS = `case "$1" in --version) echo "rtk 0.43.0";; init) exit 1;; esac`
const AGENT_BROWSER_STALE = `case "$1" in --version) echo "agent-browser 0.30.0";; esac`
const NPM_INSTALL_FAILS = `case "$1" in
  view) case "$2" in agent-browser) echo "0.32.0";; esac;;
  install) exit 1;;
esac`
const NPM_LATEST_ABOVE_VERIFIED = `case "$1" in
  view) case "$2" in agent-browser) echo "0.99.0";; esac;;
esac`
const NPM_OFFLINE = `case "$1" in view) exit 1;; esac`
const LEGACY_CLAUDE_SETTINGS = stableStringify({
  hooks: {
    SessionStart: [{ hooks: [{ type: "command", command: "legacy-session", timeout: 5 }] }],
    Notification: [{ hooks: [{ type: "command", command: "legacy-notify", timeout: 10, async: true }] }],
    Stop: [{ hooks: [{ type: "command", command: "legacy-fetch", timeout: 5, async: true }] }]
  },
  statusLine: { type: "command", command: "legacy-statusline", refreshInterval: 5 },
  userOnly: "preserved"
})

export const LEGACY_CLAUDE_FILES = {
  ".claude/settings.json": LEGACY_CLAUDE_SETTINGS,
  ".claude/statusline.sh": "legacy-statusline-marker\n",
  ".claude/fetch-usage.sh": "legacy-fetch-marker\n",
  ".claude/hooks/notify.sh": "legacy-notify-marker\n"
}

// `variant` disambiguates rows whose fixture+cmd+stub-keys are identical but
// whose stub BODIES differ — without it their labels collide and the later
// row silently overwrites the earlier one's golden.
export const MATRIX: Array<MutationMatrixCase> = [
  { fixture: "home-fresh", cmd: ["sync", "claude"] },
  { fixture: "home-fresh", cmd: ["sync", "codex"] },
  { fixture: "home-fresh", cmd: ["sync", "agents"] },
  { fixture: "home-drift", cmd: ["sync", "claude"] },
  { fixture: "home-drift", cmd: ["sync", "codex"] },
  { fixture: "home-drift", cmd: ["sync", "agents"] },
  { fixture: "home-drift", cmd: ["sync", "--reconcile"] },
  { fixture: "home-drift", cmd: ["sync", "--prune"] },
  { fixture: "home-drift", cmd: ["sync", "claude", "--claude-effort=default"] },
  { fixture: "home-drift", cmd: ["sync", "claude", "--claude-advisor=on"] },
  { fixture: "home-drift", cmd: ["sync", "codex", "--codex-effort=ultra"] },
  { fixture: "home-drift", cmd: ["sync", "codex", "--codex-effort=default"] },
  { fixture: "home-fresh", cmd: ["sync", "claude", "--claude-effort"] },
  { fixture: "home-fresh", cmd: ["sync", "claude", "--claude-effort="] },
  { fixture: "home-fresh", cmd: ["sync", "claude", "--claude-effort=max"] },
  { fixture: "home-fresh", cmd: ["sync", "codex", "--codex-effort"] },
  { fixture: "home-fresh", cmd: ["sync", "codex", "--codex-effort="] },
  { fixture: "home-fresh", cmd: ["sync", "codex", "--codex-effort=future"] },
  { fixture: "home-fresh", cmd: ["sync", "claude", "--claude-advisor"] },
  { fixture: "home-fresh", cmd: ["sync", "claude", "--claude-advisor="] },
  { fixture: "home-fresh", cmd: ["sync", "claude", "--claude-advisor=maybe"] },
  {
    fixture: "home-fresh",
    cmd: ["sync", "agents", "--dry-run", "--claude-effort=low", "--claude-advisor=on", "--codex-effort=max"]
  },
  { fixture: "home-drift", cmd: ["sync", "claude", "--claude-plugin=supabase,n8n"] },
  {
    fixture: "home-drift",
    cmd: [
      "sync",
      "claude",
      "--claude-model=opus",
      "--claude-effort=low",
      "--claude-advisor=on",
      "--claude-compact-window=680k",
      "--claude-permissive"
    ]
  },
  { fixture: "home-drift", cmd: ["model", "claude", "opus"] },
  { fixture: "home-drift", cmd: ["model", "claude", "default"] },
  { fixture: "home-drift", cmd: ["model", "codex", "gpt-5.5"] },
  { fixture: "home-invalid-json", cmd: ["sync", "claude"] },
  { fixture: "home-fresh", cmd: ["toolchain", "ensure", "agent-browser"] },
  { fixture: "home-fresh", cmd: ["toolchain", "ensure", "agent-browser", "--verbose"] },
  { fixture: "home-fresh", cmd: ["toolchain", "ensure", "effect-solutions", "--yes"] },
  { fixture: "home-fresh", cmd: ["toolchain", "check"] },
  { fixture: "home-fresh", cmd: ["sync", "claude"], stubs: { rtk: RTK_INIT_FAILS } },
  { fixture: "home-fresh", cmd: ["sync", "claude"], stubs: { claude: null } },
  { fixture: "home-fresh", cmd: ["sync", "codex"], stubs: { codex: null } },
  { fixture: "home-fresh", cmd: ["sync", "claude"], stubs: { jq: null }, variant: "jq-absent-bun-hooks" },
  { fixture: "home-fresh", cmd: ["sync", "codex"], stubs: { jq: null }, variant: "jq-absent-native-sync" },
  {
    fixture: "home-fresh",
    cmd: ["sync", "claude"],
    stubs: { curl: null, rtk: null },
    variant: "curl-absent-rtk-bootstrap"
  },
  {
    fixture: "home-fresh",
    cmd: ["toolchain", "ensure", "rtk"],
    stubs: { curl: null, rtk: null },
    variant: "curl-absent-direct-rtk"
  },
  // Missing-git trio: uniform hint-bearing warn from the dependency registry;
  // the combined run must emit exactly ONE deduplicated git warn.
  { fixture: "home-fresh", cmd: ["sync", "claude"], stubs: { git: null } },
  { fixture: "home-fresh", cmd: ["sync", "codex"], stubs: { git: null } },
  { fixture: "home-fresh", cmd: ["sync"], stubs: { git: null } },
  {
    fixture: "home-fresh",
    cmd: ["toolchain", "ensure", "agent-browser"],
    stubs: { "agent-browser": AGENT_BROWSER_STALE }
  },
  {
    fixture: "home-fresh",
    cmd: ["toolchain", "ensure", "agent-browser"],
    stubs: { "agent-browser": null, npm: NPM_INSTALL_FAILS }
  },
  {
    fixture: "home-fresh",
    cmd: ["toolchain", "ensure", "agent-browser"],
    stubs: { npm: NPM_LATEST_ABOVE_VERIFIED },
    variant: "npm-latest-above-verified"
  },
  {
    fixture: "home-fresh",
    cmd: ["toolchain", "ensure", "agent-browser", "--yes"],
    stubs: { npm: NPM_LATEST_ABOVE_VERIFIED }
  },
  {
    fixture: "home-fresh",
    cmd: ["toolchain", "ensure", "agent-browser"],
    stubs: { npm: NPM_OFFLINE },
    variant: "npm-offline"
  }
]

/**
 * Sequential same-HOME replay rows — run the command twice against ONE home
 * and golden the SECOND run, so repeat-run output (the "already in sync"
 * surface) is pinned explicitly.
 */
export const REPLAYS: Array<MutationReplayCase> = [
  { fixture: "home-fresh", cmd: ["sync"] },
  { fixture: "home-drift", cmd: ["sync"] },
  // Verbose replay: the demoted no-op confirmations must come back.
  { fixture: "home-fresh", cmd: ["sync", "--verbose"] },
  // Model modifier as the ONLY second-run mutation: the restart advice must
  // print from the model trigger alone (everything else is already in sync).
  { fixture: "home-drift", cmd: ["sync", "claude"], cmd2: ["sync", "claude", "--claude-model=opus"] }
]

export const TOML_DIR = join(FIXTURES_DIR, "codex-toml")
export const TOML_SHAPES = [
  "01-top-level-comments.toml",
  "02-first-table-insert.toml",
  "03-features-only-landlock.toml",
  "04-features-extra-keys.toml",
  "05-user-tables.toml",
  "06-sot-table-replace.toml",
  "07-dotted-quoted-headers.toml"
]
