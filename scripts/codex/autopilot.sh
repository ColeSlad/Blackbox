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
cd "$ROOT"
"$SCRIPT_DIR/doctor.sh"

CURRENT_BRANCH=$(git branch --show-current)
if [[ "$CURRENT_BRANCH" == "main" ]] && [[ -n "$(git status --porcelain)" ]]; then
  fail "autopilot refuses a dirty main branch"
fi

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

TICKET_ID=$(ticket_id_from_path "$TICKET_PATH")
printf 'Selected one ticket: %s\n' "$TICKET_PATH"
printf '%s\n' 'This invocation will not inspect or process a second ticket.'

if [[ "$MODE" == "--dry-run" ]]; then
  printf 'Current branch: %s\n' "${CURRENT_BRANCH:-detached}"
  printf '%s\n' 'Dry run only. No branch, worktree, writer, or repository change was created.'
  printf '%s\n' 'Next human action: checkout a clean main branch, review the selected ticket, then rerun with --execute.'
  exit 0
fi

[[ "$CURRENT_BRANCH" == "main" ]] || fail "--execute must start from the main branch"
[[ -z "$(git status --porcelain)" ]] || fail "--execute requires a clean main branch"

TIMESTAMP=$(utc_timestamp)
REPOSITORY_NAME=$(basename "$ROOT")
WORKTREE_BASE=${CODEX_AUTOPILOT_WORKTREE_ROOT:-"$(dirname "$ROOT")/.codex-worktrees/$REPOSITORY_NAME"}
WORKTREE="$WORKTREE_BASE/${TICKET_ID}-${TIMESTAMP}"
LOWER_TICKET_ID=$(printf '%s' "$TICKET_ID" | tr '[:upper:]' '[:lower:]')
LOWER_TIMESTAMP=$(printf '%s' "$TIMESTAMP" | tr '[:upper:]' '[:lower:]')
BRANCH="codex/autopilot-${LOWER_TICKET_ID}-${LOWER_TIMESTAMP}"

mkdir -p "$WORKTREE_BASE"
git worktree add -b "$BRANCH" "$WORKTREE" main

set +e
(
  cd "$WORKTREE"
  ./scripts/codex/run-ticket.sh "$TICKET_PATH"
)
runner_status=$?
set -e

printf '\nAutopilot stopped after one ticket runner invocation.\n'
printf 'Ticket: %s\nBranch: %s\nWorktree: %s\n' "$TICKET_ID" "$BRANCH" "$WORKTREE"
printf '%s\n' 'No manual verification, documentation closure, staging, commit, push, or merge was performed.'
printf '%s\n' 'Next human actions:'
printf '1. Inspect the run evidence and complete diff in %s.\n' "$WORKTREE"
printf '2. Run every manual-verification step in %s and record the result under that worktree\047s .codex-runs/manual/.\n' "$TICKET_PATH"
printf '%s\n' '3. If verification passes, invoke documentation closure separately.'
printf '%s\n' '4. Review and perform any commit, push, merge, or worktree removal manually outside this script.'

exit "$runner_status"
