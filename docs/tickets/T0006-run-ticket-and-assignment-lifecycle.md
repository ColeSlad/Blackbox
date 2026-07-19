# T0006 — Run, Ticket, and Assignment Lifecycle

Status: Draft
Milestone: M1 — Transactional execution

## Outcome

A locally authenticated API can atomically create and inspect a coordinated run
with dependency-aware tickets, start coordination, mark dependency-eligible
tickets ready, and reserve one future writing assignment while persisting
versioned domain events to an outbox.

## Reason

T0003 provides pure lifecycle edges and T0004 provides PostgreSQL create/read
persistence, but no application service enforces dependency satisfaction,
exclusive assignment ownership, atomic lifecycle mutation, or a user-facing
product workflow.

## Dependencies

- T0003 — must be Done
- T0004 — must be Done

T0005 is intentionally not required. Callers provide the repository UUID and
recorded exact base commit; T0007 later joins Git inspection to lifecycle
records.

## Preconditions

- PostgreSQL 17 is healthy and migrations `0001` and `0002` are current.
- Existing Node, pnpm, Fastify, TypeBox, and Postgres.js versions remain pinned.
- Product routes use an explicitly configured local bearer token.
- Application-generated identifiers use `crypto.randomUUID()`.
- T0003 contracts, status vocabularies, and legal transition tables remain
  authoritative and unchanged.

## Allowed scope

- New `packages/application/`
- `packages/persistence/` lifecycle mutation, graph-read, transactional command,
  and outbox interfaces/adapters
- New ordered migration
  `packages/persistence/migrations/0003_lifecycle_state_and_outbox.sql`
- `apps/server/` composition and authenticated version-one lifecycle routes
- Lifecycle API and database fixtures under `fixtures/`
- Root workspace manifests, verification scripts, and `pnpm-lock.yaml` metadata
- `README.md`
- `docs/ARCHITECTURE.md`
- `docs/STATUS.md`
- `docs/VERIFICATION.md`
- `docs/TICKETS.md`
- `docs/tickets/T0006-run-ticket-and-assignment-lifecycle.md`

## Protected areas

- T0003 wire-schema meaning and pure lifecycle transition tables
- T0005 Git inspection and T0007 worktree provisioning
- Intent acceptance, revision history, and resource resolution owned by T0008
- Ledger envelopes, sequencing, hashing, ingestion, and projections owned by
  T0009
- Worker jobs, leases, retries, and cancellation delivery owned by T0010
- Commands, Codex processes, validations, transaction eligibility, conflicts,
  replay, causality, and guardrails
- Web behavior and browser workflows
- Commits, patches, branches, worktrees, and canonical repository state

## Requirements

### Application boundary

- Add a framework-independent lifecycle application service.
- Keep Fastify composition and PostgreSQL adapters replaceable.
- Use T0003 parsers and transition functions rather than redefining schemas or
  legal edges.
- Return stable safe application errors distinct from persistence and domain
  errors.

### Run creation and inspection

- Provide an atomic create-run command accepting repository UUID, title, exact
  base commit SHA, configuration version, and a non-empty ticket graph keyed by
  unique external keys.
- Generate run and ticket UUIDs server-side.
- Create the run in `created` and tickets in `pending`.
- Resolve dependency keys to generated IDs and reject missing keys, duplicates,
  self-dependencies, and cycles before persistence.
- Persist the graph atomically with no partial rows or outbox records on failure.
- Provide authenticated inspection returning run, tickets, dependencies, and
  assignments in deterministic external-key and identifier order.

### Lifecycle orchestration

- Persist successful state changes through application commands that invoke
  T0003 transition functions.
- Permit a ticket to become `ready` only when every dependency is `done`.
- Create assignments only for a `ready` ticket in a `running` run.
- Treat an `assigned` record created here as a non-executing orchestration
  reservation, not an active writing agent.
- Enforce at most one `assigned` or `active` record per ticket through
  application checks and a PostgreSQL partial unique index, while T0006 itself
  never creates `active` assignments.
- Defer `ticket → running` and `assignment → active` until T0007 can atomically
  prove and bind an active, clean, exact-base worktree. T0008 later adds accepted
  intent.
- Defer `ticket → done` and `run → completed` until T0013 supplies persisted
  passing verification evidence. T0006 must not waive or fabricate that gate.
- Permit blocking or cancelling a pending/ready ticket; if an assigned
  reservation exists, transition it to `cancelled` in the same transaction.
- Cancelling a run atomically cancels pending, ready, or blocked tickets and all
  assigned reservations.
- Failing a run atomically marks assigned reservations `failed`, cancels
  non-running nonterminal tickets, and sets the run to `failed`. T0006 cannot
  contain running tickets by construction.
- Set `run.started_at` exactly when `created → running` succeeds and set
  `run.completed_at` exactly when the run becomes `failed` or `cancelled`.
- Set `assignment.assigned_at` at creation and `assignment.released_at` for every
  terminal assignment disposition, using one injected clock value per command.

### Persistence and outbox

- Add explicit database-neutral mutation and transaction ports.
- Use PostgreSQL transactions, row locks or optimistic predicates, and database
  constraints to prevent lost updates.
- Add immutable version-one outbox records for run, ticket, and assignment
  creation and status changes in the same transaction as command-side state.
- Write one outbox record per aggregate mutation, not per application command:
  create-run writes one `run.created` plus one `ticket.created` for each ticket;
  every supported status change writes one `<aggregate>.status_changed`; and
  assignment reservation writes one `assignment.created`.
- Give each outbox record `schema_version`, event UUID, aggregate type and ID,
  run ID, deterministic event name, injected occurrence timestamp, and a
  version-one payload containing only the created record or `from`/`to` states.
- Order multi-aggregate command inserts deterministically by aggregate type and
  ID while making no T0009 producer-sequence or hash-chain claim.
- Treat outbox entries as pending domain-delivery records, not T0009 execution
  ledger envelopes.
- Failed commands write neither state changes nor outbox records.
- Preserve migrations `0001` and `0002` unchanged.

### Product API and authentication

- Add minimal version-one create, inspect, start-run, ready-ticket,
  reserve-assignment, block/cancel-ticket, and fail/cancel-run routes.
- Require a configured local bearer token for every new product route.
- Preserve unauthenticated `GET /version` behavior.
- Return deterministic machine-readable responses and sanitized errors without
  credentials, SQL, unsafe inputs, or stack traces.

## Acceptance criteria

- An authenticated client can create and inspect a persisted dependency-ordered
  run graph.
- Cyclic, missing, duplicate, cross-run, and self dependencies fail atomically
  without partial rows or outbox records.
- Root tickets can become ready; dependent tickets cannot become ready or start
  before every dependency is done.
- Exactly one non-executing assigned reservation can own a ticket, including
  under concurrent requests; no T0006 operation creates an active writer.
- Blocking or cancellation atomically terminalizes any assigned reservation,
  and run failure/cancellation follows the documented deterministic cascade.
- Invalid transition and orchestration precondition failures are distinct,
  stable, and sanitized.
- Each successful aggregate mutation writes exactly one versioned outbox record
  in the same transaction; failed commands write none.
- Run and assignment timestamps follow the documented injected-clock rules.
- Ticket running/completion and run completion remain unavailable until T0007
  and T0013 satisfy their respective worktree and verification gates.
- Inspection ordering is deterministic and API records parse through existing
  version-one contracts.
- No Git, worktree, intent-registry, execution-ledger, queue, transaction,
  validation, or agent-execution behavior is added.
- Aggregate verification passes.

## Automated verification

- `pnpm --filter @blackbox/application test`
- `pnpm --filter @blackbox/application typecheck`
- `pnpm --filter @blackbox/application build`
- `pnpm --filter @blackbox/persistence test`
- `pnpm test:database`
- Server injection tests for authenticated create, inspect, lifecycle,
  unauthorized, malformed, not-found, and conflict responses
- Application tests for every T0006-supported run, ticket, and assignment edge,
  deterministic timestamp effects, terminal cascades, and representative
  forbidden or deferred edges
- Database tests for migration, graph atomicity, cycle refusal, dependency
  eligibility, partial live-assignment uniqueness, and concurrent races
- Transaction tests proving every aggregate mutation and its expected
  per-aggregate outbox records commit or roll back together, including
  create-run cardinality and deterministic event fields and ordering
- Static boundary checks proving application code imports no Fastify or
  PostgreSQL types and adds no Git, worktree, intent, ledger, queue, or
  transaction implementation
- `pnpm verify`
- `git diff --check`
- Migration immutability, secret, and generated-artifact inspection

## Manual verification

1. Start PostgreSQL, migrate, and start the server with a disposable local
   bearer token.
2. Confirm `GET /version` remains available and product routes reject missing
   or incorrect authorization.
3. Create a run with one root ticket and one dependent ticket; inspect
   deterministic persisted output.
4. Start the run, ready the root ticket, and reserve one assignment.
5. Confirm the dependent ticket remains ineligible while its dependency is not
   done and confirm ticket start/assignment activation is explicitly refused
   pending T0007.
6. Attempt two assignment reservations and confirm exactly one succeeds.
7. Block the root ticket and confirm its reservation is cancelled atomically;
   inspect deterministic timestamps and per-aggregate sanitized outbox records.
8. Cancel the run and confirm remaining nonterminal tickets and reservations are
   terminalized according to the documented mapping.
9. Attempt a cyclic graph and invalid or deferred transition; confirm no partial
   state and safe errors.
10. Stop the server and remove only disposable test data through documented
    development procedures.

## Exclusions

- Repository discovery, Git validation, branches, patches, and worktrees
- Accepted-intent preconditions, intent history, and resource selectors
- Ledger envelopes, producer sequences, payload hashes, projections, or
  timeline APIs
- Queue jobs, workers, retries, leases, command execution, Codex, and validation
  execution
- Ticket start, active writing assignments, ticket completion, run completion,
  and creation of verification evidence
- Transaction lifecycle or commit eligibility
- Dynamic ticket insertion after run creation
- Web UI, remote authentication, authorization roles, multi-user sessions, and
  hosted deployment
- Outbox publishing or consumption

## Documentation required

- Document authenticated local lifecycle API setup and examples in `README.md`.
- Record application-service, atomic mutation, assignment-reservation, deferred
  execution/completion gates, and outbox boundaries in `docs/ARCHITECTURE.md`.
- Add lifecycle, concurrency, authentication, migration, and outbox verification
  to `docs/VERIFICATION.md`.
- Record available product behavior and T0007–T0014 limitations in
  `docs/STATUS.md`.
- Keep this ticket Draft until separate validation and explicit human
  promotion.

## Rollback

Revert code and API changes. Migration `0003` is forward-only: disposable
development databases may be reset explicitly, while any non-disposable applied
database requires a later approved forward migration rather than rewriting or
automatically reversing the migration.

## Reviewer focus

- Dependency-cycle and dependency-satisfaction correctness
- Atomic mutation, reservation disposition, timestamp effects, and outbox
  insertion
- Database enforcement of one assigned/active ownership slot under concurrency
- Authentication and safe API, application, and persistence errors
- T0003 transition reuse rather than duplicated lifecycle meaning
- Separation of outbox domain events from T0009 execution-ledger events
- Preservation of T0007 worktree and T0013 verification gates
- No worktree, intent, queue, transaction, validation, or execution overreach
- Migration ordering, constraints, parameterized SQL, and rollback honesty

## Dependency evaluation

- Add no external dependency.
- Reuse Fastify only in `apps/server`, TypeBox through existing contracts, and
  Postgres.js only in persistence adapters.
- Use `crypto.randomUUID()` and injected clock/identifier functions for tests.
- Use PostgreSQL transactions, row locking or optimistic predicates, and a
  partial unique index rather than an in-memory or distributed lock package.
- Reject ORM, event framework, broker, queue, and dependency-injection framework
  additions as premature.
- Replacement cost is low for HTTP composition and medium for persistence
  adapters, while the application service remains framework-independent.

## Smallest choices

- One `packages/application` boundary plus existing server and persistence
  adapters
- One atomic create-run command rather than incremental graph mutation
- Minimal authenticated REST routes rather than a CLI or web workflow
- PostgreSQL outbox table without publisher, broker, or ledger translation
- Database constraint plus transactional recheck for assignment reservations
- Existing lifecycle contracts and state vocabulary
- Injected clock and UUID generator without a general framework

## Stop conditions

- Stop if lifecycle atomicity cannot include its outbox record in one PostgreSQL
  transaction.
- Stop if implementation requires changing T0003 state vocabularies or contract
  meaning.
- Stop if implementation requires Git/worktrees, accepted intents, ledger
  ingestion, queue jobs, transaction eligibility, commands, or validation.
- Stop if an operation would represent an executing writing agent without a
  T0007 worktree or mark a ticket Done/run completed without T0013 verification
  evidence.
- Stop if state-changing routes cannot be locally authenticated without
  weakening verification.
- Stop if concurrency safety relies only on an in-process mutex.
- Stop if a migration would rewrite `0001` or `0002`.
- Stop if a dependency is needed before its maintenance, license, security,
  transitive impact, and replacement cost are evaluated.
- Stop before implementation unless a separate `plan_validator` returns `GO`
  and a human explicitly promotes the ticket to Ready.

## Readiness

This Draft resolves graph creation, lifecycle orchestration, assignment
exclusivity, authentication, atomic persistence, and outbox ownership while
preserving later-ticket boundaries. Separate read-only validation and explicit
human promotion remain mandatory before Ready.
