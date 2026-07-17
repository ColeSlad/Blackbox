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
TICKET_PATH=$(select_next_ready_ticket "$ROOT")
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
