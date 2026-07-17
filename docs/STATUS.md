# Repository Status

Last updated: 2026-07-16
Last validated commit: not yet recorded
Current milestone: M0 — Project setup and architecture validation

## Completed capabilities

- Product definition for the transactional multi-agent coding runtime.
- Initial architecture and system-boundary definition.
- Ticket dependency graph and verification policy.
- Initial MVP success metrics and benchmark targets.

## In progress

- Selecting the implementation stack.
- Defining the repository skeleton and development commands.
- Resolving the Codex CLI integration boundary.
- Converting the initial ticket set from Draft to Ready.

## Current limitations

- Application implementation has not started.
- No repository skeleton or package manager has been selected.
- No database schema, API, CLI, worker, or web interface exists.
- Codex CLI invocation and event-capture behavior have not been validated.
- Filesystem-read instrumentation remains an open technical decision.
- Causal diagnosis metrics currently have definitions but no benchmark implementation.
- The MVP is limited to local Git repositories and coding-agent effects.

## Installed dependencies

None yet.

## Available commands

None yet.

Planned command surface:

- `blackbox init`
- `blackbox dev`
- `blackbox run create`
- `blackbox run start`
- `blackbox run inspect`
- `blackbox run replay`
- `blackbox verify`

These commands are not implemented and must not be documented as available elsewhere until verified.

## Verification status

- Build: not available
- Tests: not available
- Lint: not available
- Type checking: not available
- Database migrations: not available
- Browser tests: not available
- Demo scenario: not available
- Codex CLI integration: not validated

## Known issues

- The implementation stack is undecided, preventing exact setup commands.
- The first release must avoid claiming deterministic model replay.
- The architecture depends on an append-only event ledger; schema discipline must be established before feature work.
- The MVP conflict engine needs an explicit list of hard-blocking versus advisory detectors.

## Next eligible ticket

T0001 — Project Skeleton

## Current milestone exit criteria

M0 is complete when:

- T0001 through T0004 are Done.
- A clean checkout can start the application and database with documented commands.
- Formatting, lint, type checking, tests, and production build run locally and in CI.
- Core domain types for runs, tickets, assignments, intents, transactions, and ledger events exist with schema tests.
- An architecture decision record documents the selected stack and Codex integration approach.