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

"$SCRIPT_DIR/doctor.sh"

RUN_DIR=$(create_run_directory "$ROOT" "reviews" "$TICKET_ID")
write_run_metadata "$RUN_DIR/metadata.json" "$TICKET_ID" "$TICKET_PATH" "ticket-review"
capture_git_status "$ROOT" "$RUN_DIR/pre-run-status.txt"

PROMPT_FILE="$ROOT/.codex/prompts/independent-review.md"
REVIEW_FILE="$RUN_DIR/review.txt"
STDERR_FILE="$RUN_DIR/codex.stderr.log"

cd "$ROOT"
if codex review --help 2>/dev/null | grep -q -- '--uncommitted'; then
  set +e
  {
    cat "$PROMPT_FILE"
    printf '\nTicket path: `%s`\nReview staged, unstaged, and untracked changes.\n' "$TICKET_PATH"
  } | codex -a never review --uncommitted - >"$REVIEW_FILE" 2>"$STDERR_FILE"
  codex_status=$?
  set -e
else
  SCHEMA_FILE="$ROOT/.codex/schemas/review-result.schema.json"
  EVENT_FILE="$RUN_DIR/events.jsonl"
  set +e
  {
    cat "$PROMPT_FILE"
    printf '\nTicket path: `%s`\nReview staged, unstaged, and untracked changes.\n' "$TICKET_PATH"
  } | codex -a never exec \
    --sandbox read-only \
    --json \
    --output-schema "$SCHEMA_FILE" \
    --output-last-message "$REVIEW_FILE" \
    - >"$EVENT_FILE" 2>"$STDERR_FILE"
  codex_status=$?
  set -e
fi

capture_git_status "$ROOT" "$RUN_DIR/post-run-status.txt"
capture_diff_summary "$ROOT" "$RUN_DIR/diff-summary.txt"
cp "$REVIEW_FILE" "$RUN_DIR/final-message.txt" 2>/dev/null || true

printf 'Review directory: %s\n' "$RUN_DIR"
if ((codex_status != 0)); then
  printf 'Codex review exited with status %d.\n' "$codex_status" >&2
  exit "$codex_status"
fi

overall_result=$(grep -Eo 'OVERALL_RESULT:[[:space:]]*(PASS_WITH_NONBLOCKING_FINDINGS|PASS|BLOCKED)' "$REVIEW_FILE" \
  | tail -n 1 \
  | sed -E 's/^OVERALL_RESULT:[[:space:]]*//' || true)

if [[ "$overall_result" == "BLOCKED" ]] \
  || grep -Eq '"result"[[:space:]]*:[[:space:]]*"BLOCKED"|^- \[P[01]\]' "$REVIEW_FILE"; then
  printf '%s\n' 'Review result: BLOCKED' >&2
  exit 1
fi

if [[ "$overall_result" == "PASS" || "$overall_result" == "PASS_WITH_NONBLOCKING_FINDINGS" ]] \
  || grep -Eq '"result"[[:space:]]*:[[:space:]]*"PASS(_WITH_NONBLOCKING_FINDINGS)?"' "$REVIEW_FILE"; then
  printf '%s\n' 'Review completed without blocking findings.'
  exit 0
fi

printf '%s\n' 'Unable to determine the review result from Codex output.' >&2
exit 2
