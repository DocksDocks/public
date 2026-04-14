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
used=$(echo "$input" | jq -r '.context_window.used_percentage // empty')
ctx_str="" ctx_tokens_str=""
if [ -n "$used" ]; then
  used_int=$(printf "%.0f" "$used")
  ctx_str="${used_int}%"
  ctx_used=$(echo "$input" | jq -r '(.context_window.current_usage.cache_read_input_tokens + .context_window.current_usage.cache_creation_input_tokens + .context_window.current_usage.input_tokens + .context_window.current_usage.output_tokens) // empty' 2>/dev/null)
  ctx_total=$(echo "$input" | jq -r '.context_window.context_window_size // empty' 2>/dev/null)
  if [ -n "$ctx_used" ] && [ -n "$ctx_total" ]; then
    ctx_used_k=$(( ctx_used / 1000 ))
    ctx_total_k=$(( ctx_total / 1000 ))
    ctx_tokens_str="${ctx_used_k}k/${ctx_total_k}k"
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

# Line 2: usage | ctx
printf "\n"
if [ -n "$five_h" ]; then
  printf "\033[38;2;156;162;175m5h %s%%\033[0m" "$five_h"
  if [ -n "$five_h_reset" ]; then
    delta=$(compute_delta "$five_h_reset")
    [ -n "$delta" ] && printf " \033[2m\033[38;2;156;162;175m(%s)\033[0m" "$delta"
  fi
fi
if [ -n "$seven_d" ]; then
  [ -n "$five_h" ] && printf "%b" "$SEP"
  printf "\033[38;2;156;162;175m7d %s%%\033[0m" "$seven_d"
  if [ -n "$seven_d_reset" ]; then
    delta=$(compute_delta "$seven_d_reset")
    [ -n "$delta" ] && printf " \033[2m\033[38;2;156;162;175m(%s)\033[0m" "$delta"
  fi
fi
if [ -n "$ctx_str" ]; then
  printf "\033[90m | \033[0m"
  printf "\033[38;2;156;162;175mctx %s\033[0m" "$ctx_str"
  [ -n "$ctx_tokens_str" ] && printf " \033[2m\033[38;2;156;162;175m(%s)\033[0m" "$ctx_tokens_str"
fi
printf "\n"
