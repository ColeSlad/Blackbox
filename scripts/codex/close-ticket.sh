#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)
source "$SCRIPT_DIR/common.sh"

if (($# != 2)); then
  fail "usage: $0 docs/tickets/T0001-project-skeleton.md PATH_TO_MANUAL_VERIFICATION.md"
fi

ROOT=$(repository_root)
require_command python3
TICKET_FILE=$(resolve_repo_file "$ROOT" "$1") || fail "ticket path must name a file inside the repository"
MANUAL_FILE=$(resolve_repo_file "$ROOT" "$2") || fail "manual verification must be a file inside the repository"
TICKET_PATH=$(repo_relative_path "$ROOT" "$TICKET_FILE")
MANUAL_PATH=$(repo_relative_path "$ROOT" "$MANUAL_FILE")
TICKET_ID=$(ticket_id_from_path "$TICKET_FILE")
cd "$ROOT"

if ! python3 - "$MANUAL_FILE" <<'PY'
import sys

with open(sys.argv[1], encoding="utf-8") as handle:
    results = [
        line.strip().casefold()
        for line in handle
        if line.strip().casefold().startswith("manual verification:")
    ]
raise SystemExit(0 if results == ["manual verification: pass"] else 1)
PY
then
  fail "$MANUAL_PATH must contain exactly one unambiguous 'Manual verification: Pass' result"
fi

"$SCRIPT_DIR/doctor.sh"

RUN_DIR=$(create_run_directory "$ROOT" "closures" "$TICKET_ID")
write_run_metadata "$RUN_DIR/metadata.json" "$TICKET_ID" "$TICKET_PATH" "ticket-close"
capture_git_status "$ROOT" "$RUN_DIR/pre-run-status.txt"
write_file_manifest "$ROOT" "$RUN_DIR/pre-run-files.json"

PROMPT_FILE="$ROOT/.codex/prompts/ticket-closure.md"
SCHEMA_FILE="$ROOT/.codex/schemas/closure-result.schema.json"
RESULT_FILE="$RUN_DIR/result.json"
EVENT_FILE="$RUN_DIR/events.jsonl"
STDERR_FILE="$RUN_DIR/codex.stderr.log"

set +e
{
  cat "$PROMPT_FILE"
  printf '\nTicket path: `%s`\n' "$TICKET_PATH"
  printf 'Human manual-verification record: `%s`\n' "$MANUAL_PATH"
  printf '%s\n' 'Locate and audit the latest automated ticket and review evidence under `.codex-runs/`; block closure if it is absent or incomplete.'
} | codex -a never exec \
  --sandbox workspace-write \
  --json \
  --output-schema "$SCHEMA_FILE" \
  --output-last-message "$RESULT_FILE" \
  - >"$EVENT_FILE" 2>"$STDERR_FILE"
codex_status=$?
set -e

capture_git_status "$ROOT" "$RUN_DIR/post-run-status.txt"
capture_diff_summary "$ROOT" "$RUN_DIR/diff-summary.txt"
write_file_manifest "$ROOT" "$RUN_DIR/post-run-files.json"
compare_file_manifests \
  "$RUN_DIR/pre-run-files.json" \
  "$RUN_DIR/post-run-files.json" \
  "$RUN_DIR/files-changed-during-run.txt"
render_result_summary "$RESULT_FILE" "$RUN_DIR/final-message.txt"

invalid_path=0
while IFS= read -r changed_path; do
  [[ -n "$changed_path" ]] || continue
  case "$changed_path" in
    docs/STATUS.md|docs/TICKETS.md|"$TICKET_PATH"|docs/completed-tickets/*)
      ;;
    *)
      printf 'Closure modified a prohibited path: %s\n' "$changed_path" >&2
      invalid_path=1
      ;;
  esac
done <"$RUN_DIR/files-changed-during-run.txt"

printf 'Closure directory: %s\n' "$RUN_DIR"
if ((invalid_path != 0)); then
  exit 3
fi
if ((codex_status != 0)); then
  printf 'Codex closure exited with status %d.\n' "$codex_status" >&2
  exit "$codex_status"
fi

if python3 - "$RESULT_FILE" <<'PY'
import json
import sys

with open(sys.argv[1], encoding="utf-8") as handle:
    result = json.load(handle)
is_closed = result.get("result") == "CLOSED"
manual_recorded = result.get("manual_verification_recorded") is True
documentation_only = result.get("application_files_changed") is False
raise SystemExit(0 if is_closed and manual_recorded and documentation_only else 1)
PY
then
  printf '%s\n' 'Closure completed with documentation-only changes. Review them before any commit.'
else
  printf '%s\n' 'Closure result did not confirm CLOSED status, recorded human verification, and documentation-only changes.' >&2
  exit 3
fi
