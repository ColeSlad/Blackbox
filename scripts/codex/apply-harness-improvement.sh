#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)
source "$SCRIPT_DIR/common.sh"

if (($# < 2 || $# > 3)); then
  fail "usage: $0 PROPOSAL.json APPROVAL.md [--dry-run|--execute]"
fi

MODE=${3:---dry-run}
case "$MODE" in
  --dry-run|--execute)
    ;;
  *)
    fail "usage: $0 PROPOSAL.json APPROVAL.md [--dry-run|--execute]"
    ;;
esac

ROOT=$(repository_root)
require_command python3
PROPOSAL_FILE=$(resolve_repo_file "$ROOT" "$1") || fail "proposal must be an existing repository file"
APPROVAL_FILE=$(resolve_repo_file "$ROOT" "$2") || fail "approval must be an existing repository file"
PROPOSAL_PATH=$(repo_relative_path "$ROOT" "$PROPOSAL_FILE")
APPROVAL_PATH=$(repo_relative_path "$ROOT" "$APPROVAL_FILE")
[[ "$PROPOSAL_PATH" == .codex-runs/retrospectives/*/result.json ]] || fail "proposal must be a retrospective result.json"
cd "$ROOT"

validate_proposal_and_approval() {
  python3 - "$PROPOSAL_FILE" "$APPROVAL_FILE" <<'PY'
import hashlib
import json
import posixpath
import re
import sys

proposal_path, approval_path = sys.argv[1:]
with open(proposal_path, encoding="utf-8") as handle:
    result = json.load(handle)
recommendation = result.get("recommendation")
if result.get("result") != "PROPOSAL" or not isinstance(recommendation, dict):
    raise SystemExit("retrospective does not contain one proposal")
if recommendation.get("approval_status") != "PENDING":
    raise SystemExit("proposal must remain PENDING; approval is recorded separately")
if recommendation.get("product_scope_change") is not False:
    raise SystemExit("proposal attempts to alter product scope")

global_roots = ("AGENTS.md", ".codex", ".agents", "scripts", "tests", "docs/tickets/templates", "docs/CODEX_WORKFLOW.md")
allowed_paths = recommendation.get("allowed_paths", [])
if len(allowed_paths) != len(set(allowed_paths)):
    raise SystemExit("proposal contains duplicate allowed paths")
for raw_path in allowed_paths:
    normalized = posixpath.normpath(raw_path)
    if normalized.startswith("../") or not any(
        normalized == root or normalized.startswith(root + "/") for root in global_roots
    ):
        raise SystemExit(f"prohibited proposal path: {raw_path}")

with open(approval_path, encoding="utf-8") as handle:
    lines = [line.strip() for line in handle]
approval_results = [line.casefold() for line in lines if line.casefold().startswith("harness improvement approval:")]
proposal_ids = [line.split(":", 1)[1].strip() for line in lines if line.casefold().startswith("proposal id:")]
proposal_hashes = [line.split(":", 1)[1].strip().lower() for line in lines if line.casefold().startswith("proposal sha-256:")]
if approval_results != ["harness improvement approval: approved"]:
    raise SystemExit("approval record must contain exactly one unambiguous approval")
if proposal_ids != [recommendation.get("proposal_id")]:
    raise SystemExit("approval proposal ID does not match")
with open(proposal_path, "rb") as handle:
    proposal_hash = hashlib.sha256(handle.read()).hexdigest()
if proposal_hashes != [proposal_hash]:
    raise SystemExit("approval proposal SHA-256 does not match the exact proposal content")
print(recommendation["proposal_id"])
PY
}

PROPOSAL_ID=$(validate_proposal_and_approval) || fail "proposal or approval validation failed"
"$SCRIPT_DIR/doctor.sh"

if [[ "$MODE" == "--dry-run" ]]; then
  printf 'Approved proposal: %s\n' "$PROPOSAL_ID"
  printf '%s\n' 'Dry run only. No writer started and no files changed.'
  printf 'Execute exactly this proposal with: %q %q %q --execute\n' "$0" "$PROPOSAL_PATH" "$APPROVAL_PATH"
  exit 0
fi

if [[ -n "$(git status --porcelain)" ]]; then
  fail "harness improvement execution requires a clean working tree"
fi

RUN_DIR=$(create_run_directory "$ROOT" "improvements" "$PROPOSAL_ID")
write_run_metadata "$RUN_DIR/metadata.json" "$PROPOSAL_ID" "$PROPOSAL_PATH" "harness-improve"
capture_git_status "$ROOT" "$RUN_DIR/pre-run-status.txt"
write_file_manifest "$ROOT" "$RUN_DIR/pre-run-files.json"

PROMPT_FILE="$ROOT/.codex/prompts/harness-improvement.md"
SCHEMA_FILE="$ROOT/.codex/schemas/harness-improvement-result.schema.json"
RESULT_FILE="$RUN_DIR/result.json"
EVENT_FILE="$RUN_DIR/events.jsonl"
STDERR_FILE="$RUN_DIR/codex.stderr.log"

set +e
{
  cat "$PROMPT_FILE"
  printf '\nProposal: `%s`\n' "$PROPOSAL_PATH"
  printf 'Approval record: `%s`\n' "$APPROVAL_PATH"
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

if ! python3 - "$PROPOSAL_FILE" "$RUN_DIR/files-changed-during-run.txt" <<'PY'
import json
import posixpath
import sys

proposal_path, changed_path = sys.argv[1:]
with open(proposal_path, encoding="utf-8") as handle:
    recommendation = json.load(handle)["recommendation"]
with open(changed_path, encoding="utf-8") as handle:
    changed = [line.strip() for line in handle if line.strip() and line.strip() != "."]

global_roots = ("AGENTS.md", ".codex", ".agents", "scripts", "tests", "docs/tickets/templates", "docs/CODEX_WORKFLOW.md")
approved = [posixpath.normpath(path) for path in recommendation["allowed_paths"]]
def within(path, roots):
    return any(path == root or path.startswith(root + "/") for root in roots)

def within_approved_path_or_parent(path):
    return within(path, approved) or any(root.startswith(path + "/") for root in approved)

valid = all(within(path, global_roots) and within_approved_path_or_parent(path) for path in changed)
raise SystemExit(0 if valid else 1)
PY
then
  printf '%s\n' 'Harness improvement changed a path outside the global or proposal-specific scope.' >&2
  exit 3
fi

printf 'Improvement directory: %s\n' "$RUN_DIR"
if ((codex_status != 0)); then
  printf 'Codex harness improvement exited with status %d.\n' "$codex_status" >&2
  exit "$codex_status"
fi

if ! "$SCRIPT_DIR/doctor.sh" >"$RUN_DIR/post-run-doctor.log" 2>&1; then
  printf '%s\n' 'Post-run deterministic harness validation failed; inspect post-run-doctor.log.' >&2
  exit 3
fi

if python3 - "$RESULT_FILE" "$PROPOSAL_ID" <<'PY'
import json
import sys

with open(sys.argv[1], encoding="utf-8") as handle:
    result = json.load(handle)
valid = (
    result.get("proposal_id") == sys.argv[2]
    and result.get("status") == "READY_FOR_HUMAN_REVIEW"
    and result.get("writer_count") == 1
    and result.get("product_scope_changed") is False
    and result.get("commit_created") is False
    and result.get("review", {}).get("result") in {"PASS", "PASS_WITH_NONBLOCKING_FINDINGS"}
)
raise SystemExit(0 if valid else 1)
PY
then
  printf '%s\n' 'Harness improvement is ready for human diff review. No commit or merge occurred.'
else
  printf '%s\n' 'Harness improvement did not satisfy validation and independent-review gates.' >&2
  exit 3
fi
