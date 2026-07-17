#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)
source "$SCRIPT_DIR/common.sh"

if (($# > 1)); then
  fail "usage: $0 [--dry-run|--execute]"
fi

MODE=${1:---dry-run}
case "$MODE" in
  --dry-run|--execute)
    ;;
  *)
    fail "usage: $0 [--dry-run|--execute]"
    ;;
esac

ROOT=$(repository_root)
require_command python3
"$SCRIPT_DIR/doctor.sh"

set +e
TICKET_PATH=$(python3 - "$ROOT" <<'PY'
import glob
import os
import re
import sys

root = os.path.realpath(sys.argv[1])
index_path = os.path.join(root, "docs", "TICKETS.md")
row_pattern = re.compile(
    r"^\|\s*(T\d+)\s*\|\s*([^|]+?)\s*\|\s*([^|]+?)\s*\|\s*([^|]+?)\s*\|$"
)
tickets = []
with open(index_path, encoding="utf-8") as handle:
    for raw_line in handle:
        match = row_pattern.match(raw_line.rstrip())
        if not match:
            continue
        ticket_id, _title, status, dependencies = (part.strip() for part in match.groups())
        tickets.append((ticket_id, status, dependencies))

def individual_status(ticket_id):
    matches = []
    for directory in ("tickets", "completed-tickets"):
        matches.extend(glob.glob(os.path.join(root, "docs", directory, f"{ticket_id}-*.md")))
    if len(matches) != 1:
        return None, None
    with open(matches[0], encoding="utf-8") as handle:
        content = handle.read()
    match = re.search(r"^Status:\s*(.+?)\s*$", content, re.MULTILINE)
    return (match.group(1) if match else None), matches[0]

for ticket_id, index_status, dependencies in tickets:
    status, ticket_path = individual_status(ticket_id)
    if status != "Ready" or ticket_path is None:
        continue
    dependency_ids = [] if dependencies == "None" else [item.strip() for item in dependencies.split(",")]
    dependency_statuses = [individual_status(dependency)[0] for dependency in dependency_ids]
    if any(status != "Done" for status in dependency_statuses):
        continue
    if index_status != status:
        print(
            f"warning: {ticket_id} index status is {index_status}; "
            f"authoritative ticket status is {status}",
            file=sys.stderr,
        )
    print(os.path.relpath(ticket_path, root))
    raise SystemExit(0)

raise SystemExit(1)
PY
)
selection_status=$?
set -e

if ((selection_status == 1)); then
  printf '%s\n' 'No Ready ticket has all dependencies Done.'
  exit 0
fi
if ((selection_status != 0)); then
  fail "ticket index and individual ticket files could not be reconciled"
fi

printf 'Selected ticket: %s\n' "$TICKET_PATH"
if [[ "$MODE" == "--dry-run" ]]; then
  printf '%s\n' 'Dry run only. Re-run with --execute to invoke exactly this ticket.'
  exit 0
fi

exec "$SCRIPT_DIR/run-ticket.sh" "$TICKET_PATH"
