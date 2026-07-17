---
name: ticket-runner
description: Execute one repository ticket through validation, implementation, testing, and independent review. Use when the user references a ticket file or ticket ID.
---

# Ticket Runner

Execute exactly one ticket.

## Phase 1: Load context

Read:

1. Root and applicable nested `AGENTS.md` files
2. The requested ticket
3. `docs/PRODUCT.md`
4. `docs/ARCHITECTURE.md`
5. `docs/STATUS.md`
6. `docs/VERIFICATION.md`

Confirm the ticket is not already Done.

## Phase 2: Validate

Spawn these read-only agents in parallel:

- `plan_validator`
- `project_explorer`

Wait for both.

If either identifies a blocker, stop before modifying files and return a
consolidated blocker report.

Do not reinterpret or silently expand the ticket.

## Phase 3: Implement

Delegate writing to one `ticket_worker`.

Never spawn multiple writing agents for the same ticket.

The worker must:

- remain inside the allowed scope
- avoid protected areas
- satisfy each acceptance criterion
- add or update appropriate tests
- run all required verification
- provide the required completion report

## Phase 4: Inspect

After implementation:

1. Inspect the complete diff.
2. Confirm that only intended files changed.
3. Run applicable automated verification.
4. Spawn `ticket_reviewer`.
5. Wait for the reviewer.

Do not have the implementation worker approve its own work.

## Phase 5: Repair

If the reviewer reports blockers or must-fix findings:

1. Evaluate each finding against the ticket.
2. Send accepted findings to the ticket worker.
3. Make only the required corrections.
4. Rerun affected checks.
5. Review the resulting diff again.

Limit review-repair cycles to two. If significant issues remain, report the
ticket as partial or blocked rather than repeatedly expanding the change.

## Phase 6: Report

Return:

- ticket result
- implementation summary
- acceptance-criteria evidence
- files changed
- commands and results
- tests added or changed
- review findings and dispositions
- exact manual verification steps
- risks and follow-ups

Do not mark the ticket Done. Human acceptance is required.
