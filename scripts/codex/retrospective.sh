#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)
source "$SCRIPT_DIR/common.sh"

if (($# < 2 || $# > 3)); then
  fail "usage: $0 T0001 .codex-runs/T0001/TIMESTAMP [MANUAL_VERIFICATION.md]"
fi

TICKET_ID=$1
[[ "$TICKET_ID" =~ ^T[0-9]{4}$ ]] || fail "ticket ID must match T0001"

ROOT=$(repository_root)
require_command python3
EVIDENCE_DIR=$(resolve_repo_directory "$ROOT" "$2") || fail "run evidence must be an existing repository directory"
EVIDENCE_PATH=$(repo_relative_path "$ROOT" "$EVIDENCE_DIR")
[[ "$EVIDENCE_PATH" == ".codex-runs/$TICKET_ID/"* ]] || fail "run evidence must be a direct run for $TICKET_ID"
[[ $(basename "$EVIDENCE_PATH") =~ ^[0-9]{8}T[0-9]{6}Z(-[0-9]+)?$ ]] || fail "run evidence must use a timestamped ticket-run directory"
TICKET_FILE=$(find_ticket_by_id "$ROOT" "$TICKET_ID") || fail "unable to resolve the ticket file"
TICKET_PATH=$(repo_relative_path "$ROOT" "$TICKET_FILE")

LATEST_EVIDENCE=$(python3 - "$ROOT" "$TICKET_ID" <<'PY'
import glob
import os
import re
import sys

root, ticket_id = sys.argv[1:]
pattern = re.compile(r"^[0-9]{8}T[0-9]{6}Z(?:-[0-9]+)?$")
candidates = [
    path
    for path in glob.glob(os.path.join(root, ".codex-runs", ticket_id, "*"))
    if os.path.isdir(path) and pattern.fullmatch(os.path.basename(path))
]
if not candidates:
    raise SystemExit("no ticket-run evidence exists")
print(os.path.realpath(sorted(candidates)[-1]))
PY
) || fail "unable to identify the latest ticket-run evidence"
[[ "$EVIDENCE_DIR" == "$LATEST_EVIDENCE" ]] || fail "retrospective requires the latest run evidence for $TICKET_ID"

if ! python3 - "$EVIDENCE_DIR/metadata.json" "$TICKET_ID" <<'PY'
import json
import sys

with open(sys.argv[1], encoding="utf-8") as handle:
    metadata = json.load(handle)
valid = metadata.get("ticket_id") == sys.argv[2] and metadata.get("workflow") == "ticket-runner"
raise SystemExit(0 if valid else 1)
PY
then
  fail "run evidence metadata does not identify the requested ticket-runner invocation"
fi

MANUAL_PATH=none
if (($# == 3)); then
  MANUAL_FILE=$(resolve_repo_file "$ROOT" "$3") || fail "manual verification must be an existing repository file"
  MANUAL_PATH=$(repo_relative_path "$ROOT" "$MANUAL_FILE")
  case "$MANUAL_PATH" in
    ".codex-runs/manual/$TICKET_ID.md"|".codex-runs/manual/$TICKET_ID-"*.md)
      ;;
    *)
      fail "manual verification record must be named for $TICKET_ID below .codex-runs/manual/"
      ;;
  esac
fi

cd "$ROOT"
"$SCRIPT_DIR/doctor.sh"

RUN_DIR=$(create_run_directory "$ROOT" "retrospectives" "$TICKET_ID")
write_run_metadata "$RUN_DIR/metadata.json" "$TICKET_ID" "$TICKET_PATH" "harness-retrospective"
capture_git_status "$ROOT" "$RUN_DIR/pre-run-status.txt"

PROMPT_FILE="$ROOT/.codex/prompts/harness-retrospective.md"
SCHEMA_FILE="$ROOT/.codex/schemas/retrospective-result.schema.json"
RESULT_FILE="$RUN_DIR/result.json"
EVENT_FILE="$RUN_DIR/events.jsonl"
STDERR_FILE="$RUN_DIR/codex.stderr.log"

set +e
{
  cat "$PROMPT_FILE"
  printf '\nTicket ID: `%s`\n' "$TICKET_ID"
  printf 'Ticket path: `%s`\n' "$TICKET_PATH"
  printf 'Run-evidence directory: `%s`\n' "$EVIDENCE_PATH"
  printf 'Manual-verification record: `%s`\n' "$MANUAL_PATH"
} | codex -a never exec \
  --sandbox read-only \
  --json \
  --output-schema "$SCHEMA_FILE" \
  --output-last-message "$RESULT_FILE" \
  - >"$EVENT_FILE" 2>"$STDERR_FILE"
codex_status=$?
set -e

capture_git_status "$ROOT" "$RUN_DIR/post-run-status.txt"
render_result_summary "$RESULT_FILE" "$RUN_DIR/final-message.txt"

printf 'Retrospective directory: %s\n' "$RUN_DIR"
if ((codex_status != 0)); then
  printf 'Codex retrospective exited with status %d.\n' "$codex_status" >&2
  exit "$codex_status"
fi

if ! python3 - "$RESULT_FILE" "$TICKET_ID" "$EVIDENCE_PATH" <<'PY'
import json
import posixpath
import sys

result_path, ticket_id, evidence_path = sys.argv[1:]
with open(result_path, encoding="utf-8") as handle:
    result = json.load(handle)
valid = result.get("ticket_id") == ticket_id and result.get("evidence_directory") == evidence_path
recommendation = result.get("recommendation")
if result.get("result") == "PROPOSAL":
    valid = valid and isinstance(recommendation, dict)
else:
    valid = valid and recommendation is None
if isinstance(recommendation, dict):
    global_roots = ("AGENTS.md", ".codex", ".agents", "scripts", "tests", "docs/tickets/templates", "docs/CODEX_WORKFLOW.md")
    valid = valid and len(recommendation.get("allowed_paths", [])) == len(set(recommendation.get("allowed_paths", [])))
    for raw_path in recommendation.get("allowed_paths", []):
        normalized = posixpath.normpath(raw_path)
        allowed = not normalized.startswith("../") and any(
            normalized == root or normalized.startswith(root + "/") for root in global_roots
        )
        valid = valid and allowed
raise SystemExit(0 if valid else 1)
PY
then
  fail "retrospective output is inconsistent or proposes a prohibited product-scope path"
fi

printf '%s\n' 'Next human action: review result.json. If it contains a proposal, approve or reject it in a separate record; do not edit the proposal in place.'
