# Verification Guide

## Verification philosophy

Blackbox judges agent work by observable repository state and recorded evidence, not by plausible text output. Verification must be reproducible, scoped to the ticket, and strict about unavailable or skipped checks.

A check that did not run is not a passing check.

## Canonical pre-merge verification

Use Node.js `24.18.0`, enable Corepack, and install the root-pinned pnpm
`10.31.0` dependency graph from the committed lockfile. Start the pinned local
PostgreSQL 17 service, then run:

```sh
pnpm db:up
pnpm verify
```

The repository-owned verification runner invokes these commands directly and
in order: `format:check`, `lint`, `typecheck`, `test:unit`, `build`, and
`test:integration`. It stops after the first unsuccessful gate and preserves
that gate's output and exit status. GitHub Actions invokes the same aggregate
command after a frozen-lockfile install and after its PostgreSQL 17 service is
healthy. The integration gate requires `pnpm test:database`; unavailable
PostgreSQL is a failure and is never skipped.

`pnpm test` remains an alias for the unit-test command. When run outside the
aggregate flow, `pnpm test:integration` expects `pnpm build` to have produced
the current CLI, server, worker, and web artifacts first.

## Every ticket

1. Confirm the ticket was Ready before implementation began.
2. Confirm the writing agent's declared file and responsibility scope matches the resulting change.
3. Review the complete Git diff, including generated files and dependency-lock changes.
4. Run all ticket-specific automated checks.
5. Run the repository's aggregate verification command when the ticket can affect shared behavior.
6. Confirm no unrelated files changed.
7. Confirm migrations, schemas, events, APIs, and configuration remain versioned where required.
8. Follow every manual verification step recorded in the ticket.
9. Check the application console, browser console, worker output, and terminal for errors or warnings introduced by the change.
10. Confirm every acceptance criterion has concrete evidence.
11. Confirm relevant product, architecture, status, ticket, and verification documentation reflects the accepted result.
12. Record remaining risk, unsupported environments, or unverified behavior.

## Required evidence

Acceptance evidence should use the strongest available form:

1. Automated test asserting externally visible behavior.
2. Integration test against the real boundary.
3. Captured command output from a documented verification command.
4. Browser test or screenshot for user-interface behavior.
5. Manual verification record with exact steps and observed result.
6. Reasoned review only when stronger evidence is not practical.

Evidence must identify:

- The command or procedure used.
- The environment or fixture.
- The expected result.
- The observed result.
- Relevant artifact, test, event, or commit references.

## Before merging

- Working tree contains only intentional changes.
- Formatting passes.
- Lint passes.
- Type checking passes.
- Unit tests pass.
- Integration tests pass.
- Required browser tests pass.
- Database migration checks pass.
- Production build passes.
- Ticket-specific benchmark or scenario tests pass.
- No required check is skipped or unavailable.
- Independent review has no unresolved blocker findings.
- Manual verification passes.
- Security-sensitive changes have explicit adversarial verification.
- Documentation reflects the accepted result.
- `docs/STATUS.md` records the latest verified capability and known limitations.

## Architecture verification

For every ticket, reviewers must confirm:

- Domain code does not depend on UI, framework, database, queue, Git, Codex, or model-provider details unless the architecture explicitly permits it.
- Workers do not mutate authoritative state without going through application services or approved persistence interfaces.
- The API server does not execute agent shell commands directly.
- Ledger events remain append-only.
- Derived projections can be rebuilt or have a documented rebuild strategy.
- Every state transition is explicit and valid.
- New inferred causal data is distinguishable from deterministic evidence.
- No change silently broadens the product beyond the MVP non-goals.

Any deliberate invariant change requires an approved architecture decision record and updates to `docs/ARCHITECTURE.md`.

## Domain and schema verification

When a ticket changes a schema, event, configuration, or state machine:

1. Add or update the explicit version.
2. Parse external input from `unknown` and test current valid examples.
3. Test missing, malformed, and unsupported versions, including version-error
   precedence over ordinary shape errors.
4. Test every required property, explicit-null boundary, enum, strict-object
   boundary, uniqueness rule, and conditional invariant.
5. Confirm schema failures expose safe issue paths and do not retain the
   rejected payload.
6. For state machines, test every state pair against the immutable legal-edge
   table, including unknown current and target states.
7. Run the deterministic package-boundary check when domain or contract code
   changes.
8. Test backward reading or migration behavior when promised.
9. Confirm old records are not silently reinterpreted.
10. Confirm generated clients or shared types are updated.
11. Record compatibility implications and later-ticket ownership boundaries.

## Database verification

For migration changes:

- Apply all migrations to an empty database.
- Apply the new migration to a database at the previous schema version.
- Verify migration order and transaction behavior.
- Verify application startup against the resulting schema.
- Test constraints and indexes through behavior, not only schema snapshots.
- Confirm destructive changes have an approved migration or reset policy.
- Confirm rollback expectations are documented; do not assume every migration is reversible.

The persistence foundation uses these focused commands:

```sh
pnpm db:migrate
pnpm db:status
pnpm db:smoke
pnpm test:database
```

Database integration tests create and remove unique databases on the local
PostgreSQL service. They cover empty-to-latest and previous-to-latest migration,
repeated no-op execution, changed checksums, missing files, future versions,
foreign keys, uniqueness, same-run dependencies, self-dependencies, schema
versions, sanitized failures, and one create/read round trip per initial
aggregate. The smoke command must remain local-only and print no connection
string, credential, or record payload.

Development reset verification must prove both refusal and success paths:

```sh
pnpm db:reset:dev
BLACKBOX_DATABASE_URL=postgres://user:password@db.example/blackbox \
  pnpm db:reset:dev -- --confirm-reset
pnpm db:reset:dev -- --confirm-reset
```

The first two commands must fail safely. The confirmed local reset must migrate
cleanly afterward. Removing the named Compose volume is a separate deliberate
manual action, never an automatic migration or verification step.

## Lifecycle coordination verification

Run the T0006-focused checks with PostgreSQL healthy:

```sh
pnpm --filter @blackbox/application test
pnpm --filter @blackbox/application typecheck
pnpm --filter @blackbox/application build
pnpm --filter @blackbox/persistence test
pnpm test:database
pnpm --filter @blackbox/server test
```

Fake-port tests cover graph validation, every supported run/ticket/assignment
edge, dependency refusal, reservation eligibility, deterministic inspection,
locale-independent non-ASCII ordering, single-clock timestamp effects, terminal
cascades, exact event fields/order/cardinality, and late-failure state/outbox
rollback for block, cancel, and fail commands. Static tests keep Fastify and
PostgreSQL types out of the application boundary and reject worktree, Git,
intent, ledger, queue, validation, and deferred completion/activation
implementations.

Isolated PostgreSQL tests cover empty and incremental `0003` migration, graph
and outbox atomicity, same-run and cycle constraints, committed dependency
eligibility, immutable outbox rows, the assigned/active partial unique index,
two-service concurrent reservation races, consistent inspection during both
failure and cancellation cascades, and update/delete/truncate refusal. Injected
late outbox failures must roll back all earlier aggregate mutations and event
inserts for block, cancel, and fail commands. Server injection tests cover every
route, unauthorized and incorrect tokens, malformed input, not-found, conflict,
persistence failure, public version behavior, and explicit refusal of ticket
start and assignment activation.

Before acceptance, inspect `0001` and `0002` against the ticket base to prove
their exact bytes did not change. Inspect generated artifacts and secrets, run
`pnpm verify`, and then perform the ticket's disposable authenticated API
workflow. A sandbox-denied loopback attempt is not passing evidence; rerun with
only scoped local PostgreSQL access.

The T0004 image evaluation used Trivy 0.72.0 against the exact pinned image with
a vulnerability database updated 2026-07-18T18:43:59Z. It reported zero Alpine
3.24.1 OS-package findings and 39 fixed-version metadata findings in the
Go-built `gosu` 1.19 binary: 1 unknown, 2 low, 21 medium, 14 high, and 1
critical. Govulncheck 1.6.0 then analyzed the extracted exact binary with the
official Go vulnerability database last modified 2026-07-08 and concluded that
the binary is affected by zero vulnerabilities. It also found 3
vulnerabilities in imported packages and 35 in required modules, but no
vulnerable calls. All 15 Trivy high/critical CVEs mapped to Go vulnerability
records without a vulnerable symbol present or reachable; one high finding was
package-level in `os`, still with no vulnerable symbol. This is nonzero scanner
evidence, not a zero-vulnerability image claim or a guarantee about future
advisory data. Repeat both scans whenever the image or advisory databases
change.

## Git and worktree verification

For repository or worktree changes:

- Test with a clean repository.
- Test with an intentionally dirty repository.
- Test paths containing spaces.
- Test concurrent worktree creation.
- Test independent manager instances against the same database assignment and
  prove one token owner performs Git mutations while losers converge; also
  prove different assignments reserve independently.
- Verify every worktree starts from the recorded base commit.
- Verify one assignment cannot mutate another assignment's worktree through supported APIs.
- Verify patch generation is stable and complete.
- Verify cleanup refuses active or retained worktrees.
- Verify the cleanup matrix directly covers assigned, active, retained, tracked
  dirty, untracked, ignored, escaped, absent/unregistered, path/branch
  mismatched, moved-registration, ownership-mismatched, clean terminal,
  failed-provisioning-compensation, and failed-removal-reconciliation states.
  Every refusal must preserve Git resources and emit no removal event; a refusal
  caught before reservation must also preserve the worktree database record.
- Inject unknown content after removal reservation and prove the immediate
  pre-remove check leaves the worktree and branch intact with an explicit
  removal-reconciliation disposition.
- Inject failures after reservation, branch creation, worktree creation,
  verification, binding, removal, branch deletion, and final persistence; each
  retry must either prove exact ownership or retain an explicit failure
  disposition without deleting a collision.
- Prove a fresh reservation never adopts an exact pre-existing branch or
  worktree; `branch_creating` proves neither resource, `worktree_creating`
  proves only the branch, and `verifying`/`activating` prove both. Failed Git
  adds and merely observed exact resources confer no ownership. Prove stale
  recovery preserves cleanup-required disposition across token rotation,
  terminal owners cannot retry, and moved refs survive cleanup recovery.
- Verify repository bindings reject missing UUIDs, duplicate canonical
  identities, substituted paths, common-directory drift, default-branch drift,
  and absent run bases.
- Verify provision, retention transitions, and removal append exactly one
  versioned outbox event each, while guarded start appends exactly one ticket and
  one assignment status event in the same transaction.
- Change lifecycle ownership or the recorded run base after reservation and
  prove final activation re-locks and rejects it without assignment binding or
  outbox emission.
- Race concurrent same-assignment provision calls with different repository IDs
  and prove the substituted request is never coalesced. Change the ownership
  base after activation and prove active idempotency refuses the drift.
- Substitute a different clean repository at the managed path after manager
  verification but before native removal; the primitive must re-read expected
  path, common Git directory, branch, and HEAD and preserve both resources.
- Verify malformed, uppercase, and case-duplicate UUIDs are refused before
  configuration lookup, manager maps, path/ref derivation, persistence, or
  event creation. Include repository and agent body UUIDs plus injected
  aggregate/event ID generators. Successful HTTP responses omit operation
  tokens and canonical path/ref metadata.
- Confirm the canonical protected branch is unchanged during prepare and validation.

The repository-registration and native-Git boundary has these focused commands:

```sh
pnpm --filter @blackbox/git test
pnpm --filter @blackbox/git typecheck
pnpm --filter @blackbox/git build
pnpm --filter @blackbox/worktrees test
pnpm --filter @blackbox/worktrees typecheck
pnpm --filter @blackbox/worktrees build
```

The focused suite creates real disposable SHA-1 and SHA-256 repositories. It
asserts canonical registration through nested, symlinked, and space-containing
paths; clean, dirty, staged, unstaged, deleted, renamed, untracked, ignored, and
detached states; executable, symlink, and binary patch behavior; exact-SHA and
ref refusal; deterministic patch bytes and SHA-256; `git apply --check` against
a separate checkout; atomic branch collision safety; and unchanged HEAD, refs,
index, worktree, and source object database. Adversarial cases cover bounded
output, missing Git, unsupported platforms and path bytes, forged errors, and
local, global, inherited, attribute, hook, filter, fsmonitor, external-diff,
textconv, credential, and pager configuration. A helper marker must remain
absent; any capability refusal is a failing assertion unless the expected typed
refusal is the behavior under test.

Operation-level regressions additionally modify clean/process filters and
attributes after registration and require every public operation to refuse
without executing the helper. A hostile `TMPDIR`, `TMP`, and `TEMP` rooted inside
the working tree must be ignored; repeated patches remain byte-identical, child
Git processes observe only a controlled external temp root, and the hostile
directory remains empty. Commit-typed registration and head fields reject blob
objects, and failure of absolute-path discovery is classified as unsupported Git
rather than as a non-repository.

Status regressions require `git add -N` entries to remain unstaged additions
rather than becoming staged empty files, and require an unstaged rename
destination absent from the real index to carry `untracked: true`.

## Command-runner verification

For command-execution changes:

- Verify working-directory confinement.
- Verify environment allowlisting and secret redaction.
- Verify standard output and standard error capture.
- Verify non-zero exit handling.
- Verify timeout behavior.
- Verify graceful and forced cancellation.
- Verify child-process termination.
- Verify arguments containing spaces and shell metacharacters.
- Verify the API server never executes the command directly.
- Verify retry behavior is absent or idempotent as designed.

## Conflict-engine verification

Every conflict detector requires:

- At least one positive fixture.
- At least one near-miss negative fixture.
- Stable detector and classification identifiers.
- Evidence references sufficient for a reviewer to reproduce the finding.
- Explicit severity and runtime decision.
- Tests for ordering and duplicate findings.
- Measurement of false positives on safe scenarios.

A model-assisted detector additionally requires:

- A deterministic fallback behavior.
- Stored prompt or analyzer version metadata where privacy policy permits.
- Confidence and uncertainty representation.
- Evaluation against a fixed labeled scenario set.
- No hard blocking solely from unsupported model output.

## Transaction verification

For transaction-lifecycle changes:

- Test every permitted transition.
- Test representative forbidden transitions.
- Verify transitions are atomic with their command-side state.
- Verify ledger events are emitted exactly once or handled idempotently.
- Verify commit eligibility requires all mandatory validations.
- Verify stale assumptions and resource versions are rechecked at prepare and commit boundaries.
- Verify cancellation produces an explicit state.
- Verify partial failures do not appear as success.

## Execution-ledger verification

For ledger changes:

- Verify duplicate event IDs are idempotent.
- Verify sequence gaps are visible.
- Verify historical events cannot be updated through application APIs.
- Verify schema versions are required.
- Verify hashes detect payload corruption where applicable.
- Verify correlation and causation identifiers are preserved.
- Verify projections rebuild from a known event fixture.
- Verify exports preserve ordering and version metadata.
- Verify redaction before persistence.

## Validation-runner verification

For validation behavior:

- Test pass, fail, timeout, cancelled, skipped, and unavailable outcomes.
- Confirm only pass satisfies a required validation.
- Confirm output artifacts are retained and linked.
- Confirm definition and environment versions are recorded.
- Confirm ticket-level and integration scopes execute in the correct worktrees.
- Confirm validation commands cannot silently mutate the canonical protected branch.

## Causal-analysis verification

Every causal-analysis ticket must use scenarios with separately defined ground truth.

Verify:

- The analysis starts from a named failed outcome.
- Unrelated events are excluded from deterministic backward slices.
- Deterministic and inferred edges are clearly distinguished.
- Earliest-decisive candidates link to evidence.
- Alternative explanations can be represented.
- Confidence is not fabricated when evidence is incomplete.
- Joint causes are supported without forcing a single guilty agent.
- Analyzer version changes produce benchmark comparisons.

Ground truth must be reviewed independently from analyzer implementation.

## Replay verification

For every supported replay scenario:

1. Create the original failure from a clean fixture.
2. Export the replay bundle.
3. Destroy the original temporary environment.
4. Validate bundle hashes and versions.
5. Restore into a new isolated environment.
6. Run with network access disabled unless the scenario explicitly requires a controlled local service.
7. Compare repository state, command outcomes, validations, and final failure.
8. Classify fidelity as exact, semantically equivalent, divergent, or unsupported.
9. Record every divergence.

Security tests must cover:

- Path traversal.
- Symlink escape.
- Corrupted artifacts.
- Unsupported versions.
- Unexpected executable paths.
- Secret inclusion.

## Guardrail verification

A candidate guardrail must be tested against:

- The failure from which it was derived.
- At least one structurally similar failure.
- Safe scenarios that should remain allowed.
- A near-miss scenario.
- Repeated evaluation for deterministic consistency.

Report:

- Failures prevented.
- Failures not prevented.
- Safe scenarios blocked.
- Added runtime latency.
- Decisions requiring approval.
- Unsupported conditions.

No candidate becomes active in the MVP without explicit human approval.

## Browser verification

For user-interface tickets:

- Verify loading, empty, success, partial, and error states.
- Verify keyboard navigation for primary workflows.
- Verify links from diagnostic claims to evidence.
- Verify long command output and large diffs do not break the layout.
- Verify browser console has no new errors.
- Verify state updates after worker events without requiring a hard refresh where real-time behavior is promised.
- Verify sensitive or redacted fields are not exposed in page source or network responses.

## Security and privacy verification

Security-sensitive changes require adversarial tests for relevant boundaries:

- Repository path traversal.
- Symlink escape.
- Command injection.
- Environment leakage.
- Secret-pattern redaction.
- Unauthorized artifact access.
- Cross-origin state changes.
- Replay bundle tampering.
- Malicious repository configuration.
- Oversized logs or artifacts.
- Denial through runaway child processes.

Reviewers must confirm that threat-model assumptions and residual risks remain accurate.

## Performance verification

Performance testing is required when a change affects event ingestion, timeline queries, projection rebuild, causal traversal, artifact handling, or scenario execution.

Record representative results for:

- Events ingested per second.
- Timeline query latency at target event counts.
- Projection rebuild time.
- Causal backward-slice time.
- Worktree creation and patch-generation time.
- Artifact storage and retrieval behavior.

Performance targets should be ticket-specific until stable product-level service objectives exist.

## MVP milestone verification

### M0 — Foundation

- Clean setup succeeds from documentation.
- All canonical development commands exist and run in CI.
- Core domain schemas and state machines are tested.
- Database setup and migrations are repeatable.

### M1 — Transactional execution

- A run with at least two scripted writing agents executes in isolated worktrees.
- Intents are required and versioned.
- Commands and effects appear in the ledger.
- Ticket and integration validations produce evidence.

### M2 — Conflict prevention

- All implemented deterministic conflict classes pass positive and negative fixtures.
- Integration staging never mutates the protected branch.
- The web dashboard exposes the evidence behind each decision.

### M3 — Causal debugging

- A seeded failure produces a causal graph and backward slice.
- The expected earliest decisive event appears in the report.
- A supported replay reproduces the failure or reports a specific fidelity limitation.

### M4 — Guardrail loop and demo

- Benchmark targets in `PRODUCT.md` are measured.
- A candidate rule prevents a known failure and reports overblocking.
- Four or more Codex agents complete the documented demonstration.
- Security hardening and installation verification pass.

## Regression rule

When a defect is found:

1. Reproduce it with the smallest practical fixture.
2. Identify whether instrumentation captured the failure adequately.
3. Add an automated regression test when practical.
4. Fix the underlying issue rather than only suppressing the symptom.
5. Run the focused test and the relevant broader test suite.
6. Re-run affected benchmark scenarios when conflict, replay, causality, or guardrail behavior changed.
7. Update documentation and known limitations.
8. Record any remaining risk.

If the defect escaped because evidence was missing, improving observability is part of the fix.

## Manual release checklist

- Install from a clean checkout using only documented prerequisites.
- Start all required local services.
- Initialize Blackbox in the fixture repository.
- Run the successful scripted multi-agent scenario.
- Run the blocked-conflict scenario.
- Run the seeded integration-failure scenario.
- Inspect the timeline and supporting evidence.
- Export and execute a replay bundle.
- Evaluate and manually approve a candidate guardrail.
- Rerun the scenario and verify the documented outcome.
- Run a real Codex CLI fixture ticket.
- Confirm protected branches and unrelated files remain unchanged.
- Confirm redaction with representative test secrets.
- Run the aggregate automated verification command.
- Update `docs/STATUS.md` with the validated commit and observed limitations.
