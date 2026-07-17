#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)
source "$SCRIPT_DIR/common.sh"

if (($# != 1)); then
  fail "usage: $0 docs/tickets/T0001-project-skeleton.md"
fi

ROOT=$(repository_root)
require_command python3
TICKET_FILE=$(resolve_repo_file "$ROOT" "$1") || fail "ticket path must name a file inside the repository"
TICKET_PATH=$(repo_relative_path "$ROOT" "$TICKET_FILE")
TICKET_ID=$(ticket_id_from_path "$TICKET_FILE")
cd "$ROOT"

"$SCRIPT_DIR/doctor.sh"

STATUS=$(ticket_status "$TICKET_FILE")
if [[ "$STATUS" != "Ready" ]]; then
  fail "$TICKET_PATH is not Ready (status: ${STATUS:-missing})"
fi

RUN_DIR=$(create_run_directory "$ROOT" "" "$TICKET_ID")
write_run_metadata "$RUN_DIR/metadata.json" "$TICKET_ID" "$TICKET_PATH" "ticket-runner"
printf '%s\n' "$TICKET_PATH" >"$RUN_DIR/ticket-path.txt"
capture_git_status "$ROOT" "$RUN_DIR/pre-run-status.txt"

PROMPT_FILE="$ROOT/.codex/prompts/automated-ticket-run.md"
SCHEMA_FILE="$ROOT/.codex/schemas/ticket-run-result.schema.json"
RESULT_FILE="$RUN_DIR/result.json"
EVENT_FILE="$RUN_DIR/events.jsonl"
STDERR_FILE="$RUN_DIR/codex.stderr.log"
INVOCATION_FILE="$RUN_DIR/invocation.md"
PROGRESS_FILE="$RUN_DIR/progress.log"

{
  cat "$PROMPT_FILE"
  printf '\nTicket path: `%s`\n' "$TICKET_PATH"
} >"$INVOCATION_FILE"

set +e
python3 "$SCRIPT_DIR/run-codex-observed.py" \
  --input "$INVOCATION_FILE" \
  --events "$EVENT_FILE" \
  --stderr "$STDERR_FILE" \
  --progress "$PROGRESS_FILE" \
  -- codex -a never exec \
  --sandbox workspace-write \
  --json \
  --output-schema "$SCHEMA_FILE" \
  --output-last-message "$RESULT_FILE" \
  -
codex_status=$?
set -e

capture_git_status "$ROOT" "$RUN_DIR/post-run-status.txt"
capture_diff_summary "$ROOT" "$RUN_DIR/diff-summary.txt"
render_result_summary "$RESULT_FILE" "$RUN_DIR/final-message.txt"

printf 'Run directory: %s\n' "$RUN_DIR"
if ((codex_status == 0)); then
  printf '%s\n' 'Next human action: inspect result.json and complete the ticket manual-verification steps if requested.'
else
  printf 'Codex exited with status %d. Inspect events.jsonl and codex.stderr.log.\n' "$codex_status" >&2
fi

exit "$codex_status"
