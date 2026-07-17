# Verification Guide

## Verification philosophy

Blackbox judges agent work by observable repository state and recorded evidence, not by plausible text output. Verification must be reproducible, scoped to the ticket, and strict about unavailable or skipped checks.

A check that did not run is not a passing check.

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
2. Test current valid examples.
3. Test invalid input and unknown versions.
4. Test backward reading or migration behavior when promised.
5. Confirm old records are not silently reinterpreted.
6. Confirm generated clients or shared types are updated.
7. Record compatibility implications.

## Database verification

For migration changes:

- Apply all migrations to an empty database.
- Apply the new migration to a database at the previous schema version.
- Verify migration order and transaction behavior.
- Verify application startup against the resulting schema.
- Test constraints and indexes through behavior, not only schema snapshots.
- Confirm destructive changes have an approved migration or reset policy.
- Confirm rollback expectations are documented; do not assume every migration is reversible.

## Git and worktree verification

For repository or worktree changes:

- Test with a clean repository.
- Test with an intentionally dirty repository.
- Test paths containing spaces.
- Test concurrent worktree creation.
- Verify every worktree starts from the recorded base commit.
- Verify one assignment cannot mutate another assignment's worktree through supported APIs.
- Verify patch generation is stable and complete.
- Verify cleanup refuses active or retained worktrees.
- Confirm the canonical protected branch is unchanged during prepare and validation.

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