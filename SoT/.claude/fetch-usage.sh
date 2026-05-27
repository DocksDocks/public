#!/bin/bash
# Async Stop hook: refreshes the /oauth/usage stats the statusline reads.

exec 2>/dev/null

CACHE_FILE="/tmp/.claude_usage_cache"
TOKEN_CACHE="/tmp/.claude_token_cache"
CREDS_FILE="$HOME/.claude/.credentials.json"
TOKEN_MAX_AGE=900 # 15 minutes

file_mtime() {
  if [ "$(uname)" = "Darwin" ]; then
    stat -f %m "$1" 2>/dev/null || echo 0
  else
    stat -c %Y "$1" 2>/dev/null || echo 0
  fi
}

# Newer credentials than the usage cache => possible account switch; drop it to avoid showing the previous account.
if [ -f "$CACHE_FILE" ] && [ -f "$CREDS_FILE" ] \
   && [ "$(file_mtime "$CREDS_FILE")" -ge "$(file_mtime "$CACHE_FILE")" ]; then
  rm -f "$CACHE_FILE"
fi

token=""
if [ -f "$TOKEN_CACHE" ]; then
  cache_mtime=$(file_mtime "$TOKEN_CACHE")
  age=$(( $(date +%s) - cache_mtime ))
  creds_mtime=0
  [ -f "$CREDS_FILE" ] && creds_mtime=$(file_mtime "$CREDS_FILE")
  if [ "$age" -lt "$TOKEN_MAX_AGE" ] && [ "$creds_mtime" -lt "$cache_mtime" ]; then
    token=$(cat "$TOKEN_CACHE")
  fi
fi

if [ -z "$token" ]; then
  if [ -f "$CREDS_FILE" ]; then
    token=$(jq -r '.claudeAiOauth.accessToken // empty' "$CREDS_FILE")
  fi
  # macOS Keychain fallback
  if [ -z "$token" ] && command -v security >/dev/null 2>&1; then
    creds=$(security find-generic-password -s "Claude Code-credentials" -w 2>/dev/null)
    [ -n "$creds" ] && token=$(echo "$creds" | jq -r '.claudeAiOauth.accessToken // empty')
  fi
  [ -z "$token" ] && exit 0
  echo "$token" > "$TOKEN_CACHE"
fi

response=$(curl -s --max-time 3 \
  -H "Authorization: Bearer $token" \
  -H "anthropic-beta: oauth-2025-04-20" \
  "https://api.anthropic.com/oauth/usage")

[ -z "$response" ] && exit 0

five_h=$(echo "$response" | jq -r '.five_hour.utilization // empty' | awk '{printf "%.0f", $1}')
seven_d=$(echo "$response" | jq -r '.seven_day.utilization // empty' | awk '{printf "%.0f", $1}')
five_h_reset=$(echo "$response" | jq -r '.five_hour.resets_at // empty')
seven_d_reset=$(echo "$response" | jq -r '.seven_day.resets_at // empty')

# Numeric-range guard: a schema change would otherwise poison the cache silently.
if [ -n "$five_h" ] && [ -n "$seven_d" ] \
   && echo "$five_h"  | grep -qE '^[0-9]+$' && [ "$five_h"  -ge 0 ] && [ "$five_h"  -le 100 ] 2>/dev/null \
   && echo "$seven_d" | grep -qE '^[0-9]+$' && [ "$seven_d" -ge 0 ] && [ "$seven_d" -le 100 ] 2>/dev/null; then
  printf '%s\n%s\n%s\n%s\n' "$five_h" "$seven_d" "$five_h_reset" "$seven_d_reset" > "$CACHE_FILE"
fi
