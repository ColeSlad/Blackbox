# T0007 — Isolated Worktree Manager

Status: Done
Milestone: M1 — Transactional execution

## Outcome

Each eligible writing assignment can receive one persisted, deterministic Git
worktree created from its run's recorded base commit, inspect its changed paths
and complete patch, retain it deliberately, and clean it up only when ownership
and safety conditions permit.

## Reason

T0005 supplies safe Git primitives and T0006 supplies persisted run, ticket, and
assignment ownership. This ticket combines them into the first isolated writing
boundary without launching agents, executing arbitrary commands, or implementing
integration staging.

## Dependencies

- T0005 — must be Done
- T0006 — must be Done

T0008 and later tickets are intentionally not dependencies.

## Preconditions

- The run, ticket, and assignment exist in one lifecycle graph.
- The assignment is `assigned`, its ticket is `ready`, its run is `running`, and
  `worktree_id` is null.
- Server-owned configuration binds the run's `repository_id` to one exact
  T0005-validated canonical root and common Git directory; callers cannot supply
  or substitute a repository path.
- The source working tree is clean and the run's exact base commit exists.
- An explicit Blackbox-owned worktree root is configured outside the canonical
  repository.
- PostgreSQL migrations through T0006 are current.

## Allowed scope

- New `packages/worktrees/`
- `packages/config/` for the local repository-ID binding and managed-root schema
- `packages/application/` only for the narrow worktree-backed atomic start guard
- `packages/git/` additions limited to native Git worktree backend primitives
- `packages/persistence/` worktree adapters and assignment-binding operations
- New ordered migration
  `packages/persistence/migrations/0004_assignment_worktrees.sql`
- `apps/server/` authenticated assignment-worktree provision, inspect, patch,
  retention, and cleanup routes
- Deterministic Git/worktree fixtures under `fixtures/git/`
- Workspace manifests, root verification scripts, and `pnpm-lock.yaml` metadata
- `README.md`
- `docs/ARCHITECTURE.md`
- `docs/STATUS.md`
- `docs/VERIFICATION.md`
- `docs/TICKETS.md`
- `docs/tickets/T0007-isolated-worktree-manager.md`

## Protected areas

- T0003 contract and lifecycle meaning
- T0005 non-worktree Git semantics beyond the narrow backend extension
- T0006 dependency and assignment rules except the narrow atomic start guard
  authorized here
- Intent acceptance and revisions owned by T0008
- Ledger ingestion, sequencing, hashes, and projections owned by T0009
- Queue jobs, leases, retries, and cancellation delivery owned by T0010
- Arbitrary command execution and instrumentation owned by T0011
- Codex execution, validation, transactions, conflicts, and integration staging
- Canonical protected branches and another assignment's worktree

## Requirements

### Manager and persistence boundary

- Add a framework-independent `WorktreeManager` using T0005 Git ports and
  database-neutral persistence ports.
- Persist version-one worktree records with ID, repository/run/ticket/assignment
  ownership, canonical repository identity, exact base SHA, deterministic path,
  dedicated branch, status, retention status, timestamps, operation token, and
  failure disposition.
- Use worktree statuses `provisioning`, `active`, `removing`, `removed`, and
  `failed`; retention statuses `releasable` and `retained`; and failure
  dispositions `none`, `provision_cleanup_required`, and
  `removal_reconcile_required`.
- Permit only `provisioning → active|failed`, `active → removing`,
  `removing → removed|failed`, and an explicitly reconciled
  `failed → provisioning|removing|removed` retry consistent with its failure
  disposition.
- Permit retention changes only while `active`; `removed` is terminal.
- Migration `0004` must enforce one worktree per assignment, unique managed path
  and branch ownership, required ownership foreign keys, and a valid assignment
  `worktree_id` reference.
- Preserve the historical assignment-to-worktree ID after removal.

### Repository binding

- Add a server-owned local configuration mapping each repository UUID to an
  expected canonical working-tree root and common Git directory.
- Resolve both configured paths through T0005 at startup and before provisioning
  and require exact identity equality.
- Reject missing bindings, duplicate identities, path substitution, identity
  drift, and a run base commit absent from the bound repository.
- Keep configuration static in this ticket; add no registration API or durable
  repository aggregate.

### Path and branch isolation

- Derive managed paths only from validated UUID ownership values beneath the
  configured root, for example
  `<root>/<repository_id>/<run_id>/<ticket_id>/<assignment_id>`.
- Resolve and verify the root, reject symlink escapes, and never use titles,
  external keys, agent content, or untrusted path fragments.
- Use deterministic dedicated branch names containing the full run, ticket, and
  assignment UUIDs.
- Create the branch and attached worktree at the run's exact base without
  checking it out in the canonical repository.

### Provisioning and recovery

- Provision through a recoverable sequence: atomically reserve a `provisioning`
  record with a unique operation token; create the dedicated branch and Git
  worktree; verify identity, exact HEAD, and clean status; then atomically mark
  it `active`, bind `assignment.worktree_id`, and write one `worktree.created`
  outbox event.
- If provisioning fails, attempt bounded cleanup only for resources created by
  that operation.
- A retry encountering `provisioning` may finalize an exact owned branch/path or
  non-forcibly compensate it; unexpected or unowned occupied resources are
  collisions and must never be deleted.
- Persist `failed/provision_cleanup_required` when compensation is incomplete;
  never report success or silently abandon an untracked path.
- Make repeated provisioning idempotent only when persisted ownership, Git
  registration, path, branch, base SHA, and clean state all match.
- Return typed collision or inconsistent-state errors otherwise.
- Add a narrow T0006 application-service guard that atomically starts a ticket
  and activates its assignment only after rechecking matching
  repository/run/ticket/assignment ownership, bound active worktree status,
  exact base, current worktree HEAD, and clean Git state. T0008 later adds
  accepted intent.

### Assignment-bound operations

- Expose operations through an assignment-bound capability or authenticated
  route rather than accepting arbitrary managed paths.
- Recheck run, ticket, assignment, and worktree ownership for inspect, patch,
  retention, release, and cleanup.
- Prevent one assignment from accessing another through manager APIs.
- Generate deterministic changed paths and a binary-capable full-index patch
  against the recorded base using T0005 without mutating either index.

### Retention and cleanup

- Support explicit retention and explicit retention release.
- Persist retention changes and versioned outbox events; add no timer or
  automatic policy.
- Refuse cleanup for assigned or active assignments, retained worktrees, dirty
  worktrees, paths outside the managed root, ownership mismatches, unexpected
  Git registration, or unknown filesystem content.
- Cleanup first atomically reserves `removing` after ownership, terminal
  assignment, retention, and immediately preceding Git-cleanliness checks.
- Successful cleanup may non-forcibly remove only that exact registered
  worktree, then delete only its dedicated unused branch, then atomically persist
  `removed` and one `worktree.removed` outbox event.
- A retry encountering `removing` reconciles the exact registered or absent
  worktree and dedicated branch before resuming. Database failure after Git
  removal leaves `removing` or `failed/removal_reconcile_required`, never an
  inaccurate `active` or `removed` state.
- Retention transitions write exactly one `worktree.retention_changed` outbox
  event in the same database transaction.
- Never expose reset, clean, force removal, commit, merge, push, or patch
  application.

### Git backend extension

- Extend T0005 only with argument-array, no-shell `git worktree add`, structured
  list, non-forced remove, and dedicated-branch deletion primitives.
- Bound and sanitize subprocess output under the same T0005 error policy.
- Preserve the canonical branch, HEAD, index, and worktree contents.

## Acceptance criteria

- Two assignments in one run receive distinct deterministic paths and branches
  at the exact recorded base.
- Repository UUID resolution comes only from server-owned validated bindings;
  arbitrary caller-path substitution and binding drift are refused.
- Concurrent provisioning for different assignments succeeds; concurrent
  provisioning for one assignment produces one worktree and one consistent
  record.
- Dirty source, missing base, occupied path, existing branch, symlink escape,
  and inconsistent retry fail without binding an assignment.
- Every new worktree is clean and at the exact run base before assignment
  activation becomes eligible.
- Assignment-bound APIs cannot inspect, patch, retain, release, or remove
  another assignment's worktree.
- Changed paths and patch bytes are deterministic and complete without mutating
  canonical or worktree indexes.
- Cleanup refuses active, retained, dirty, escaped, mismatched, and unmanaged
  worktrees.
- Clean unretained terminal cleanup removes only the managed directory and
  dedicated branch while preserving canonical state.
- Provisioning, retention changes, and removal write versioned outbox records,
  not T0009 ledger envelopes.
- Ticket start and assignment activation atomically recheck the full worktree
  guard rather than trusting only non-null `worktree_id`.
- Injected failures after reservation, branch creation, worktree creation,
  verification, binding, removal, branch deletion, and final database update
  leave an explicit retryable or terminal state with no deletion of unowned
  resources.
- No intent, ledger, queue, arbitrary command, Codex, validation, transaction,
  conflict, or integration behavior is added.
- Aggregate verification passes.

## Automated verification

- `pnpm --filter @blackbox/worktrees test`
- `pnpm --filter @blackbox/worktrees typecheck`
- `pnpm --filter @blackbox/worktrees build`
- Focused T0005 Git-adapter regression tests after backend extension
- Database tests for migration, ownership foreign keys, unique assignment/path/
  branch constraints, binding, retention, and removal state
- Temporary-repository integration tests for space-containing paths, exact-base
  creation, detached source HEAD, dirty-source refusal, patch completeness, and
  canonical-state preservation
- Controlled-concurrency tests for different assignments and same-assignment
  idempotency
- Adversarial path traversal, symlink escape, ref injection, occupied path,
  ownership substitution, stale state, and partial-failure tests
- Repository-binding tests for missing, duplicate, substituted, and drifted
  canonical identities
- Injected-failure and retry/reconciliation tests at every database/Git boundary
  in provisioning and removal
- Cleanup matrix for active, retained, dirty, unmanaged, mismatched, clean
  terminal, and failed-compensation states
- Static checks proving no shell, force removal, reset, clean, commit, merge,
  push, command runner, agent process, or ledger ingestion path exists
- `pnpm test:database`
- `pnpm verify`
- `git diff --check`
- Migration immutability, generated-artifact, and protected-branch checks

## Manual verification

1. Create a disposable clean repository, configure its server-owned repository
   UUID binding, and create a run with two ready assigned tickets.
2. Configure a disposable worktree root and provision both assignments.
3. Confirm distinct deterministic paths, branches, exact base HEADs, clean
   initial state, persisted ownership, and unchanged canonical state.
4. Modify each worktree differently and confirm each assignment sees only its
   own changed paths and patch.
5. Retain one worktree and confirm cleanup refuses it; release retention while
   dirty and confirm cleanup still refuses.
6. Restore the disposable worktree to clean state, terminalize its assignment,
   and confirm cleanup removes only its directory and dedicated branch.
7. Confirm cleanup still refuses the active second assignment.
8. Exercise dirty-source, wrong-owner, occupied-path, and symlink-escape cases
   and inspect sanitized errors.
9. Remove only disposable repositories and managed test roots.

## Exclusions

- Agent or arbitrary command execution inside worktrees
- Dynamic repository registration or caller-supplied repository paths
- Intent registration or accepted-intent enforcement
- Execution-ledger events, command evidence, projections, or timelines
- Worker queues, leases, retries, Codex processes, and cancellation delivery
- Validation execution, transaction preparation, commit eligibility, conflict
  detection, or integration worktrees
- Applying patches, committing, merging, pushing, resetting, cleaning, or
  force-removing dirty worktrees
- Automatic retention expiry, replay retention policy, background cleanup, or
  scheduler behavior
- Filesystem-read instrumentation or cross-assignment comparison APIs

## Documentation required

- Document configured worktree root, lifecycle, retention, cleanup refusals, and
  local authenticated API examples in `README.md`.
- Record worktree ownership, deterministic naming, recovery, and cleanup
  invariants in `docs/ARCHITECTURE.md`.
- Add concurrent creation, patch, isolation, symlink, retention, and cleanup
  procedures to `docs/VERIFICATION.md`.
- Record available worktree behavior and T0008–T0016 limitations in
  `docs/STATUS.md`.
- Record Ready status only after separate read-only validation and explicit
  human promotion; both gates were completed before implementation began.

## Rollback

Revert code and API changes. Migration `0004` remains forward-only. Before a
development revert, explicitly inspect and remove only disposable managed
worktrees through the accepted cleanup path; never recursively delete an unknown
root or rewrite applied migrations.

## Reviewer focus

- Exact-base and clean-initial-state enforcement
- Deterministic collision-safe paths and branches
- Symlink/path confinement and assignment-bound authorization
- Repository-binding authority and identity-drift refusal
- Filesystem/database recovery and honest failed disposition
- Concurrent idempotency and uniqueness
- Patch completeness without index mutation
- Strict active, retained, and dirty cleanup refusal without force deletion
- Canonical protected-branch preservation and later-ticket boundaries

## Dependency evaluation

- Add no npm dependency.
- Reuse T0005 native Git, Node standard library, T0006 application/outbox
  conventions, and the existing Postgres.js adapter.
- Reject Git wrapper libraries, filesystem watchers, task queues, container
  managers, and generic command runners.
- Use native `git worktree` capability probes, argument arrays, bounded output,
  and non-forced operations.
- Replacement cost is medium but isolated behind `GitRepository` and
  `WorktreeManager` interfaces.

## Smallest choices

- One `packages/worktrees` package and one forward migration
- One explicit repository-binding map and managed root with no daemon or
  scheduler
- Full ownership UUIDs in paths and refs
- One worktree and branch per assignment
- Explicit retention state without a policy engine
- Clean-only non-forced cleanup
- Existing authenticated server composition without a new CLI or web workflow

## Stop conditions

- Stop if isolation requires arbitrary shell execution, force removal, reset, or
  clean.
- Stop if a worktree cannot be proven inside the managed root and owned by the
  requested assignment.
- Stop if filesystem and database failure cannot leave an explicit recoverable
  or terminal record.
- Stop if a repository UUID cannot be resolved through server-owned configuration
  to the exact T0005 identity or if retry cannot distinguish owned resources
  from an unowned collision.
- Stop if implementation requires intent, ledger, queue, Codex, validation,
  transaction, conflict, integration, replay, or scheduler behavior.
- Stop if cleanup would discard changes without separately durable approved
  evidence.
- Stop if T0005 or T0006 is not Done or required interfaces conflict with this
  specification.
- Stop before implementation unless a separate `plan_validator` returns `GO`
  and a human explicitly promotes the ticket to Ready.

## Readiness

This Ready ticket resolves worktree ownership, deterministic paths and refs,
provisioning recovery, assignment binding, retention, patch inspection, and
cleanup safety. Separate read-only validation and explicit human promotion were
completed before implementation began.

## Completion Evidence

Completed: 2026-07-21

Accepted implementation:

- Added static server-owned repository UUID bindings and a framework-independent
  worktree manager with persisted ownership, deterministic exact-base paths and
  branches, recoverable provisioning and removal, and explicit retention.
- Added assignment-bound inspect, binary patch, retention, release, and safe
  non-forced cleanup operations with path, registration, cleanliness, ownership,
  and terminal-state refusal checks.
- Added the atomic worktree-backed ticket-start and assignment-activation guard,
  PostgreSQL migration `0004`, versioned worktree outbox records, authenticated
  path-free server routes, and bounded native-Git worktree primitives.
- Kept intent, ledger, queue, arbitrary command, Codex, validation, transaction,
  conflict, integration, replay, and scheduling behavior outside T0007.

Automated evidence:

- Aggregate Node.js 24.18.0 verification: pass with formatting, lint, all
  workspace type checks, 509 unit tests, all production builds, 18 persistence
  database tests, 12 application database tests, and integration smoke coverage.
- Focused Git, worktree, application, server, persistence, concurrency,
  cleanup-matrix, recovery, UUID, binding, ownership, static-policy, migration,
  protected-main, generated-artifact, prohibited-operation, and secret checks:
  pass.
- Final verification audit: `PASS`, with no remaining automated acceptance or
  verification gap.
- Fresh independent ticket review: `APPROVE`, with no findings.
- The retained initial aggregate run exceeded Vitest's five-second timeout in
  one native-Git integration case without failing an assertion. The case passed
  three consecutive runs after receiving the bounded 20-second timeout used by
  neighboring Git-heavy tests, and subsequent aggregate and recovery validation
  passed.

Manual evidence:

- `.codex-runs/manual/T0007.md` records the explicit human `Pass` result after
  the authoritative nine-step manual-verification checklist.

Current limitations:

- Repository bindings are static server-owned local configuration; no
  registration API or durable repository aggregate exists.
- Cleanup is explicit, clean-only, terminal, unretained, and non-forced; there is
  no timer or automatic retention policy.
- Worktree-backed ticket start and assignment activation are available, but
  ticket and run completion still await T0013 verification evidence.
