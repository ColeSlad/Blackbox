# Project Instructions

## Sources of truth

Read these documents before making changes:

1. `docs/PRODUCT.md` — product intent and user requirements
2. `docs/ARCHITECTURE.md` — technical design and invariants
3. `docs/STATUS.md` — current implemented state
4. `docs/TICKETS.md` — ticket sequence and dependencies
5. The active file under `docs/tickets/`

If documents conflict, stop and report the conflict instead of guessing.

## Ticket execution rules

- Implement one ticket only.
- Do not implement future-ticket behavior.
- Do not refactor unrelated code.
- Do not introduce new architecture unless the ticket requires it.
- Prefer the smallest complete and maintainable change.
- Do not add a production dependency unless the ticket requires it.
- Do not modify protected areas listed in the ticket.

If a protected-area change appears necessary:

1. Do not make the change.
2. Explain why the ticket cannot be completed correctly without it.
3. Propose a prerequisite or expanded ticket.
4. Wait for the scope to be changed.

## Before editing

- Read the active ticket completely.
- Inspect the relevant existing implementation.
- Confirm that the ticket assumptions match the repository.
- Identify the files likely to change.
- Report blockers before making changes.

## Implementation standards

- Follow the existing language and framework conventions.
- Keep public interfaces explicit and documented.
- Avoid hidden global state.
- Keep persisted data separate from runtime-specific objects.
- Preserve backward compatibility unless the ticket explicitly changes it.
- Add tests for new behavior and regressions when practical.
- Never weaken tests merely to make them pass.

## Verification

Run all applicable commands documented in:

- `README.md`
- `docs/VERIFICATION.md`
- The active ticket

At minimum, run the relevant:

- formatting checks
- lint checks
- type checking
- unit tests
- integration tests
- production build

Do not claim a check passed unless it was actually run successfully.

## Documentation

Do not mark a ticket completed before human verification.

During implementation, report documentation that needs updating. After the
ticket is accepted, update `docs/STATUS.md`, `docs/TICKETS.md`, and the ticket
record in a documentation-only closure step.

## Completion report

End every implementation with:

### Ticket result

Complete, partial, or blocked.

### Summary

What was implemented.

### Acceptance criteria

For each criterion:

- Pass, fail, or not verified
- Supporting evidence

### Changed files

Each file and why it changed.

### Commands run

Each command and its result.

### Tests

Tests added, changed, and executed.

### Manual verification

Exact steps the human should perform.

### Deviations

Any differences from the approved ticket.

### Risks

Known remaining technical or behavioral risks.

### Follow-ups

Potential future tickets. Do not implement them automatically.
