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
BLACKBOX_API_TOKEN="$(node -e 'console.log(require("node:crypto").randomBytes(32).toString("hex"))')" pnpm dev:server
pnpm dev:worker
pnpm dev:web
```

The API listens on `http://127.0.0.1:3000`. `GET /version` remains public; all
`/v1` lifecycle routes require the explicitly configured local bearer token.
The token is not stored by Blackbox. The web development server prints its
local URL. Run the compiled CLI after building:

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

`@blackbox/application` coordinates the dependency-aware run, ticket, and
assignment-reservation lifecycle through a database-neutral transaction port.
It creates complete run graphs atomically, starts runs, readies eligible
tickets, reserves one future writer, blocks or cancels tickets, and fails or
cancels runs. Every aggregate mutation writes one immutable version-one domain
event to `lifecycle_outbox` in the same transaction. These pending delivery
records are not execution-ledger envelopes.

Ticket start, assignment activation, ticket completion, and run completion are
deliberately unavailable. T0007 must first bind a clean exact-base worktree
before execution can start, and T0013 must persist passing verification evidence
before completion can succeed.

## Local Lifecycle API

Start a migrated database and the server with a disposable token:

```sh
pnpm db:up
pnpm db:migrate
export BLACKBOX_API_TOKEN="$(node -e 'console.log(require("node:crypto").randomBytes(32).toString("hex"))')"
pnpm dev:server
```

In another terminal, reuse that token to create and inspect a run:

```sh
curl --fail-with-body \
  -H "Authorization: Bearer $BLACKBOX_API_TOKEN" \
  -H "Content-Type: application/json" \
  --data @fixtures/lifecycle/create-run-v1.json \
  http://127.0.0.1:3000/v1/runs

curl --fail-with-body \
  -H "Authorization: Bearer $BLACKBOX_API_TOKEN" \
  http://127.0.0.1:3000/v1/runs/RUN_UUID
```

Lifecycle commands use `POST` on these paths:

- `/v1/runs/RUN_UUID/start`
- `/v1/runs/RUN_UUID/tickets/TICKET_UUID/ready`
- `/v1/runs/RUN_UUID/tickets/TICKET_UUID/assignments` with an `agent_id`
- `/v1/runs/RUN_UUID/tickets/TICKET_UUID/block`
- `/v1/runs/RUN_UUID/tickets/TICKET_UUID/cancel`
- `/v1/runs/RUN_UUID/fail`
- `/v1/runs/RUN_UUID/cancel`

Responses contain the deterministically ordered run graph. Errors contain only
a stable code and safe message. The server binds to loopback and this bearer
token is local authentication, not remote or multi-user authorization.

`@blackbox/git` provides a database-neutral `GitRepository` boundary for
non-bare local working trees on macOS and Linux. Registration requires an
explicit local default-branch name and records canonical working-tree and
common-Git-directory identity, exact HEAD and default-branch commits, attached
or detached state, and cleanliness. The adapter uses the installed native Git
executable after capability probes; it exposes bounded status, deterministic
binary patch, exact head, and atomic branch-ref creation primitives without
checkout or worktree behavior. Patch creation uses a temporary alternate index
and object directory so it does not mutate the real index, working tree, HEAD,
or protected branch. Status inspection similarly compares no-filter snapshots
of HEAD, the real-index entries, and the working filesystem through temporary
indexes rather than asking target-repository porcelain to hash filtered files.
Scratch roots and child temp variables are controlled by the adapter and remain
outside both canonical repository identities.

Repositories that require clean/process filters, sparse checkout, partial
clone, alternates, grafts, or tracked gitlinks are refused rather than invoking
helpers or silently broadening the boundary. Windows, bare and unborn
repositories, remote operations, persistence, worktree management, and patch
application are not supported by this package.

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
pnpm --filter @blackbox/application test
pnpm --filter @blackbox/git test
```

`pnpm test` remains a compatibility alias for `pnpm test:unit`. Run
`pnpm build` before invoking `pnpm test:integration` independently so the smoke
test can exercise the current built CLI, server, worker, and web assets. Start
PostgreSQL with `pnpm db:up` before either database or aggregate integration
verification.
