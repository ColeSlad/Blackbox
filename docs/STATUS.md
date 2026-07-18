# Repository Status

Last updated: 2026-07-17
Last validated commit: not yet recorded
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

## In progress

- No ticket is currently in progress.
- T0002 remains Draft pending separate validation and human promotion to Ready.

## Current limitations

- The server exposes only the version endpoint; no product API exists.
- The CLI implements only `blackbox --version`.
- The web application is a minimal shell with no product workflow or API
  integration.
- The worker has no queue, job lifecycle, or agent-execution behavior.
- The domain package contains no product domain contracts yet.
- No database schema, persistence layer, repository adapter, or Git behavior
  exists.
- The product Codex subprocess adapter has not been implemented or validated.
- Filesystem-read instrumentation remains an open technical decision.
- Causal diagnosis metrics currently have definitions but no benchmark implementation.
- The MVP is limited to local Git repositories and coding-agent effects.

## Installed dependencies

- Node.js 24 LTS and pnpm 10.31.0 are the required development platform.
- Runtime packages are Fastify 5.10.0, React 19.2.7, and React DOM 19.2.7.
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
- `pnpm build`

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
- Tests: pass, including server, CLI, and web smoke coverage
- Production build: pass
- Runtime smoke checks: pass for server, CLI, worker, and web development server
- Browser verification: pass for the rendered application shell with no console errors
- Independent review: pass
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

None. T0002 — Development Tooling and CI depends on completed T0001 but remains
Draft until separately validated and promoted to Ready.

## Current milestone exit criteria

M0 is complete when:

- T0001 through T0004 are Done.
- A clean checkout can start the application and database with documented commands.
- Formatting, lint, type checking, tests, and production build run locally and in CI.
- Core domain types for runs, tickets, assignments, intents, transactions, and ledger events exist with schema tests.
- Accepted architecture decisions document the selected stack and Codex
  integration approach.
