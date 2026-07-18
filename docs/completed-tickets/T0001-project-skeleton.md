# T0001 — Project Skeleton

Status: Done

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
- `.gitignore`
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
- Extend `.gitignore` only for dependency directories, compiled output,
  coverage, TypeScript build metadata, and tool caches created by this ticket.
- Document setup and execution commands in `README.md`.

## Dependency evaluation

Exact compatible versions must be pinned by the root `packageManager` field,
package manifests, and `pnpm-lock.yaml`. Add only the direct dependencies named
below. The implementation review must confirm resolved licenses and reject an
unexpected non-permissive license before acceptance.

### `fastify`

- Intended use: HTTP adapter for the minimal server and `GET /version` route.
- Alternatives considered: the Node HTTP standard library would minimize
  dependencies but would duplicate routing, lifecycle, and injection-test
  behavior needed by later API tickets; NestJS would add a broader framework
  and dependency-injection model.
- Security and license notes: production runtime dependency exposed at the HTTP
  boundary; pin it, use no optional plugins in this ticket, review advisories and
  its permissive license in the resolved lockfile, and keep untrusted input out
  of the version route.
- Removal or replacement cost: medium; limited to the server adapter because
  domain and application packages must not import Fastify types.

### `react` and `react-dom`

- Intended use: render the minimal browser application shell.
- Alternatives considered: a vanilla DOM shell would reduce dependencies but
  would be discarded by the planned dashboard; another component framework
  would not reduce the required client/server boundary.
- Security and license notes: browser runtime dependencies; pin both together,
  render no untrusted HTML, and confirm their permissive licenses from the
  resolved packages.
- Removal or replacement cost: medium; confined to `apps/web` with no domain or
  orchestration state owned by React.

### `vite` and `@vitejs/plugin-react`

- Intended use: web development server, React transformation, and production
  browser build.
- Alternatives considered: a custom esbuild/Rollup configuration would expose
  lower-level configuration without reducing the required build surface;
  Next.js would introduce an unnecessary server framework.
- Security and license notes: development/build dependencies that execute during
  local and CI builds; do not expose the development server beyond the local
  interface, pin transitive dependencies, and confirm resolved licenses.
- Removal or replacement cost: low to medium; replacement affects only web build
  configuration and root scripts.

### `typescript`, `@types/node`, `@types/react`, and `@types/react-dom`

- Intended use: strict compilation and type information for the approved Node
  and React platform.
- Alternatives considered: JavaScript with JSDoc would weaken required strict
  boundary checks; other type compilers would diverge from ADR 0001.
- Security and license notes: build-time compiler and declaration packages; pin
  them, do not execute generated declarations, and confirm resolved permissive
  licenses.
- Removal or replacement cost: high because every workspace package uses strict
  TypeScript, but framework types remain outside domain code.

### `tsx`

- Intended use: execute TypeScript server, worker, and CLI entry points during
  local development without a separate watch compiler.
- Alternatives considered: compile before every local run or maintain custom
  Node loader flags; both make the initial development workflow less direct.
- Security and license notes: development-only code loader with local code
  execution privileges; pin it, never use it to execute repository input, and
  confirm its resolved license.
- Removal or replacement cost: low; production and smoke execution can use
  compiled JavaScript.

### `vitest`

- Intended use: server injection, CLI version, web server-render, worker, and
  package smoke tests without browser automation.
- Alternatives considered: Node's test runner would require additional
  TypeScript and Vite integration; Jest would add overlapping transformation
  configuration.
- Security and license notes: test-only dependency that executes repository test
  code; pin it, disable network-dependent tests, and confirm its resolved
  permissive license.
- Removal or replacement cost: medium; tests use its API, while production code
  must not import it.

### ESLint packages

Direct set: `eslint`, `@eslint/js`, `typescript-eslint`,
`eslint-plugin-react-hooks`, and `eslint-plugin-react-refresh`.

- Intended use: deterministic JavaScript, TypeScript, React hook, and Vite React
  refresh linting through one root configuration.
- Alternatives considered: Biome could combine linting and formatting but would
  replace the established ESLint plugin rules; package-specific lint tools would
  duplicate configuration.
- Security and license notes: development-only packages that load configuration
  and inspect repository source; pin all direct plugins, add no third-party
  shared configuration, and confirm resolved licenses.
- Removal or replacement cost: medium; root lint configuration and scripts would
  change, but application runtime code would not.

### `prettier`

- Intended use: deterministic formatting and formatting checks across supported
  source and configuration files.
- Alternatives considered: ESLint formatting rules blur correctness and style;
  Biome would overlap the selected lint stack.
- Security and license notes: development-only formatter; pin it, add no external
  plugins in this ticket, and confirm its resolved permissive license.
- Removal or replacement cost: low; replace root formatting configuration and
  scripts without changing runtime behavior.

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
- Dependency, build, coverage, and tool-cache artifacts remain ignored and do
  not appear as untracked repository changes.
- No future feature is implemented.

## Automated verification

Run the commands defined by the chosen package manager for:

- dependency installation from the committed lockfile
- formatting
- lint
- type checking
- tests
- production build
- generated-artifact ignore verification

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

## Completion evidence

Completed: 2026-07-17

Accepted implementation:

- Materialized the approved pnpm workspace with separate server, worker, web,
  CLI, domain, shared-configuration, and fixture boundaries.
- Added the Fastify `GET /version` endpoint, `blackbox --version` command,
  React/Vite application shell, and compilable worker entry point.
- Added the documented root setup, development, formatting, linting, type-check,
  test, and production-build commands.
- Added server, CLI, and web smoke tests without persistence, Git, agent
  execution, or later-ticket product behavior.

Automated evidence:

- `pnpm install --frozen-lockfile`: pass.
- `pnpm format:check`: pass.
- `pnpm lint`: pass.
- `pnpm typecheck`: pass.
- `pnpm test`: pass.
- `pnpm build`: pass.
- Generated-artifact ignore verification: pass.
- Server, CLI, worker, and Vite runtime probes: pass.
- Dependency security audit: pass with zero reported vulnerabilities.
- Final verification audit: `GO`.
- Independent ticket review: `PASS` with no unresolved blocker.

Manual evidence:

- `.codex-runs/manual/T0001.md` records exactly one unambiguous
  `Manual verification: Pass` result.
- The human verifier confirmed dependency installation, the server version
  response, CLI version output, Vite startup, the rendered Blackbox shell, no
  browser-console errors, and the production build.

Current limitations:

- This ticket provides only application boundaries and version-level smoke
  behavior; persistence, Git operations, agent execution, product domain
  contracts, and product workflows remain unimplemented.
- pnpm reports a blocked transitive esbuild lifecycle script during install;
  the accepted installation, tests, runtime probes, and build pass without
  approving it.
