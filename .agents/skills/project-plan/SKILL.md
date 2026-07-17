---
name: project-plan
description: Propose and optionally materialize the next three dependency-ordered product tickets as Draft specifications, with read-only planning and validation and no implementation.
---

# Project Plan

Use this workflow only for product-ticket planning. Never implement application
behavior during the planning run.

## Inputs

Accept a planning mode:

- `dry-run`: return three structured proposals without repository changes;
- `execute`: create the three proposed ticket files as `Draft` and keep the
  ticket index aligned.

## Workflow

1. Read this skill, capture repository status, and preserve unrelated changes.
2. As the first workflow action, spawn exactly one `project_planner` read-only
   and give it responsibility for reading `AGENTS.md`, `docs/PRODUCT.md`,
   `docs/ARCHITECTURE.md`, `docs/STATUS.md`, `docs/TICKETS.md`,
   `docs/VERIFICATION.md`, accepted ADRs, individual tickets, and
   `docs/completed-tickets/`.
3. Do not duplicate the planner's source audit or start any writer while it is
   running. Confirm the spawn returned an active receiver before waiting;
   if spawning is unavailable or fails, return `BLOCKED` immediately and never
   call a wait operation with no active agent.
4. Require exactly three dependency-ordered specifications for the next
   smallest vertical product increments. Prefer existing indexed Draft tickets
   that do not yet have individual specifications.
5. Stop without changes if planning sources conflict, fewer than three coherent
   increments exist, or required decisions are unresolved.
6. In `dry-run`, return the proposals and stop.
7. In `execute`, let the invoking Codex session be the sole planning writer. Do
   not spawn a writing subagent. Create only new `docs/tickets/` files and any
   necessary Draft index entries in `docs/TICKETS.md`.
8. Give every ticket concrete outcome, reason, dependencies, preconditions,
   allowed scope, protected areas, requirements, acceptance criteria,
   automated checks, manual verification, exclusions, documentation, rollback,
   and reviewer focus.
9. Set every created ticket and index entry to `Draft`. Never mark one `Ready`.
10. After materialization, run `plan_validator` read-only as a separate
    validation step for each new ticket. A blocker leaves the proposal Draft and
    prevents any implementation.
11. Report created files, validation results, and the explicit human action
    required to review and promote a ticket to `Ready` in a separate change.

Never modify application code, start `ticket_worker`, run a product ticket,
commit, push, or merge.
