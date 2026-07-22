# Ticket Index

## Status definitions

- **Draft** — The outcome is understood, but acceptance criteria or implementation boundaries are incomplete.
- **Ready** — Scope, dependencies, acceptance criteria, verification, and ownership boundaries are complete.
- **In progress** — One writing agent owns the ticket and implementation has started.
- **Review** — Implementation is complete and undergoing independent code and architecture review.
- **Manual verification** — Automated checks pass and the documented user-facing workflow is being verified.
- **Blocked** — Work cannot continue because a named dependency or decision is unresolved.
- **Done** — Automated checks, independent review, manual verification, and documentation updates are complete.

## Milestones

- **M0 — Foundation:** Repository, development environment, CI, domain contracts, and persistence skeleton.
- **M1 — Transactional execution:** Runs, tickets, worktrees, intents, agent execution, ledger, and validation.
- **M2 — Conflict prevention:** Deterministic conflict detection, admission decisions, and integration staging.
- **M3 — Causal debugging:** Dependency graph, failure slicing, replay, and evidence-backed reports.
- **M4 — Guardrail loop and demo:** Rule evaluation, benchmark scenarios, web workflow, and documented demonstration.

## Tickets

| ID    | Title                                               | Status | Dependencies                             |
| ----- | --------------------------------------------------- | ------ | ---------------------------------------- |
| T0001 | Project Skeleton                                    | Done   | None                                     |
| T0002 | Development Tooling and CI                          | Done   | T0001                                    |
| T0003 | Core Domain Contracts                               | Done   | T0001                                    |
| T0004 | PostgreSQL Persistence and Migrations               | Done   | T0002, T0003                             |
| T0005 | Repository Registration and Git Adapter             | Done   | T0003                                    |
| T0006 | Run, Ticket, and Assignment Lifecycle               | Done   | T0003, T0004                             |
| T0007 | Isolated Worktree Manager                           | Done   | T0005, T0006                             |
| T0008 | Versioned Intent Registry                           | Draft  | T0003, T0004, T0006                      |
| T0009 | Append-Only Execution Ledger                        | Draft  | T0003, T0004, T0006                      |
| T0010 | Worker Queue and Job Lifecycle                      | Draft  | T0004, T0006                             |
| T0011 | Instrumented Command Runner                         | Draft  | T0007, T0009, T0010                      |
| T0012 | Codex CLI Adapter                                   | Draft  | T0011                                    |
| T0013 | Validation Definitions and Runner                   | Draft  | T0007, T0009, T0010, T0011               |
| T0014 | Transaction State Machine                           | Draft  | T0006, T0008, T0009, T0013               |
| T0015 | Deterministic Conflict Engine                       | Draft  | T0008, T0009, T0014                      |
| T0016 | Integration Worktree and Prepare Pipeline           | Draft  | T0007, T0013, T0014, T0015               |
| T0017 | Run Timeline and Evidence API                       | Draft  | T0009, T0014, T0015                      |
| T0018 | Web Run Dashboard                                   | Draft  | T0002, T0017                             |
| T0019 | Causal Graph Projection                             | Draft  | T0008, T0009, T0013, T0015               |
| T0020 | Failure Slice and Earliest-Decisive Analysis        | Draft  | T0019                                    |
| T0021 | Replay Bundle and Local Replay                      | Draft  | T0007, T0009, T0013, T0016               |
| T0022 | Failure Report UI                                   | Draft  | T0018, T0020, T0021                      |
| T0023 | Guardrail Definition and Evaluation                 | Draft  | T0015, T0020, T0021                      |
| T0024 | Deterministic Scenario Harness                      | Draft  | T0013, T0015, T0021                      |
| T0025 | MVP Benchmark Suite                                 | Draft  | T0020, T0023, T0024                      |
| T0026 | End-to-End Codex Demo                               | Draft  | T0012, T0016, T0018, T0022, T0023, T0025 |
| T0027 | Security, Redaction, and Replay Hardening           | Draft  | T0011, T0017, T0021                      |
| T0028 | Release Documentation and Installation Verification | Draft  | T0026, T0027                             |

## Ticket details

### T0001 — Project Skeleton

Milestone: M0 — Foundation

Goal:

Create the repository layout and minimal runnable application boundaries without adding product behavior.

Acceptance criteria:

- The repository contains clearly separated server, worker, web, CLI, shared-domain, and test-fixture areas, whether implemented as packages or directories appropriate to the chosen stack.
- A root README identifies Blackbox as a transactional runtime and causal debugger for coding-agent fleets.
- `docs/PRODUCT.md`, `docs/ARCHITECTURE.md`, `docs/STATUS.md`, `docs/TICKETS.md`, and `docs/VERIFICATION.md` are present.
- The repository includes an architecture decision record documenting the selected language, framework, package manager, and monorepo strategy.
- A minimal server and CLI entry point can execute and report their version.
- No database, agent execution, or Git behavior is implemented in this ticket.

Automated verification:

- Repository formatting check passes.
- Minimal server and CLI smoke tests pass.
- Production build completes.

Manual verification:

- Follow the README from a clean checkout.
- Start the minimal server.
- Run the CLI version command.
- Confirm no undocumented global dependency is required.

### T0002 — Development Tooling and CI

Milestone: M0 — Foundation

Goal:

Establish one canonical local and CI verification workflow.

Acceptance criteria:

- Formatting, lint, type checking, unit tests, integration tests, and production build have documented commands.
- A single aggregate verification command runs all checks appropriate before merge.
- CI runs the same underlying commands as local development.
- Tool versions are pinned or constrained reproducibly.
- Test output and failure exit codes are preserved.

Manual verification:

- Intentionally introduce one formatting, type, and test failure and confirm each gate fails visibly.
- Revert the failures and confirm the aggregate command passes.

### T0003 — Core Domain Contracts

Milestone: M0 — Foundation

Goal:

Define framework-independent domain types and state transitions.

Acceptance criteria:

- Versioned schemas exist for runs, tickets, assignments, intent contracts, resource selectors, transactions, ledger-event envelopes, conflicts, validations, causal findings, and guardrails.
- Transaction and ticket state transitions reject invalid transitions.
- Unknown schema versions fail safely.
- Domain packages do not depend on web, database, queue, Git, Codex, or model-provider packages.
- Schema and state-machine behavior has unit tests.

Manual verification:

- Inspect generated or documented schema examples.
- Confirm an invalid transaction transition returns a stable domain error.

### T0004 — PostgreSQL Persistence and Migrations

Milestone: M0 — Foundation

Goal:

Create durable storage for command-side records and establish migration discipline.

Acceptance criteria:

- Local development can start a supported PostgreSQL instance with one documented command.
- Initial migrations create tables for runs, tickets, assignments, intents, transactions, and schema-version metadata.
- Repository interfaces hide database implementation details from domain logic.
- Migration up and clean-database setup are tested.
- Persisted extensible payloads include explicit schema versions.

Manual verification:

- Start from an empty database.
- Apply migrations.
- Create and read one record of each initial aggregate through application interfaces.

### T0005 — Repository Registration and Git Adapter

Milestone: M1 — Transactional execution

Goal:

Register a local Git repository and expose safe, testable Git primitives.

Acceptance criteria:

- The system validates that a configured path is a Git repository.
- It records repository identity, default branch, current head, and cleanliness.
- A `GitRepository` interface supports head lookup, diff generation, branch creation, patch creation, and status inspection.
- Git command failures return typed errors with sanitized output.
- Integration tests use temporary repositories.

### T0006 — Run, Ticket, and Assignment Lifecycle

Milestone: M1 — Transactional execution

Goal:

Allow users to create a coordinated run with dependency-aware tickets and one writing-agent assignment per active ticket.

Acceptance criteria:

- CLI or API can create and inspect runs and tickets.
- Cyclic ticket dependencies are rejected.
- A ticket cannot start until dependencies are Done.
- Only one active writing assignment may own a ticket.
- Lifecycle transitions are persisted and emitted as domain events.

### T0007 — Isolated Worktree Manager

Milestone: M1 — Transactional execution

Goal:

Give each writing assignment an isolated Git worktree created from the run's recorded base commit.

Acceptance criteria:

- Worktrees use deterministic, collision-safe paths.
- Assignment setup verifies the base commit and clean initial state.
- One assignment cannot access another through worktree-manager APIs.
- Patch generation and changed-path enumeration are supported.
- Cleanup refuses to remove retained or active worktrees.
- Integration tests cover concurrent worktree creation and cleanup.

### T0008 — Versioned Intent Registry

Milestone: M1 — Transactional execution

Goal:

Store and validate agent intent contracts before work begins.

Acceptance criteria:

- Every writing assignment requires an accepted intent before execution.
- Intent revisions are append-only and sequentially versioned.
- Resource selectors support repository, commit, path, symbol, migration identifier, API contract, and validation definition.
- Assumptions may reference expected resource versions and invalidation severity.
- API and CLI can inspect current and historical intent versions.

### T0009 — Append-Only Execution Ledger

Milestone: M1 — Transactional execution

Goal:

Create the immutable event foundation for timelines, replay, and diagnosis.

Acceptance criteria:

- Producers can append versioned event batches idempotently.
- Per-producer sequence gaps and duplicates are detected and reported.
- Existing events cannot be updated through supported application paths.
- Events include run, ticket, assignment, transaction, correlation, and causation identifiers where applicable.
- A projection can rebuild a basic run timeline from ledger events.

### T0010 — Worker Queue and Job Lifecycle

Milestone: M1 — Transactional execution

Goal:

Execute long-running jobs outside the API process with visible cancellation and retry behavior.

Acceptance criteria:

- Agent, validation, replay, and analysis job kinds are represented.
- Jobs support leases, heartbeats, cancellation, bounded retries, and terminal failure.
- Handlers are idempotent or explicitly marked non-retriable.
- API users can inspect job status without reading queue internals.

### T0011 — Instrumented Command Runner

Milestone: M1 — Transactional execution

Goal:

Run commands inside an assigned worktree while recording structured execution evidence.

Acceptance criteria:

- Commands run under an explicit working directory and allowlisted environment.
- Start, completion, timeout, cancellation, exit status, and output artifact events are recorded.
- Path traversal outside configured roots is rejected.
- Child processes are terminated on cancellation.
- Environment redaction is applied before persistence.
- Commands cannot execute in the API server process.

### T0012 — Codex CLI Adapter

Milestone: M1 — Transactional execution

Goal:

Launch a local Codex CLI process as a Blackbox writing agent without embedding Codex-specific concepts in the domain model.

Acceptance criteria:

- The adapter verifies Codex CLI availability and reports a clear setup error when missing.
- A configured ticket and intent can be passed to Codex in its assigned worktree.
- Process output and termination are captured through the command runner.
- Adapter-specific metadata is isolated behind an agent-runner interface.
- A manual test runs a harmless fixture ticket through an installed Codex CLI.

### T0013 — Validation Definitions and Runner

Milestone: M1 — Transactional execution

Goal:

Run repository-defined ticket and integration validations with complete evidence.

Acceptance criteria:

- `.blackbox/config.yaml` supports versioned validation definitions.
- Validation results distinguish pass, fail, timeout, cancelled, skipped, and unavailable.
- Required skipped or unavailable checks prevent commit eligibility.
- Output, duration, environment fingerprint, and definition version are recorded.
- Ticket acceptance criteria can reference validation evidence.

### T0014 — Transaction State Machine

Milestone: M1 — Transactional execution

Goal:

Model an agent change from declaration through commit eligibility or terminal failure.

Acceptance criteria:

- All states and legal transitions in `ARCHITECTURE.md` are implemented.
- Each transition records a ledger event.
- Prepare and commit-time transitions recheck required preconditions.
- Invalid transitions are rejected atomically.
- Cancellation and failure leave explicit terminal or recoverable states.

### T0015 — Deterministic Conflict Engine

Milestone: M2 — Conflict prevention

Goal:

Detect high-confidence, evidence-backed conflicts without model judgment.

Initial detectors:

- Overlapping declared writes.
- Declared write versus observed undeclared write.
- Stale base commit at prepare.
- Changed resource version for a declared assumption.
- Duplicate migration identifier.
- Ticket dependency violation.

Acceptance criteria:

- Detectors implement one stable interface.
- Findings include involved transactions, resources, evidence, detector version, and decision severity.
- The engine supports allow, warn, wait, approval-required, and block decisions.
- Curated positive and negative fixtures measure recall and false positives.

### T0016 — Integration Worktree and Prepare Pipeline

Milestone: M2 — Conflict prevention

Goal:

Apply eligible prepared patches to an isolated integration worktree and validate their combined state.

Acceptance criteria:

- The integration worktree starts from a recorded commit.
- Patch application order is explicit and recorded.
- Git application conflicts become structured conflict findings.
- Cross-agent validations run only after all selected patches apply.
- No canonical protected branch is modified.
- The resulting commit or patch set is exportable for user review.

### T0017 — Run Timeline and Evidence API

Milestone: M2 — Conflict prevention

Goal:

Expose authoritative read models for run inspection.

Acceptance criteria:

- APIs return current run, ticket, assignment, transaction, validation, conflict, and job state.
- Timeline entries link to raw evidence events and artifacts.
- Pagination and stable ordering are supported.
- Rebuilding projections from the ledger produces equivalent visible state.
- Sensitive fields are redacted in API responses.

### T0018 — Web Run Dashboard

Milestone: M2 — Conflict prevention

Goal:

Provide a usable local interface for monitoring and reviewing a multi-agent run.

Acceptance criteria:

- Users can view runs, ticket dependencies, agent status, transaction states, intents, validations, and conflicts.
- The timeline can be filtered by agent and event type.
- Conflict explanations link to supporting evidence.
- Loading, empty, error, and partial-data states are handled.
- Browser tests cover one successful run and one blocked conflict.

### T0019 — Causal Graph Projection

Milestone: M3 — Causal debugging

Goal:

Construct typed provenance and dependency relationships from recorded execution.

Acceptance criteria:

- Deterministic edges connect intents, assumptions, commands, mutations, validations, conflicts, and outcomes.
- Inferred edges include confidence, analyzer version, and evidence.
- The graph can answer backward-dependency queries from a failed validation.
- Projection rebuild is deterministic for identical inputs and versions.
- Graph records reference source events rather than duplicating their payloads as truth.

### T0020 — Failure Slice and Earliest-Decisive Analysis

Milestone: M3 — Causal debugging

Goal:

Produce an evidence-backed causal slice and rank candidate earliest decisive events.

Acceptance criteria:

- Analysis begins from a specific failed outcome.
- Deterministic backward slicing excludes unrelated events in curated fixtures.
- Reports distinguish root, enabling, propagation, and detection events.
- Multiple candidate causes and uncertainty can be represented.
- Ground-truth fixtures test exact-or-equivalent earliest-event accuracy.
- Every report claim links to evidence.

### T0021 — Replay Bundle and Local Replay

Milestone: M3 — Causal debugging

Goal:

Reconstruct supported local failures from a portable, validated bundle.

Acceptance criteria:

- Bundles contain repository commit or patch state, resolved configuration, supported command inputs, validation definitions, and format versions.
- Bundle integrity is verified by hashes before execution.
- Replay defaults to an isolated, network-disabled environment.
- Results distinguish exact, semantically equivalent, divergent, and unsupported replay.
- Original run data is never mutated.

### T0022 — Failure Report UI

Milestone: M3 — Causal debugging

Goal:

Make causal reports understandable and auditable by an engineer.

Acceptance criteria:

- The UI shows failed outcome, causal path, earliest-decisive candidates, contributing agents, confidence, alternatives, and limitations.
- Every node can open its supporting event or artifact.
- Deterministic and inferred relationships are visually distinguishable.
- The user can launch a supported replay from the report.
- Browser tests cover report navigation and replay-status display.

### T0023 — Guardrail Definition and Evaluation

Milestone: M4 — Guardrail loop and demo

Goal:

Represent, evaluate, and manually activate prevention rules derived from supported failure classes.

Acceptance criteria:

- A constrained versioned guardrail schema exists.
- Candidate rules can be generated from at least two deterministic failure templates.
- Evaluation runs candidates against selected failing and successful scenarios.
- Results report prevented failures, unnecessary blocks, unsupported cases, and execution cost.
- Activation requires explicit user approval and is recorded.
- Historical versions remain inspectable.

### T0024 — Deterministic Scenario Harness

Milestone: M4 — Guardrail loop and demo

Goal:

Create reproducible simulated coding-agent scenarios with known final state and causal ground truth.

Acceptance criteria:

- Scenarios can create temporary repositories, tickets, scripted agent actions, validations, and expected outcomes.
- The harness supports controlled concurrency and execution order.
- Faults can be injected as stale bases, write overlap, migration collisions, assumption invalidation, and integration-test failures.
- Scenario results are machine-readable and retained as artifacts.
- A scenario can run without a real model or Codex installation.

### T0025 — MVP Benchmark Suite

Milestone: M4 — Guardrail loop and demo

Goal:

Measure the product against the success targets in `PRODUCT.md`.

Acceptance criteria:

- The suite includes at least twenty failure scenarios and twenty safe parallel scenarios.
- Metrics include deterministic conflict recall, unnecessary blocking, replay fidelity, earliest-decisive-step accuracy, and guardrail utility.
- Ground truth is versioned separately from analyzer output.
- Benchmark changes require explicit review and produce a comparison report.
- CI runs a bounded core suite; the full suite is available through a documented command.

### T0026 — End-to-End Codex Demo

Milestone: M4 — Guardrail loop and demo

Goal:

Demonstrate four or more Codex agents performing a coordinated repository change with prevention, failure diagnosis, replay, and guardrail evaluation.

Acceptance criteria:

- The demo uses a documented fixture repository and stable tickets.
- At least four writing agents run in isolated worktrees.
- At least one conflict is prevented before integration.
- At least one seeded semantic or integration failure reaches the debugger.
- The report identifies the expected causal chain.
- A replay reproduces the supported failure.
- An approved candidate guardrail prevents recurrence in a rerun without blocking the documented safe scenario.
- The demo can be repeated from a clean checkout using documented steps.

### T0027 — Security, Redaction, and Replay Hardening

Milestone: M4 — Guardrail loop and demo

Goal:

Close the MVP's highest-risk command execution, logging, artifact, and replay issues.

Acceptance criteria:

- Path confinement, environment allowlisting, and secret redaction have adversarial tests.
- API and artifact access require local authentication.
- Replay bundles reject path traversal, unsupported versions, and hash mismatches.
- Network-disabled replay is verified.
- A threat model documents residual risks and non-goals.

### T0028 — Release Documentation and Installation Verification

Milestone: M4 — Guardrail loop and demo

Goal:

Make the MVP installable and verifiable by a technically capable new user.

Acceptance criteria:

- README covers prerequisites, installation, configuration, development, verification, and the demo.
- All documented commands are executed from a clean environment.
- Architecture and status documents reflect the shipped implementation.
- Known limitations and unsupported replay boundaries are explicit.
- A release checklist records successful build, tests, lint, type checking, browser tests, benchmark core, manual demo, and security review.

## Ticket rules

- A ticket must have verifiable acceptance criteria before becoming Ready.
- A ticket must identify its architectural boundaries and prohibited changes before becoming Ready.
- Dependencies must be Done before implementation starts unless the ticket explicitly documents a safe interface-first exception.
- Only one writing agent may own a ticket.
- Independent read-only analysis and review agents are allowed.
- An agent must not modify files outside its ticket's declared ownership without an approved intent revision.
- Every implementation ticket must specify automated checks and manual verification steps.
- A ticket must update relevant documentation in the same change.
- A ticket enters Review only after its writing agent has run all ticket-specific checks.
- A ticket becomes Done only after automated verification, independent review, manual verification, and documentation review.
- Reviewer findings classified as blockers must be resolved or explicitly accepted by a human owner.
- No ticket may weaken an architectural invariant without an approved architecture decision record.
- New dependencies require the evaluation described in `ARCHITECTURE.md`.
- Defects found during ticket work require a regression test when practical.
- Benchmark ground truth must not be modified merely to make implementation output pass.
