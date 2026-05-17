#!/bin/bash
set -euo pipefail

SOUND="$HOME/.claude/alert_bubble.mp3"
[ -f "$SOUND" ] || exit 0

if [ "$(uname)" = "Darwin" ]; then
  command -v afplay >/dev/null 2>&1 && exec afplay "$SOUND"
fi

command -v ffplay >/dev/null 2>&1 && exec ffplay -nodisp -autoexit -loglevel quiet "$SOUND"
command -v paplay >/dev/null 2>&1 && exec paplay "$SOUND"
command -v aplay  >/dev/null 2>&1 && exec aplay -q "$SOUND"
exit 0
