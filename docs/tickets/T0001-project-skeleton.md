# T0001 — Project Skeleton

Status: Ready

## Outcome

The approved monorepo boundaries exist, and the minimal server, worker, web, and
CLI shells can be installed, started, tested, and built successfully.

## Reason

All future work depends on having a stable development foundation.

## Dependencies

None.

## Preconditions

- Product technology choices have been approved.
- The repository contains no conflicting application scaffold.

## Allowed scope

- `package.json`
- `pnpm-lock.yaml`
- `pnpm-workspace.yaml`
- build-tool configuration
- TypeScript configuration
- lint and formatting configuration
- `apps/server/`
- `apps/worker/`
- `apps/web/`
- `packages/cli/`
- `packages/domain/`
- `packages/config/`
- `fixtures/`
- test configuration
- setup sections of `README.md`

## Protected areas

- `docs/PRODUCT.md`
- Fundamental architecture decisions not required for the skeleton
- Any future feature implementation

## Requirements

- Create the approved application scaffold.
- Use the Node.js 24 LTS, strict TypeScript, ECMAScript module, and pnpm
  workspace decisions from ADR 0001.
- Create separate server, worker, web, CLI, domain, shared-configuration, and
  fixture boundaries without adding future product behavior.
- Add root development, formatting, lint, type-check, test, and build scripts.
- Provide a minimal Fastify server with a `GET /version` JSON response.
- Provide a minimal CLI entry point with a `blackbox --version` command.
- Render a minimal React application shell through Vite.
- Provide a compilable worker entry point without queue or execution behavior.
- Include basic automated smoke tests for the server, CLI, and web shell.
- Document setup and execution commands in `README.md`.

## Non-goals

- Authentication
- Persistence
- API integration
- Domain-specific models
- Production deployment
- Final visual design
- Any feature scheduled after T0001

## Interfaces affected

- Root developer command surface.
- Minimal server version endpoint or response.
- Minimal CLI version command.
- Minimal browser application shell.

## Acceptance criteria

- Dependency installation succeeds.
- The API server starts and reports its version.
- The CLI reports its version.
- The web development server starts.
- The application renders without a console error.
- The worker and domain packages compile without introducing product behavior.
- Formatting checks succeed.
- Lint succeeds.
- Type checking succeeds.
- Tests succeed.
- Production build succeeds.
- No future feature is implemented.

## Automated verification

Run the commands defined by the chosen package manager for:

- formatting
- lint
- type checking
- tests
- production build

## Manual verification

1. Install dependencies.
2. Start the API server and confirm its version response.
3. Run the CLI version command.
4. Start the web development server.
5. Open the displayed local URL.
6. Confirm that the application shell appears.
7. Confirm there are no browser-console errors.
8. Stop all development processes.
9. Run the production build.

## Documentation required

- Update setup commands in `README.md`.
- Do not mark the ticket Done until manual verification is accepted.

## Rollback

Revert the ticket commit or delete the ticket branch.
