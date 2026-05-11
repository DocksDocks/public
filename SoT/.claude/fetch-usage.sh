#!/bin/bash
# Fetches Claude API usage stats and caches them locally.
# Called by Stop hook (async) to keep usage data fresh.
# Based on claude-watch (https://github.com/xleddyl/claude-watch).
# Cross-platform: works on both macOS and Linux.

exec 2>/dev/null

CACHE_FILE="/tmp/.claude_usage_cache"
TOKEN_CACHE="/tmp/.claude_token_cache"
CREDS_FILE="$HOME/.claude/.credentials.json"
TOKEN_MAX_AGE=900 # 15 minutes

# --- platform-aware file age ---
file_mtime() {
  if [ "$(uname)" = "Darwin" ]; then
    stat -f %m "$1" 2>/dev/null || echo 0
  else
    stat -c %Y "$1" 2>/dev/null || echo 0
  fi
}

# --- get access token (cached) ---
token=""
if [ -f "$TOKEN_CACHE" ]; then
  age=$(( $(date +%s) - $(file_mtime "$TOKEN_CACHE") ))
  if [ "$age" -lt "$TOKEN_MAX_AGE" ]; then
    token=$(cat "$TOKEN_CACHE")
  fi
fi

if [ -z "$token" ]; then
  # Try credentials file first (works everywhere)
  if [ -f "$CREDS_FILE" ]; then
    token=$(jq -r '.claudeAiOauth.accessToken // empty' "$CREDS_FILE")
  fi
  # Fallback: macOS Keychain
  if [ -z "$token" ] && command -v security >/dev/null 2>&1; then
    creds=$(security find-generic-password -s "Claude Code-credentials" -w 2>/dev/null)
    [ -n "$creds" ] && token=$(echo "$creds" | jq -r '.claudeAiOauth.accessToken // empty')
  fi
  [ -z "$token" ] && exit 0
  echo "$token" > "$TOKEN_CACHE"
fi

# --- fetch usage from API ---
response=$(curl -s --max-time 3 \
  -H "Authorization: Bearer $token" \
  -H "anthropic-beta: oauth-2025-04-20" \
  "https://api.anthropic.com/oauth/usage")

[ -z "$response" ] && exit 0

# --- parse and cache ---
five_h=$(echo "$response" | jq -r '.five_hour.utilization // empty' | awk '{printf "%.0f", $1}')
seven_d=$(echo "$response" | jq -r '.seven_day.utilization // empty' | awk '{printf "%.0f", $1}')
five_h_reset=$(echo "$response" | jq -r '.five_hour.resets_at // empty')
seven_d_reset=$(echo "$response" | jq -r '.seven_day.resets_at // empty')

# Only write if we got valid numeric data in 0-100 range (guards against
# silent cache corruption if the API schema changes)
if [ -n "$five_h" ] && [ -n "$seven_d" ] \
   && echo "$five_h"  | grep -qE '^[0-9]+$' && [ "$five_h"  -ge 0 ] && [ "$five_h"  -le 100 ] 2>/dev/null \
   && echo "$seven_d" | grep -qE '^[0-9]+$' && [ "$seven_d" -ge 0 ] && [ "$seven_d" -le 100 ] 2>/dev/null; then
  printf '%s\n%s\n%s\n%s\n' "$five_h" "$seven_d" "$five_h_reset" "$seven_d_reset" > "$CACHE_FILE"
fi
