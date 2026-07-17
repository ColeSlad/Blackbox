---
name: ticket-review
description: Perform a fresh read-only review of uncommitted or branch changes against one ticket, emphasizing correctness, scope, architecture, dependencies, and tests.
---

# Ticket Review

Accept one ticket path and remain read-only throughout the workflow.

1. Read `AGENTS.md`, the ticket, applicable ADRs, `docs/ARCHITECTURE.md`, and
   `docs/VERIFICATION.md`.
2. Capture repository status and the complete requested diff. For an
   uncommitted review, include staged, unstaged, and untracked changes.
3. Spawn a fresh `ticket_reviewer` with the ticket and diff as authority.
4. Verify findings against repository evidence without editing files.
5. Order findings by severity and include path, line when available, impact or
   reproduction, and a recommended action.
6. Return `PASS`, `PASS_WITH_NONBLOCKING_FINDINGS`, or `BLOCKED` with a concise
   summary.

Do not make repairs, commit, push, merge, or report style-only preferences as
defects.
