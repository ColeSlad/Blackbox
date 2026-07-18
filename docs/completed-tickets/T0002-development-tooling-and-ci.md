# T0002 — Development Tooling and CI

Status: Done
Milestone: M0 — Foundation

## Outcome

One canonical local command runs every merge gate, and GitHub Actions runs the
same command reproducibly.

## Reason

T0001 provides individual checks but no aggregate verification command,
integration-test command, or active product CI workflow.

## Dependencies

- T0001 — Done

## Preconditions

- Node.js 24 and pnpm 10.31.0 remain supported.
- GitHub Actions is the CI target because the repository origin is GitHub.
- T0001 smoke behavior remains unchanged.

## Allowed Scope

- `package.json`
- `pnpm-lock.yaml` only if an approved test dependency is unavoidable
- `.github/workflows/verify.yml`
- Tool-version files such as `.node-version`
- Verification helpers under `scripts/verification/`
- Integration fixtures under `fixtures/`
- Existing package test scripts and configuration
- `README.md`
- `docs/STATUS.md`
- `docs/TICKETS.md`
- `docs/VERIFICATION.md`
- `docs/tickets/T0002-development-tooling-and-ci.md`

## Protected Areas

- Application product behavior
- Domain contracts and persistence
- `.codex/`, `.agents/`, and `scripts/codex/`
- `.github/workflows/codex-review.yml.example`
- `docs/PRODUCT.md`, accepted ADRs, and architectural meaning
- Git, Codex, queue, worker-job, and agent-execution behavior

## Requirements

- Add root `test:unit`, `test:integration`, and `verify` commands.
- Keep `pnpm test` as a documented compatibility command.
- Add `.node-version` containing `24.18.0`, configure CI to read that file, and
  keep pnpm pinned to `10.31.0` through the root `packageManager` field. Local
  and CI verification must therefore use the same exact Node.js and pnpm
  versions.
- Implement `pnpm verify` through a repository-owned Node.js helper under
  `scripts/verification/`. The helper must run exactly these gates in order:
  `format:check`, `lint`, `typecheck`, `test:unit`, `build`, and
  `test:integration`.
- The verification helper must invoke each gate as a direct `pnpm` child process
  without a shell, inherit standard output and standard error, stop immediately
  after the first unsuccessful gate, and return that gate's exit status.
- Keep the command-execution boundary injectable only for deterministic tests.
  Add a contract test that covers the all-success case and a distinct non-zero
  failure at each of the six gate positions. For every failure case, assert the
  exact attempted order, the preserved exit status, and that no later gate ran.
- `pnpm verify` must run, in order:
  1. formatting check;
  2. lint;
  3. type checking;
  4. unit tests;
  5. production build;
  6. integration tests.
- Stop at the first failure while preserving the failing command's output and
  exit status.
- Add deterministic integration smoke coverage that executes built boundaries:
  - the CLI returns the expected version;
  - the built server starts on an ephemeral port and serves `GET /version`;
  - the built worker exits successfully;
  - the web build contains the expected entry assets.
- Integration tests must use temporary paths and ephemeral ports, clean up child
  processes, require no network access, and add no product behavior.
- Add `.github/workflows/verify.yml` for pull requests, pushes to `main`, and
  manual dispatch.
- CI must use Node.js 24, Corepack, pnpm 10.31.0,
  `pnpm install --frozen-lockfile`, and exactly one `pnpm verify` invocation.
- CI must use read-only repository permissions and checkout with persisted
  credentials disabled.
- Pin third-party actions to immutable commit revisions with release-version
  comments.
- Do not use `continue-on-error`, output suppression, secrets, Codex, commits,
  pushes, or generated patches.
- Add no runtime dependency. Any proposed test dependency must receive the
  standard dependency evaluation before installation.

## CI Action Dependency Evaluation

No external GitHub Action other than the following two may be introduced by this
ticket. Each workflow reference must use the reviewed release's full immutable
commit SHA with the release version recorded in an adjacent comment.

### `actions/checkout`

- Intended use: materialize the triggering repository revision in the isolated
  GitHub-hosted runner so the committed lockfile and verification sources are
  available.
- Alternatives considered: manually invoking Git clone would duplicate
  authentication and event-ref handling while increasing credential exposure;
  running without a checkout cannot verify repository contents.
- Security and license notes: this GitHub-maintained MIT-licensed action executes
  before repository checks and receives the workflow token. Use repository
  `contents: read` permissions, set `persist-credentials: false`, fetch only the
  triggering revision, pin the full reviewed commit SHA, and interpolate no
  untrusted event data into action inputs or shell commands.
- Removal or replacement cost: low; replacement is isolated to the workflow
  checkout step and does not affect application or test code.

### `actions/setup-node`

- Intended use: install the exact Node.js version recorded in `.node-version`
  before Corepack activates the root-pinned pnpm version.
- Alternatives considered: relying on the runner's preinstalled Node.js version
  is not reproducible; manually downloading Node.js would duplicate platform,
  integrity, and PATH handling.
- Security and license notes: this GitHub-maintained MIT-licensed action executes
  bundled dependencies and may download the requested Node.js distribution. Pin
  the full reviewed commit SHA, read only `.node-version`, enable no dependency
  cache or registry authentication, provide no token or secret input, and review
  the selected release and transitive security notes before acceptance.
- Removal or replacement cost: low; replacement affects only CI toolchain setup
  while `.node-version` remains the local version source.

## Acceptance Criteria

- `pnpm verify` runs every documented merge gate in the required order.
- Unit and integration checks remain separately invocable.
- Integration tests exercise all four built application boundaries.
- Local and CI verification use identical underlying commands.
- Formatting, type, test, build, and integration failures return visible
  non-zero results.
- CI installs exclusively from the committed lockfile.
- CI has read-only permissions and cannot persist Git credentials.
- Tool versions are reproducible.
- A deterministic verification-runner contract test proves the successful gate
  order and, for every gate, exact non-zero propagation and omission of all
  subsequent gates.
- CI reads the exact Node.js version from `.node-version`; the workflow does not
  use a floating Node.js major or LTS alias.
- The workflow uses only the two evaluated GitHub Actions dependencies.
- No product behavior or Codex harness behavior changes.

## Automated Checks

- `corepack pnpm install --frozen-lockfile`
- `pnpm format:check`
- `pnpm lint`
- `pnpm typecheck`
- `pnpm test:unit`
- `pnpm build`
- `pnpm test:integration`
- `pnpm verify`
- Through `pnpm test:unit`, run the verification-runner contract test with:
  - one all-success case asserting all six gates run once in order;
  - one sentinel non-zero case for each gate;
  - assertions that each sentinel status is preserved;
  - assertions that no gate after the failing gate runs.
- Deterministically inspect root `package.json` to confirm `pnpm verify`
  delegates only to the tested repository-owned verification helper.
- Deterministically confirm `.node-version`, the CI `node-version-file`, and the
  Node.js version used by the verification environment agree exactly.
- Confirm the workflow references only `actions/checkout` and
  `actions/setup-node`, each by a full commit SHA with a release comment.
- Deterministically inspect the workflow for:
  - read-only permissions;
  - immutable action references;
  - `persist-credentials: false`;
  - exactly one `pnpm verify`;
  - no `continue-on-error`.
- `git diff --check`
- Confirm no generated build, coverage, or test artifacts remain untracked.

## Manual Verification

1. Run `pnpm verify` successfully from a clean checkout.
2. Introduce and revert one temporary formatting failure.
3. Introduce and revert one temporary type error.
4. Introduce and revert one temporary failing unit test.
5. Confirm each failure is visible and returns non-zero.
6. Confirm the restored repository passes `pnpm verify`.
7. Inspect one GitHub Actions run and confirm it uses `pnpm verify` and
   preserves failure output.

## Exclusions

- Product APIs or workflows
- Persistence and databases
- Domain contracts
- Browser automation
- Deployment or release publishing
- Codex review automation
- Recurring scheduling
- CI caching without measured need

## Documentation Updates

- Document `pnpm verify`, `test:unit`, and `test:integration` in `README.md`.
- Define `pnpm verify` as the canonical pre-merge command in
  `docs/VERIFICATION.md`.
- Record active CI and aggregate verification in `docs/STATUS.md`.
- Update ticket status only through the normal workflow.

## Rollback

Revert the ticket commit. No persistent state or migration is involved.

## Reviewer Focus

- Local and CI command parity
- Failure propagation and cleanup
- Immutable action references and least permissions
- Real built-boundary integration coverage
- No product or harness scope expansion

## Completion Evidence

Completed: 2026-07-18

Accepted implementation:

- Implementation commit: `59269d3`.
- Pull request #1 merged as
  `a2d932815c8a7fe337f732629e36b33a96568685`.
- Added the repository-owned fail-fast verification runner, separate unit and
  built-boundary integration commands, exact Node.js version pin, and
  least-privilege GitHub Actions verification workflow.
- Preserved product behavior and the protected application, domain,
  persistence, and Codex harness boundaries.

Automated evidence:

- Verification environment: Node.js `v24.18.0` and pnpm `10.31.0`.
- `corepack pnpm install --frozen-lockfile`: pass.
- `pnpm format:check`: pass.
- `pnpm lint`: pass.
- `pnpm typecheck`: pass.
- `pnpm test:unit`: pass with 13 unit tests.
- `pnpm build`: pass.
- `pnpm test:integration`: pass with one built-boundary integration test.
- Compatibility `pnpm test`: pass.
- `pnpm verify`: pass.
- Static scope, workflow-policy, version-parity, diff, and Codex harness checks:
  pass.
- Independent ticket review: `PASS` with no unresolved blocker.
- GitHub Actions Verify run `29655014542`, job `88107670217`: pass using the
  canonical `pnpm verify` command.

Manual evidence:

- `.codex-runs/manual/T0002.md` records exactly one unambiguous
  `Manual verification: Pass` result.
- The human verifier confirmed visible non-zero formatting, type-checking, and
  unit-test failures, restored every temporary probe, and confirmed the final
  `pnpm verify` passed.

Current limitations:

- This ticket adds development verification only; it does not add product APIs,
  domain contracts, persistence, browser automation, deployment, or Codex
  automation.
