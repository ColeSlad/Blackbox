# Blackbox

## Requirements

- Node.js 24.18.0
- Corepack with pnpm 10.31.0
- Docker Engine with Docker Compose v2

## Setup

```sh
corepack enable
pnpm install --frozen-lockfile
pnpm db:up
pnpm db:migrate
```

The local PostgreSQL 17 service binds only to `127.0.0.1:55432`, uses the
non-secret development defaults in `.env.example`, and stores data in the
named `blackbox-postgres-data` volume. Copy `.env.example` to `.env` only when
you need to override those local defaults; actual `.env` files are ignored.

## Development

Run each process from a separate terminal:

```sh
pnpm dev:server
pnpm dev:worker
pnpm dev:web
```

The API listens on `http://127.0.0.1:3000` and exposes `GET /version`. The web
development server prints its local URL. Run the compiled CLI after building:

```sh
pnpm build
pnpm exec blackbox --version
```

## Verification

Run the canonical pre-merge verification command:

```sh
pnpm verify
```

It runs formatting, lint, type checking, unit tests, the production build, and
built-boundary integration tests in that order, stopping at the first failure.
The same command runs in GitHub Actions for pull requests, pushes to `main`, and
manual workflow dispatches. PostgreSQL must be healthy before verification;
the integration gate creates isolated test databases and fails rather than
skipping when the service is unavailable.

The framework-independent product boundary is split between
`@blackbox/domain`, which owns stable errors and pure lifecycle rules, and
`@blackbox/contracts`, which owns strict version-one TypeBox wire schemas and
unknown-value parsers. Inspectable JSON examples for all eleven schema families
live under `fixtures/contracts/`.

`@blackbox/persistence` provides database-neutral create/read repository
interfaces for runs, tickets with dependencies, assignments, intent versions,
and transactions. Its PostgreSQL adapters use parameterized Postgres.js
templates. Forward-only SQL migrations live under
`packages/persistence/migrations/` and are recorded with SHA-256 checksums.

## Database Commands

```sh
pnpm db:up
pnpm db:migrate
pnpm db:status
pnpm db:smoke
pnpm test:database
pnpm db:down
```

`pnpm db:down` stops the service but retains the named development volume.
`pnpm db:smoke` is local-only and creates one disposable verification record
for each initial aggregate through public repository interfaces.

The development reset is destructive. It refuses remote hosts and requires the
explicit confirmation flag:

```sh
pnpm db:reset:dev -- --confirm-reset
```

To remove the disposable development volume completely, first stop the service
and then deliberately run `docker compose down --volumes`. Applied migrations
are forward-only; no automatic production down migration is provided.

The individual commands remain available:

```sh
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test:unit
pnpm build
pnpm test:integration
pnpm test:database
pnpm --filter @blackbox/domain test
pnpm --filter @blackbox/contracts test
pnpm --filter @blackbox/persistence test
```

`pnpm test` remains a compatibility alias for `pnpm test:unit`. Run
`pnpm build` before invoking `pnpm test:integration` independently so the smoke
test can exercise the current built CLI, server, worker, and web assets. Start
PostgreSQL with `pnpm db:up` before either database or aggregate integration
verification.
