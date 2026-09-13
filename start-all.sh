#!/usr/bin/env bash
# Starts every demo under demos/ (each via `npm run start`) and lets you
# kill them all together with Ctrl+C (or by killing this script).
#
# Usage:
#   ./start-all.sh          # start all demos, logs to .demo-logs/<name>.log
#   Ctrl+C, or `kill <pid>` on this script, stops everything.
#   If something hangs and ports stay locked, run ./stop-all.sh to force it.

set -uo pipefail
set -m  # job control: each backgrounded demo gets its own process group,
        # so killing the group also kills npm's child (node server.js)

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEMOS_DIR="$ROOT_DIR/demos"
LOG_DIR="$ROOT_DIR/.demo-logs"
PID_FILE="$ROOT_DIR/.demo-pids"

mkdir -p "$LOG_DIR"
: > "$PID_FILE"

pids=()

cleaned_up=0
cleanup() {
  [ "$cleaned_up" = 1 ] && return
  cleaned_up=1
  echo
  echo "Stopping all demos..."
  for pid in "${pids[@]}"; do
    if kill -0 "$pid" 2>/dev/null; then
      kill -- "-$pid" 2>/dev/null || kill "$pid" 2>/dev/null
    fi
  done
  rm -f "$PID_FILE"
}
trap cleanup EXIT INT TERM

for demo_path in "$DEMOS_DIR"/*/; do
  name="$(basename "$demo_path")"
  [ -f "$demo_path/package.json" ] || continue

  echo "Starting $name..."
  # Wrapped in an outer subshell so the *whole* pipeline (npm, tee, sed)
  # shares one process group whose leader's PID is $!, which is what
  # cleanup()'s `kill -- -$pid` needs to take the whole thing down.
  (
    (cd "$demo_path" && npm run start) 2>&1 \
      | tee "$LOG_DIR/$name.log" \
      | sed -u -e "s/^/[$name] /"
  ) &
  pid=$!
  pids+=("$pid")
  echo "$pid" >> "$PID_FILE"
  echo "  -> pid $pid, log: $LOG_DIR/$name.log"
done

echo
echo "All demos started. Logs in $LOG_DIR/"
echo "Press Ctrl+C to stop all."

wait
