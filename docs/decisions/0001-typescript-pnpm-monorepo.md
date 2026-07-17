# ADR 0001 — TypeScript pnpm monorepo

Status: Accepted

Date: 2026-07-17

## Context

Blackbox needs a local API server, background workers, a browser client, a CLI,
framework-independent domain packages, shared validation schemas, and test
fixtures. The MVP favors a modular monolith and explicit package boundaries over
multiple implementation languages or independently deployed services.

The initial stack must support strict typing, subprocess control, streaming
JSONL, PostgreSQL, browser development, deterministic tests, and a reproducible
workspace without adding an orchestration framework to the domain layer.

## Decision

- Use Node.js 24 LTS as the supported runtime line for the initial MVP.
- Use strict TypeScript and ECMAScript modules for application and shared code.
- Use a pnpm workspace with one lockfile and a pinned `packageManager` value.
- Do not add Nx, Turborepo, or another task orchestrator until measured build
  behavior justifies it; root pnpm scripts coordinate the initial workspace.
- Use these target package boundaries:
  - `apps/server` for the Fastify HTTP API process;
  - `apps/worker` for background execution processes;
  - `apps/web` for the React application built by Vite;
  - `packages/cli` for the `blackbox` command-line entry point;
  - `packages/domain` for framework-independent domain types and rules;
  - `packages/contracts` for versioned boundary schemas when introduced by
    T0003;
  - `packages/config` for shared build and test configuration;
  - `fixtures` for deterministic repository and scenario fixtures.
- T0001 materializes every listed boundary except `packages/contracts`, which
  remains owned by T0003 so the skeleton does not preempt domain-contract work.
- Use Fastify only at the HTTP adapter boundary. Application and domain logic
  must not depend on Fastify types.
- Use React and Vite only in the web package. The browser remains a client of
  authoritative server APIs and does not execute orchestration or Git actions.
- Use Vitest for TypeScript unit and package-level smoke tests. Browser and
  database integration tools may be added only by the tickets that require them.
- T0001 pins exact compatible tool versions in the lockfile and documents the
  supported local installation path; later upgrades follow normal ticket gates.

## Consequences

- Server, worker, CLI, web, and shared packages use one language and type system,
  reducing initial integration and schema-sharing cost.
- Package boundaries remain explicit and can be separated later without first
  splitting deployment units.
- Native or lower-level components may still be introduced behind adapters when
  profiling or operating-system instrumentation demonstrates a need.
- pnpm becomes a documented development prerequisite, but no unpinned global
  dependency may be assumed.
- The web and server frameworks are replaceable because domain and application
  rules remain outside their packages.

## Alternatives considered

- Separate Rust or Go execution-plane services: deferred because they add build,
  packaging, and cross-language schema costs before performance evidence exists.
- Next.js or another full-stack web framework: rejected for the MVP because the
  browser must not own server orchestration and a separate API boundary is
  already required.
- NestJS: rejected initially to avoid framework decorators and dependency
  injection types crossing application boundaries.
- npm or Yarn workspaces: viable, but pnpm was selected for explicit workspace
  support and strict dependency isolation.
- Nx or Turborepo: deferred until workspace size or CI measurements justify an
  additional task graph and cache layer.

## Deferred questions

- PostgreSQL access and migration library selection belongs to T0004.
- Queue implementation belongs to T0010.
- Browser end-to-end tooling belongs to the first ticket requiring browser
  automation.
- Filesystem instrumentation and any native helper remain separate decisions.

## References

- Node.js release guidance: https://nodejs.org/en/about/previous-releases
- pnpm workspaces: https://pnpm.io/workspaces
- Fastify TypeScript reference: https://fastify.dev/docs/latest/Reference/TypeScript/
- Vite supported templates: https://vite.dev/guide/
