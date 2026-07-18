# Blackbox

## Requirements

- Node.js 24 LTS
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

```sh
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```
