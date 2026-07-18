# Blackbox

## Requirements

- Node.js 24.18.0
- Corepack with pnpm 10.31.0

## Setup

```sh
corepack enable
pnpm install --frozen-lockfile
```

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
manual workflow dispatches.

The framework-independent product boundary is split between
`@blackbox/domain`, which owns stable errors and pure lifecycle rules, and
`@blackbox/contracts`, which owns strict version-one TypeBox wire schemas and
unknown-value parsers. Inspectable JSON examples for all eleven schema families
live under `fixtures/contracts/`.

The individual commands remain available:

```sh
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test:unit
pnpm build
pnpm test:integration
pnpm --filter @blackbox/domain test
pnpm --filter @blackbox/contracts test
```

`pnpm test` remains a compatibility alias for `pnpm test:unit`. Run
`pnpm build` before invoking `pnpm test:integration` independently so the smoke
test can exercise the current built CLI, server, worker, and web assets.
