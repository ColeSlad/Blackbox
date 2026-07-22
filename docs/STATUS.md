# Repository Status

Last updated: 2026-07-21
Last validated base commit: 924fcfc
Current milestone: M1 — Transactional execution

## Completed capabilities

- Product definition for the transactional multi-agent coding runtime.
- Initial architecture and system-boundary definition.
- Ticket dependency graph and verification policy.
- Initial MVP success metrics and benchmark targets.
- Accepted implementation-platform and Codex CLI boundary decisions.
- A pnpm workspace separating server, worker, web, CLI, domain,
  shared-configuration, and fixture boundaries.
- A minimal Fastify server exposing `GET /version`, a `blackbox --version` CLI,
  a React/Vite application shell, and a compilable worker entry point.
- Reproducible root commands for formatting, linting, type checking, tests, and
  production builds.
- A canonical fail-fast `pnpm verify` command covering formatting, linting, type
  checking, unit tests, production build, and built-boundary integration tests.
- A least-privilege GitHub Actions verification workflow using the exact Node.js
  and pnpm versions required locally.
- Dependency-free domain errors, four lifecycle vocabularies, immutable
  transition tables, and pure transition functions for runs, tickets,
  assignments, and transactions.
- Eleven strict version-one TypeBox contract families with safe parsers,
  stable errors, inspectable fixtures, and deterministic package-boundary
  enforcement.
- A pinned PostgreSQL 17.10 local Compose service with health checking, a named
  development volume, and CI parity.
- An in-repository ordered SQL migrator with transactional application,
  SHA-256 metadata, no-op status, and changed, missing, duplicate, ambiguous,
  and future-version refusal.
- Database-neutral create/read repositories and PostgreSQL adapters for runs,
  tickets with dependencies, assignments, intent versions, and transactions.
- A database-neutral `GitRepository` boundary for canonical non-bare local
  repository registration, exact HEAD/default-branch inspection, and
  deterministic changed-path status.
- Helper-safe native-Git operations for deterministic binary-capable patches
  from exact commits and collision-safe branch-ref creation without changing
  the checked-out branch, index, or working tree.
- A framework-independent lifecycle application service with atomic run-graph
  creation, deterministic inspection, run start, dependency-aware ticket
  readiness, one future-writer reservation, and ticket/run terminal cascades.
- A database-neutral lifecycle unit-of-work boundary and PostgreSQL adapter,
  migration `0003` graph/ownership constraints, and immutable version-one
  per-aggregate lifecycle outbox records.
- Local bearer-authenticated version-one lifecycle routes with stable sanitized
  errors while `GET /version` remains public.
- Static server-owned repository UUID bindings and deterministic exact-base
  assignment worktrees with persisted ownership and recovery state.
- Assignment-bound worktree inspection and binary patch generation, explicit
  retention, safe non-forced terminal cleanup, and an atomic worktree-backed
  ticket-start and assignment-activation guard.

## In progress

- No product ticket is currently in progress. T0008 remains Draft and requires
  separate validation and explicit human promotion before implementation.

## Current limitations

- The server exposes the local authenticated T0006 lifecycle API but no hosted,
  remote, role-based, browser-session, or CLI product workflow.
- The CLI implements only `blackbox --version`.
- The web application is a minimal shell with no product workflow or API
  integration.
- The worker has no queue, job lifecycle, or agent-execution behavior.
- Domain and contract packages define syntax and structurally legal lifecycle
  edges only. They do not orchestrate runs, resolve resources, persist records,
  emit events, execute validations, detect conflicts, analyze causality, or
  evaluate guardrails.
- No CLI workflow or worker job consumes the lifecycle service yet.
- Repository identity is bound through static server-owned local configuration;
  there is no registration API or durable repository aggregate.
- Ticket start and assignment activation require a bound active clean worktree.
  Ticket completion and run completion remain unavailable until T0013 provides
  persisted passing verification evidence.
- Lifecycle outbox records are pending immutable domain-delivery records only;
  publishing, consumption, producer sequences, hashing, and the execution
  ledger remain T0009 work.
- Persistence is local-development and CI infrastructure only; hosted database
  configuration, production migration operations, backups, and down migrations
  are not provided.
- The product Codex subprocess adapter has not been implemented or validated.
- The Git adapter supports native Git on macOS and Linux only and refuses bare,
  unborn, sparse, partial-clone, alternate-object, grafted, gitlink-containing,
  and clean/process-filter repositories. It supports bounded structured
  worktree operations but does not apply patches or access remotes.
- Filesystem-read instrumentation remains an open technical decision.
- Causal diagnosis metrics currently have definitions but no benchmark implementation.
- The MVP is limited to local Git repositories and coding-agent effects.

## Installed dependencies

- Node.js 24 LTS and pnpm 10.31.0 are the required development platform.
- Runtime packages are Fastify 5.10.0, React 19.2.7, and React DOM 19.2.7.
- `packages/contracts` uses exactly `typebox@1.3.6`; registry metadata reports
  MIT licensing and no runtime, peer, or optional dependencies.
- `packages/persistence` uses exactly `postgres@3.4.9`; registry metadata reports
  Unlicense, publication on 2026-04-05, Node ESM compatibility, and no client
  runtime transitive dependencies. The repository advisory audit reports zero
  known npm vulnerabilities across 299 dependencies.
- Local and CI PostgreSQL use the Docker Official Image tag
  `postgres:17.10-alpine3.24` at immutable digest
  `sha256:742f40ea20b9ff2ff31db5458d127452988a2164df9e17441e191f3b72252193`.
  PostgreSQL 17.10 is supported through 2029-11-08.
- The committed lockfile pins the approved TypeScript, Vite, Vitest, ESLint,
  Prettier, TSX, and type-definition toolchain.

## Available commands

- `pnpm install --frozen-lockfile`
- `pnpm dev:server`
- `pnpm dev:worker`
- `pnpm dev:web`
- `pnpm db:up`
- `pnpm db:down`
- `pnpm db:migrate`
- `pnpm db:status`
- `pnpm db:reset:dev -- --confirm-reset`
- `pnpm db:smoke`
- `pnpm test:database`
- `pnpm exec blackbox --version` after building
- `pnpm format:check`
- `pnpm lint`
- `pnpm typecheck`
- `pnpm test`
- `pnpm test:unit`
- `pnpm build`
- `pnpm test:integration` after a production build
- `pnpm verify`
- `pnpm --filter @blackbox/domain test`
- `pnpm --filter @blackbox/contracts test`
- `pnpm --filter @blackbox/git test`
- `pnpm --filter @blackbox/application test`

Planned product command surface:

- `blackbox init`
- `blackbox dev`
- `blackbox run create`
- `blackbox run start`
- `blackbox run inspect`
- `blackbox run replay`
- `blackbox verify`

These commands are not implemented and must not be documented as available elsewhere until verified.

## Verification status

- Dependency installation from the lockfile: pass
- Formatting: pass
- Lint: pass
- Type checking: pass
- Unit tests: pass, including verification-runner ordering, failure propagation,
  and CI policy contracts
- Production build: pass
- Integration tests: pass for built CLI, server, worker, and web boundaries
- Aggregate verification: pass locally under the exact version in `.node-version`
- Compatibility `pnpm test` command: pass
- GitHub-hosted verification: pass for run `29655014542`, job `88107670217`,
  using the canonical `pnpm verify` command
- T0002 static scope, workflow-policy, version-parity, diff, and Codex harness
  checks: pass
- Runtime smoke checks: pass for server, CLI, worker, and web development server
- Browser verification: pass for the rendered application shell with no console errors
- Independent review: pass
- T0002 manual fault probes: pass for visible formatting, type-checking, and
  unit-test failures; all temporary changes were restored and final
  `pnpm verify` passed
- T0003 focused domain tests: pass, 252 tests covering every run, ticket,
  assignment, and transaction state pair plus unknown-state and immutability
  behavior
- T0003 focused contract tests: pass, 82 tests covering all eleven valid
  fixtures, version precedence, strictness, required/null rules, enums,
  uniqueness, recursive JSON, conditional invariants, safe errors, and package
  boundaries
- T0003 domain and contract type checks and builds: pass
- T0003 aggregate `pnpm verify`: pass under Node.js 24.18.0 with formatting,
  lint, all workspace type checks, 347 unit tests, all production builds, and
  built-boundary integration smoke coverage
- T0003 frozen offline install: pass; `pnpm audit --json` reports zero known
  vulnerabilities across 297 dependencies
- T0003 final verification audit: `GO`; fresh independent ticket review: `GO`
  with no unresolved blocker
- T0003 manual verification: pass, recorded exactly once in
  `.codex-runs/manual/T0003.md`
- T0004 Compose configuration and health check: pass with PostgreSQL 17.10 on
  `127.0.0.1:55432`
- T0004 migration, current-status, repeated no-op, smoke, guarded reset, 32
  focused unit tests, and 12 required isolated-database integration tests: pass
- T0004 pinned-image scan: Trivy 0.72.0 with its database updated
  2026-07-18T18:43:59Z reported zero Alpine 3.24.1 OS-package findings and 39
  fixed-version metadata findings in the Go-built `gosu` 1.19 binary: 1
  unknown, 2 low, 21 medium, 14 high, and 1 critical. Govulncheck 1.6.0 with
  the official Go database last modified 2026-07-08 concluded that the exact
  extracted binary is affected by zero vulnerabilities; it also found 3
  vulnerabilities in imported packages and 35 in required modules, but no
  vulnerable calls. All 15 Trivy high/critical CVEs mapped to Go vulnerability
  records with no vulnerable symbol present or reachable; one high finding was
  package-level in `os`, still without a vulnerable symbol.
- T0004 aggregate `pnpm verify`: pass under Node.js 24.18.0 with formatting,
  lint, all workspace type checks, 379 unit tests, 12 required isolated-database
  tests, all production builds, and built-boundary integration smoke coverage.
- T0004 operational, unavailable-database, guarded-reset, remote-host-refusal,
  output-redaction, scope, secret, artifact, and diff checks: pass.
- T0004 dependency audit: zero known npm vulnerabilities across 299
  dependencies.
- T0004 final verification audit: `GO`; initial review blockers were repaired
  by the same sole worker, and the fresh repair review returned `APPROVE` with no
  unresolved blocker.
- T0004 manual verification: pass, recorded exactly once in
  `.codex-runs/manual/T0004.md`.
- T0005 focused Git package tests: pass, 29 tests covering SHA-1/SHA-256
  registration, canonical paths, status, deterministic binary patches, exact
  branch refs, helper defenses, sanitized typed errors, capability refusal, and
  static package boundaries. Fresh-review regressions cover post-registration
  filter refusal, controlled scratch roots under hostile temp variables,
  commit-typed HEAD/default refs, and unsupported absolute-path discovery.
  Status regressions preserve native intent-to-add classification and mark
  unstaged rename destinations absent from the real index as untracked.
- T0005 focused type check and production build: pass.
- T0005 aggregate `pnpm verify`: pass under Node.js 24.18.0 with formatting,
  lint, all workspace type checks, 408 unit tests, all production builds, 12
  required isolated-database tests, and built-boundary integration smoke
  coverage. The initial sandboxed attempt was correctly unsuccessful because
  loopback PostgreSQL access was denied; the scoped local-service rerun passed.
- T0005 final verification audit: `PASS`; fresh independent ticket review:
  `APPROVE`, with no actionable correctness or security defect.
- T0005 manual verification: pass, recorded exactly once in
  `.codex-runs/manual/T0005.md`.
- T0006 focused application tests: pass, 20 tests covering graph validation,
  lifecycle orchestration, every supported edge, locale-independent ordering,
  exact outbox records, late-failure rollback, and static boundaries.
- T0006 focused persistence tests: pass, 32 tests covering database-neutral
  lifecycle boundaries, PostgreSQL adapter behavior, and migration integration.
- T0006 server injection tests: pass, 15 tests covering authentication, public
  version behavior, route composition, safe errors, and deferred execution.
- T0006 isolated database tests: pass, 25 tests across persistence migration and
  lifecycle graph, consistent inspect/cascade concurrency, constraints,
  update/delete/truncate outbox immutability, and late-failure rollback.
- T0006 aggregate `pnpm verify`: pass with formatting, lint, all workspace type
  checks, 442 unit tests, all production builds, 25 isolated database tests, and
  built-boundary integration smoke coverage.
- T0006 final verification audit: `PASS`; fresh independent ticket review:
  `APPROVE`, with no actionable correctness or security finding.
- T0006 manual verification: pass, recorded explicitly in
  `.codex-runs/manual/T0006.md`.
- T0007 aggregate verification: pass under Node.js 24.18.0 with formatting,
  lint, all workspace type checks, 509 unit tests, all production builds, 18
  persistence database tests, 12 application database tests, and built-boundary
  integration smoke coverage.
- T0007 focused Git, worktree, application, server, persistence, concurrency,
  cleanup-matrix, recovery, UUID, binding, ownership, migration, static-policy,
  protected-main, generated-artifact, prohibited-operation, and secret checks:
  pass.
- The retained initial T0007 aggregate log at
  `.codex-runs/tickets/T0007-interactive-resume/20260721T042726Z/pnpm-verify.log`
  failed one of 484 unit tests because a deterministic native-Git integration
  case exceeded Vitest's default five-second timeout; it did not fail an
  assertion. The exact case then passed three consecutive Node.js 24 runs in
  5.15–5.94 seconds after receiving the same bounded 20-second timeout as
  neighboring Git-heavy cases.
- The separate successful T0007 rerun is retained at
  `.codex-runs/tickets/T0007-interactive-resume/20260721T043502Z/pnpm-verify.log`:
  formatting, lint, type checks, 484 unit tests, builds, 30 isolated PostgreSQL
  tests, and integration smoke passed. Its subsequent audit and independent
  review still blocked closure on cleanup-matrix, registration-identity,
  recovery-ownership, ignored-content, canonical-UUID, and stale-documentation
  findings. The recovery-v2 run and focused repair resolved those findings.
- T0007 final verification audit: `PASS`; fresh independent ticket review:
  `APPROVE`, with no finding.
- T0007 manual verification: pass, recorded explicitly in
  `.codex-runs/manual/T0007.md` after the nine-step manual workflow.
- T0008 and later behavior remains unavailable: there is no accepted intent,
  ledger ingestion, queue, command or Codex execution, validation, transaction,
  conflict, integration, replay, or scheduling behavior.
- Browser tests: not available
- Demo scenario: not available
- Codex CLI integration: not validated

## Known issues

- pnpm reports that the transitive esbuild lifecycle script is blocked during
  install; installation, tests, development startup, and production builds pass
  without approving that script.
- The pinned image has nonzero scanner metadata findings in its `gosu` binary.
  Current symbol-level analysis found no applicable reachable high/critical
  vulnerable symbol, but this is not a zero-vulnerability result, does not
  clear future advisories, and must be repeated when the image, scanner, or
  vulnerability databases change.
- The first release must avoid claiming deterministic model replay.
- The architecture depends on an append-only event ledger; schema discipline must be established before feature work.
- The MVP conflict engine needs an explicit list of hard-blocking versus advisory detectors.

## Next eligible ticket

T0008 is dependency-eligible after T0003, T0004, and T0006, but remains Draft.
It requires separate read-only validation and explicit human promotion before
implementation.

## Current milestone status

M0 — Foundation is complete:

- T0001 through T0004 are Done.
- A clean checkout can start the application and database with documented
  commands.
- Formatting, linting, type checking, tests, and production builds run locally
  and in CI.
- Core domain types for runs, tickets, assignments, intents, transactions, and
  ledger events exist with schema tests.
- Accepted architecture decisions document the selected stack and Codex
  integration approach.

M1 — Transactional execution is in progress:

- T0005 through T0007 are Done.
- Repository inspection, lifecycle reservation, and isolated worktree ownership
  now form the accepted local transactional execution foundation.
- Accepted intent, execution-ledger, queue, command-runner, and validation
  increments remain unimplemented.
