# Repository Status

Last updated: 2026-07-18
Last validated commit: d46eef2
Current milestone: M0 — Project setup and architecture validation

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

## In progress

- T0004 — PostgreSQL Persistence and Migrations is Ready and selected for the
  next implementation run; implementation has not begun.
- Docker Engine with Compose v2 is not installed on this host, so the T0004
  writer must not start until that documented prerequisite is available.

## Current limitations

- The server exposes only the version endpoint; no product API exists.
- The CLI implements only `blackbox --version`.
- The web application is a minimal shell with no product workflow or API
  integration.
- The worker has no queue, job lifecycle, or agent-execution behavior.
- Domain and contract packages define syntax and structurally legal lifecycle
  edges only. They do not orchestrate runs, resolve resources, persist records,
  emit events, execute validations, detect conflicts, analyze causality, or
  evaluate guardrails.
- No database schema, persistence layer, repository adapter, or Git behavior
  exists.
- The product Codex subprocess adapter has not been implemented or validated.
- Filesystem-read instrumentation remains an open technical decision.
- Causal diagnosis metrics currently have definitions but no benchmark implementation.
- The MVP is limited to local Git repositories and coding-agent effects.

## Installed dependencies

- Node.js 24 LTS and pnpm 10.31.0 are the required development platform.
- Runtime packages are Fastify 5.10.0, React 19.2.7, and React DOM 19.2.7.
- `packages/contracts` uses exactly `typebox@1.3.6`; registry metadata reports
  MIT licensing and no runtime, peer, or optional dependencies.
- The committed lockfile pins the approved TypeScript, Vite, Vitest, ESLint,
  Prettier, TSX, and type-definition toolchain.

## Available commands

- `pnpm install --frozen-lockfile`
- `pnpm dev:server`
- `pnpm dev:worker`
- `pnpm dev:web`
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
- Database migrations: not available
- Browser tests: not available
- Demo scenario: not available
- Codex CLI integration: not validated

## Known issues

- pnpm reports that the transitive esbuild lifecycle script is blocked during
  install; installation, tests, development startup, and production builds pass
  without approving that script.
- The first release must avoid claiming deterministic model replay.
- The architecture depends on an append-only event ledger; schema discipline must be established before feature work.
- The MVP conflict engine needs an explicit list of hard-blocking versus advisory detectors.

## Next eligible ticket

T0004 — PostgreSQL Persistence and Migrations is the selected Ready ticket, and
its T0002 and T0003 dependencies are Done. Implementation must wait until Docker
Engine with Compose v2 is installed and usable on the execution host.

## Current milestone exit criteria

M0 is complete when:

- T0001 through T0004 are Done.
- A clean checkout can start the application and database with documented commands.
- Formatting, lint, type checking, tests, and production build run locally and in CI.
- Core domain types for runs, tickets, assignments, intents, transactions, and ledger events exist with schema tests.
- Accepted architecture decisions document the selected stack and Codex
  integration approach.
