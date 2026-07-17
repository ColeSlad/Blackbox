#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)
source "$SCRIPT_DIR/common.sh"

if (($# > 1)); then
  fail "usage: $0 [--dry-run|--execute]"
fi

MODE=${1:---dry-run}
case "$MODE" in
  --dry-run)
    PLAN_MODE=dry-run
    SANDBOX_MODE=read-only
    ;;
  --execute)
    PLAN_MODE=execute
    SANDBOX_MODE=workspace-write
    ;;
  *)
    fail "usage: $0 [--dry-run|--execute]"
    ;;
esac

ROOT=$(repository_root)
require_command python3
cd "$ROOT"

"$SCRIPT_DIR/doctor.sh"

if [[ "$PLAN_MODE" == "execute" ]] && [[ -n "$(git status --porcelain)" ]]; then
  fail "planning execution requires a clean working tree"
fi

RUN_DIR=$(create_run_directory "$ROOT" "planning" "PROJECT")
write_run_metadata "$RUN_DIR/metadata.json" "PROJECT" "docs/TICKETS.md" "project-plan-$PLAN_MODE"
capture_git_status "$ROOT" "$RUN_DIR/pre-run-status.txt"
write_file_manifest "$ROOT" "$RUN_DIR/pre-run-files.json"
cp "$ROOT/docs/TICKETS.md" "$RUN_DIR/pre-run-ticket-index.md"

PROMPT_FILE="$ROOT/.codex/prompts/project-planning.md"
SCHEMA_FILE="$ROOT/.codex/schemas/project-plan-result.schema.json"
RESULT_FILE="$RUN_DIR/result.json"
EVENT_FILE="$RUN_DIR/events.jsonl"
STDERR_FILE="$RUN_DIR/codex.stderr.log"

set +e
{
  cat "$PROMPT_FILE"
  printf '\nPlanning mode: `%s`\n' "$PLAN_MODE"
  printf '%s\n' 'Propose exactly three tickets and do not implement product behavior.'
} | codex -a never exec \
  --sandbox "$SANDBOX_MODE" \
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

invalid_change=0
if [[ "$PLAN_MODE" == "execute" ]]; then
  if ! python3 - "$RUN_DIR/pre-run-files.json" "$RUN_DIR/post-run-files.json" "$ROOT" <<'PY'
import json
import os
import re
import sys

before_path, after_path, root = sys.argv[1:]
with open(before_path, encoding="utf-8") as handle:
    before = json.load(handle)
with open(after_path, encoding="utf-8") as handle:
    after = json.load(handle)
changed = sorted(path for path in set(before) | set(after) if before.get(path) != after.get(path))
ticket_pattern = re.compile(r"^docs/tickets/T[0-9]{4}-[a-z0-9]+(?:-[a-z0-9]+)*\.md$")
ticket_files = [path for path in changed if ticket_pattern.fullmatch(path)]
allowed = all(path == "docs/TICKETS.md" or ticket_pattern.fullmatch(path) for path in changed)
new_only = all(path not in before for path in ticket_files)
drafts = True
for path in ticket_files:
    with open(os.path.join(root, path), encoding="utf-8") as handle:
        content = handle.read()
    drafts = drafts and bool(re.search(r"^Status:\s*Draft\s*$", content, re.MULTILINE))
raise SystemExit(0 if allowed and new_only and len(ticket_files) in {0, 3} and drafts else 1)
PY
  then
    printf '%s\n' 'Planning changed a prohibited path, modified an existing ticket, created too many tickets, or promoted a ticket.' >&2
    invalid_change=1
  fi
elif [[ -s "$RUN_DIR/files-changed-during-run.txt" ]]; then
  printf '%s\n' 'Read-only planning changed repository files.' >&2
  invalid_change=1
fi

printf 'Planning directory: %s\n' "$RUN_DIR"
if ((invalid_change != 0)); then
  exit 3
fi
if ((codex_status != 0)); then
  printf 'Codex planning exited with status %d.\n' "$codex_status" >&2
  exit "$codex_status"
fi

if ! python3 - \
  "$RESULT_FILE" \
  "$PLAN_MODE" \
  "$RUN_DIR/files-changed-during-run.txt" \
  "$RUN_DIR/pre-run-ticket-index.md" \
  "$ROOT" <<'PY'
import json
import os
import re
import sys

with open(sys.argv[1], encoding="utf-8") as handle:
    result = json.load(handle)
mode = sys.argv[2]
with open(sys.argv[3], encoding="utf-8") as handle:
    changed = [line.strip() for line in handle if line.strip() and line.strip() != "."]
with open(sys.argv[4], encoding="utf-8") as handle:
    before_index_lines = handle.readlines()
root = sys.argv[5]
ticket_pattern = re.compile(r"^docs/tickets/T[0-9]{4}-[a-z0-9]+(?:-[a-z0-9]+)*\.md$")
changed_tickets = {path for path in changed if ticket_pattern.fullmatch(path)}
valid = result.get("mode") == mode and result.get("implementation_started") is False
ticket_ids = [ticket.get("id") for ticket in result.get("tickets", [])]
valid = valid and len(ticket_ids) == len(set(ticket_ids))
valid = valid and all(
    len(ticket.get("dependencies", [])) == len(set(ticket.get("dependencies", [])))
    for ticket in result.get("tickets", [])
)
valid = valid and len(result.get("created_files", [])) == len(set(result.get("created_files", [])))

row_pattern = re.compile(r"^\|\s*(T\d+)\s*\|\s*([^|]+?)\s*\|\s*([^|]+?)\s*\|\s*([^|]+?)\s*\|\s*$")
def index_rows(lines):
    rows = {}
    duplicates = set()
    for line in lines:
        match = row_pattern.match(line)
        if not match:
            continue
        ticket_id, title, status, dependencies = (part.strip() for part in match.groups())
        if ticket_id in rows:
            duplicates.add(ticket_id)
        rows[ticket_id] = (title, status, dependencies)
    return rows, duplicates

with open(os.path.join(root, "docs", "TICKETS.md"), encoding="utf-8") as handle:
    after_index_lines = handle.readlines()
before_rows, before_duplicates = index_rows(before_index_lines)
after_rows, after_duplicates = index_rows(after_index_lines)
valid = valid and not before_duplicates and not after_duplicates

ticket_by_id = {ticket["id"]: ticket for ticket in result.get("tickets", [])}
if mode == "execute" and result.get("result") in {"DRAFTS_CREATED", "VALIDATION_BLOCKED"}:
    for ticket_id, ticket in ticket_by_id.items():
        dependencies = "None" if not ticket["dependencies"] else ", ".join(ticket["dependencies"])
        valid = valid and after_rows.get(ticket_id) == (ticket["title"], "Draft", dependencies)

    new_index_ids = set(after_rows) - set(before_rows)
    valid = valid and new_index_ids.issubset(set(ticket_ids))
    filtered_after = [
        line
        for line in after_index_lines
        if not (row_pattern.match(line) and row_pattern.match(line).group(1).strip() in new_index_ids)
    ]
    valid = valid and filtered_after == before_index_lines

positions = {ticket_id: position for position, ticket_id in enumerate(ticket_ids)}
for ticket in result.get("tickets", []):
    valid = valid and all(
        dependency not in positions or positions[dependency] < positions[ticket["id"]]
        for dependency in ticket["dependencies"]
    )

required_sections = (
    "Outcome",
    "Reason",
    "Dependencies",
    "Preconditions",
    "Allowed scope",
    "Protected areas",
    "Requirements",
    "Acceptance criteria",
    "Automated verification",
    "Manual verification",
    "Exclusions",
    "Documentation required",
    "Rollback",
    "Reviewer focus",
)
for ticket in result.get("tickets", []):
    path = os.path.join(root, f"docs/tickets/{ticket['id']}-{ticket['slug']}.md")
    if mode == "execute" and result.get("result") in {"DRAFTS_CREATED", "VALIDATION_BLOCKED"}:
        try:
            with open(path, encoding="utf-8") as handle:
                content = handle.read()
        except OSError:
            valid = False
            continue
        valid = valid and content.startswith(f"# {ticket['id']} — {ticket['title']}\n")
        valid = valid and bool(re.search(r"^Status:\s*Draft\s*$", content, re.MULTILINE))
        for section in required_sections:
            match = re.search(
                rf"^## {re.escape(section)}\s*$\n(?P<body>.*?)(?=^## |\Z)",
                content,
                re.MULTILINE | re.DOTALL,
            )
            valid = valid and bool(match and match.group("body").strip())

if mode == "dry-run":
    if result.get("result") == "PROPOSED":
        valid = valid and len(result.get("tickets", [])) == 3 and not result.get("created_files") and not changed
    else:
        valid = valid and result.get("result") == "BLOCKED" and not result.get("tickets") and not result.get("created_files") and not changed
else:
    if result.get("result") in {"DRAFTS_CREATED", "VALIDATION_BLOCKED"}:
        tickets = result.get("tickets", [])
        validations = result.get("validation", [])
        expected_files = {f"docs/tickets/{ticket['id']}-{ticket['slug']}.md" for ticket in tickets}
        validation_ids = [entry.get("ticket_id") for entry in validations]
        validation_results = [entry.get("result") for entry in validations]
        valid = (
            valid
            and len(tickets) == 3
            and len(result.get("created_files", [])) == 3
            and len(validations) == 3
            and set(result.get("created_files", [])) == changed_tickets
            and set(result.get("created_files", [])) == expected_files
            and len(validation_ids) == len(set(validation_ids))
            and set(validation_ids) == set(ticket_ids)
            and "NOT_RUN" not in validation_results
        )
        if result.get("result") == "DRAFTS_CREATED":
            valid = valid and all(validation_result == "GO" for validation_result in validation_results)
        else:
            valid = valid and "BLOCKED" in validation_results
    else:
        valid = valid and result.get("result") == "BLOCKED" and not result.get("created_files") and not changed
raise SystemExit(0 if valid else 1)
PY
then
  fail "planning result did not preserve Draft-only, no-implementation semantics"
fi

printf '%s\n' 'Next human action: review the three proposals and their validation results. Promote at most one ticket to Ready in a separate explicit change.'
