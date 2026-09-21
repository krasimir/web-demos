#!/usr/bin/env bash
# Force-stops all demos, even if start-all.sh's own cleanup didn't catch
# them (e.g. a hung process, or the terminal was closed instead of Ctrl+C).
#
# It does two things:
#   1. Kills any leftover PIDs recorded by start-all.sh in .demo-pids.
#   2. Kills whatever is actually listening on the demo port range below,
#      which is what actually frees up the ports for a restart.
#
# Usage: ./stop-all.sh

set -uo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PID_FILE="$ROOT_DIR/.demo-pids"

# Demo ports currently live in 3001-3004 (see demos/*/server.js). Widened
# to leave headroom as more demos get added.
PORT_RANGE_START=3000
PORT_RANGE_END=3020

# 1. Kill recorded PIDs (and their process groups) from a normal start-all.sh run.
if [ -f "$PID_FILE" ]; then
  while read -r pid; do
    [ -n "$pid" ] || continue
    if kill -0 "$pid" 2>/dev/null; then
      echo "Killing pid $pid (and its group)..."
      kill -9 -- "-$pid" 2>/dev/null || kill -9 "$pid" 2>/dev/null
    fi
  done < "$PID_FILE"
  rm -f "$PID_FILE"
fi

# 2. Force-kill anything still bound to a demo port, regardless of how it
#    was started or whether we have its PID.
for port in $(seq "$PORT_RANGE_START" "$PORT_RANGE_END"); do
  pids=$(lsof -ti tcp:"$port" 2>/dev/null)
  [ -n "$pids" ] || continue
  for pid in $pids; do
    echo "Port $port still held by pid $pid — killing."
    kill -9 "$pid" 2>/dev/null
  done
done

echo "Done."
