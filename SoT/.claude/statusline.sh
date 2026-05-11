#!/bin/bash
# Claude Code status line — two-line display inspired by claude-watch.
# Line 1: Model | folder • branch
# Line 2: 5h X% (Xh Xm) • 7d X% (Xd Xh) | ctx X% (Xk/Xk)
# Cross-platform: works on both macOS and Linux.

input=$(cat)

# --- platform-aware file age ---
file_mtime() {
  if [ "$(uname)" = "Darwin" ]; then
    stat -f %m "$1" 2>/dev/null || echo 0
  else
    stat -c %Y "$1" 2>/dev/null || echo 0
  fi
}

# --- platform-aware ISO date parsing ---
parse_epoch() {
  # GNU date (Linux)
  date -d "$1" +%s 2>/dev/null && return
  # BSD date (macOS): strip fractional seconds and timezone suffix
  local clean
  clean=$(echo "$1" | sed 's/\.[0-9]*//' | sed 's/[+-][0-9][0-9]:[0-9][0-9]$//' | sed 's/Z$//')
  date -j -f "%Y-%m-%dT%H:%M:%S" "$clean" "+%s" 2>/dev/null
}

# --- model ---
model=$(echo "$input" | jq -r '.model.display_name // ""')

# --- folder ---
dir=$(echo "$input" | jq -r '.workspace.current_dir // .cwd // ""')
dir_name=$(basename "$dir")

# --- git branch (cached 5s) ---
GIT_CACHE="/tmp/statusline-git-cache"
branch=""
cache_stale=1
if [ -f "$GIT_CACHE" ]; then
  age=$(( $(date +%s) - $(file_mtime "$GIT_CACHE") ))
  [ "$age" -lt 5 ] && cache_stale=0
fi
if [ "$cache_stale" -eq 1 ]; then
  if [ -d "${dir}/.git" ] || git -C "$dir" rev-parse --git-dir > /dev/null 2>&1; then
    branch=$(git -C "$dir" symbolic-ref --short HEAD 2>/dev/null || git -C "$dir" rev-parse --short HEAD 2>/dev/null)
  fi
  echo "$branch" > "$GIT_CACHE"
else
  branch=$(cat "$GIT_CACHE")
fi

# --- usage stats from cache ---
USAGE_CACHE="/tmp/.claude_usage_cache"
five_h="" seven_d="" five_h_reset="" seven_d_reset=""
if [ -f "$USAGE_CACHE" ]; then
  five_h=$(sed -n '1p' "$USAGE_CACHE")
  seven_d=$(sed -n '2p' "$USAGE_CACHE")
  five_h_reset=$(sed -n '3p' "$USAGE_CACHE")
  seven_d_reset=$(sed -n '4p' "$USAGE_CACHE")
else
  bash ~/.claude/fetch-usage.sh > /dev/null 2>&1 &
fi

# --- format token count in thousands → "Xk" under 1000, "XM"/"X.XM" at/above ---
format_tokens_k() {
  local k=$1
  if [ "$k" -ge 1000 ]; then
    if [ $((k % 1000)) -eq 0 ]; then
      echo "$((k / 1000))M"
    else
      awk -v k="$k" 'BEGIN { printf "%.1fM", k/1000 }'
    fi
  else
    echo "${k}k"
  fi
}

# --- time delta: ISO timestamp → human-readable countdown ---
compute_delta() {
  local ts="$1"
  [ -z "$ts" ] && return
  local reset_epoch now_epoch diff days hours minutes
  reset_epoch=$(parse_epoch "$ts")
  [ -z "$reset_epoch" ] && return
  now_epoch=$(date -u +%s)
  diff=$(( reset_epoch - now_epoch ))
  [ "$diff" -le 0 ] && echo "now" && return
  days=$(( diff / 86400 ))
  hours=$(( (diff % 86400) / 3600 ))
  minutes=$(( (diff % 3600) / 60 ))
  if [ "$days" -gt 0 ]; then
    echo "${days}d ${hours}h"
  elif [ "$hours" -gt 0 ]; then
    echo "${hours}h ${minutes}m"
  else
    echo "${minutes}m"
  fi
}

# --- context window ---
# Anthropic's used_percentage is always vs the model's full context window
# (per env-vars docs). When CLAUDE_CODE_AUTO_COMPACT_WINDOW caps the effective
# window (e.g. 400K on a 1M model), recompute the bar against that cap so
# `ctx 95%` actually means "autocompact imminent".
used=$(echo "$input" | jq -r '.context_window.used_percentage // empty')
ctx_str="" ctx_tokens_str=""
if [ -n "$used" ]; then
  ctx_total=$(echo "$input" | jq -r '.context_window.context_window_size // empty' 2>/dev/null)
  if [ -n "$ctx_total" ]; then
    ctx_used_k=$(awk -v p="$used" -v t="$ctx_total" 'BEGIN { printf "%.0f", (p/100) * (t/1000) }')

    effective_total=$ctx_total
    if [ -n "$CLAUDE_CODE_AUTO_COMPACT_WINDOW" ] \
       && [ "$CLAUDE_CODE_AUTO_COMPACT_WINDOW" -lt "$ctx_total" ]; then
      effective_total=$CLAUDE_CODE_AUTO_COMPACT_WINDOW
    fi
    effective_total_k=$(( effective_total / 1000 ))

    if [ "$effective_total_k" -gt 0 ]; then
      effective_pct=$(awk -v u="$ctx_used_k" -v t="$effective_total_k" 'BEGIN { printf "%.0f", (u/t) * 100 }')
      ctx_str="${effective_pct}%"
    fi
    ctx_tokens_str="$(format_tokens_k "$ctx_used_k")/$(format_tokens_k "$effective_total_k")"
  else
    ctx_str="$(printf '%.0f%%' "$used")"
  fi
fi

# --- assemble output ---
SEP="\033[90m • \033[0m"

# Line 1: model | folder • branch
printf "\033[38;5;208m\033[1m%s\033[22m\033[0m" "$model"
printf "\033[90m | \033[0m"
printf "\033[1m\033[38;2;76;208;222m%s\033[22m\033[0m" "$dir_name"
if [ -n "$branch" ]; then
  printf "%b" "$SEP"
  printf "\033[1m\033[38;2;192;103;222m%s\033[22m\033[0m" "$branch"
fi

# Single-line: usage section opens with separator (ctx has its own | below)
if [ -n "$five_h" ] || [ -n "$seven_d" ]; then
  printf "\033[90m | \033[0m"
fi
if [ -n "$five_h" ]; then
  printf "\033[38;2;100;200;200m5h %s%%\033[0m" "$five_h"
  if [ -n "$five_h_reset" ]; then
    delta=$(compute_delta "$five_h_reset")
    [ -n "$delta" ] && printf " \033[2m\033[38;2;156;162;175m(%s)\033[0m" "$delta"
  fi
fi
if [ -n "$seven_d" ]; then
  [ -n "$five_h" ] && printf "%b" "$SEP"
  printf "\033[38;2;230;180;90m7d %s%%\033[0m" "$seven_d"
  if [ -n "$seven_d_reset" ]; then
    delta=$(compute_delta "$seven_d_reset")
    [ -n "$delta" ] && printf " \033[2m\033[38;2;156;162;175m(%s)\033[0m" "$delta"
  fi
fi
if [ -n "$ctx_str" ]; then
  printf "\033[90m | \033[0m"
  printf "\033[38;2;130;160;230mctx %s\033[0m" "$ctx_str"
  [ -n "$ctx_tokens_str" ] && printf " \033[2m\033[38;2;156;162;175m(%s)\033[0m" "$ctx_tokens_str"
fi
printf "\n"
