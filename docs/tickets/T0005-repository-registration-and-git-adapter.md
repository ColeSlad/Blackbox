# T0005 — Repository Registration and Git Adapter

Status: Draft
Milestone: M1 — Transactional execution

## Outcome

Blackbox can validate and inspect a non-bare local Git working tree through a
public, testable `GitRepository` interface and safely perform bounded head,
status, diff, patch, and branch-creation operations without changing the
checked-out branch or working tree.

## Reason

T0007 requires a narrow native-Git boundary before isolated worktrees can be
created. This ticket establishes that boundary without introducing persistence,
lifecycle orchestration, worktrees, agent execution, or integration staging.

## Dependencies

- T0003 — must be Done

T0002's canonical `pnpm verify` workflow is required for validation but is not a
functional dependency. T0004 is intentionally not required: repository
registration is an inspectable runtime value in this increment, not a persisted
product aggregate.

## Preconditions

- Node.js 24 and pnpm 10 remain the supported toolchain.
- The MVP supports macOS and Linux. Windows support is deferred.
- A local native Git executable passes capability probes for porcelain-v2
  NUL-delimited status, absolute path discovery, exact-object resolution,
  binary diff, no-filter object hashing, alternate indexes, and atomic ref
  creation. Capability failure returns a typed unsupported-Git error rather
  than relying only on a version string.
- The caller supplies an explicit default-branch name; this ticket does not
  infer one heuristically or parse future Blackbox configuration.
- Inputs are non-bare local working trees.
- T0003 Git SHA and stable-error conventions remain authoritative.

## Allowed scope

- New `packages/git/`
- Deterministic temporary-repository fixtures under `fixtures/git/`
- Root workspace manifests and verification scripts required for the package
- `pnpm-lock.yaml` for workspace metadata only
- `README.md`
- Git-boundary clarification in `docs/ARCHITECTURE.md`
- `docs/STATUS.md`
- `docs/VERIFICATION.md`
- `docs/TICKETS.md`
- `docs/tickets/T0005-repository-registration-and-git-adapter.md`

## Protected areas

- T0003 domain contracts and lifecycle meaning
- PostgreSQL schema, migrations, repositories, and product persistence
- Run, ticket, assignment, intent, transaction, ledger, outbox, and queue
  behavior
- Server product routes, CLI product workflows, worker jobs, and web behavior
- Worktree creation, removal, retention, or assignment binding owned by T0007
- Command instrumentation owned by T0011 and Codex execution owned by T0012
- Integration patch application, commits, merges, pushes, resets, and cleans
- The canonical repository's current branch, index, worktree contents, and
  protected refs

## Requirements

### Package boundary

- Add `packages/git` with a database-neutral `GitRepository` interface.
- Export registration, repository snapshot, changed-path, patch-result, and
  stable typed Git-error contracts.
- Keep native subprocess details behind the adapter.
- Add no npm runtime or development dependency.

### Repository registration

- Canonicalize the supplied path with filesystem real-path resolution.
- Resolve and record the canonical working-tree root and common Git directory.
- Reject missing paths, non-repositories, and bare repositories.
- Accept nested input paths and paths containing spaces.
- Treat repository identity as the canonical working-tree root plus common
  Git-directory identity; do not invent or persist a repository UUID.
- Require an explicit default-branch name, validate it with Git ref rules,
  require its local branch ref to exist, and record its exact commit.
- Record exact HEAD, attached or detached state, current branch when attached,
  and cleanliness.
- Cleanliness must include staged, unstaged, deleted, and untracked changes while
  excluding ignored files.

### Git operations

- Support exact head lookup and deterministic status inspection.
- Return changed paths as normalized root-relative POSIX-slash strings in
  deterministic order, with explicit staged, unstaged, deletion, rename, type,
  and untracked metadata.
- Accept an exact validated base commit SHA for patch creation.
- Generate a deterministic binary-capable full-index patch and SHA-256 hash
  relative to that base, and return the exact base SHA with the result.
- Include staged, unstaged, deleted, renamed, executable-bit, symlink, binary,
  and untracked changes in patch generation.
- Use a temporary alternate Git index so the real index and working tree remain
  unchanged.
- Create a branch only from an exact lowercase 40- or 64-character commit SHA.
- Validate branch names, refuse existing refs, create only the requested branch
  ref, and never checkout or alter HEAD.

### Subprocess and error safety

- Execute native Git with argument arrays and no shell interpolation.
- Build a controlled child environment from an explicit allowlist, clear
  inherited `GIT_*` routing and configuration variables, isolate global/system
  configuration, and disable terminal prompts, color, and pager behavior.
- Prevent supported operations from invoking repository-configured helpers,
  including external diff, textconv, clean/process filters, fsmonitor, hooks,
  credential helpers, or pagers. Use command flags and no-filter plumbing where
  possible; return a typed unsupported-repository error rather than execute a
  required helper.
- Bound captured output and return stable sanitized errors without raw stderr,
  environment values, credentials, unsafe arguments, or repository content.
- Refuse revision-like user inputs where an exact SHA or validated ref is
  required.
- Do not expose checkout, switch, worktree, apply, commit, merge, rebase, reset,
  clean, branch deletion, fetch, pull, or push.

### Supported and refused states

- Support clean and dirty working trees, untracked files, detached HEAD, nested
  paths, paths containing spaces, and SHA-1 or SHA-256 repositories.
- Reject unborn repositories, bare repositories, missing Git, missing default
  branch, invalid refs, and invalid or unavailable exact SHAs with typed errors.
- Treat symlink and canonical-path behavior explicitly and never report an
  unverified caller path as repository identity.
- Require NUL-delimited Git path bytes to decode as valid UTF-8 and normalize
  inside the canonical root; return a typed unsupported-path error otherwise.
- Test executable-bit and symlink behavior deterministically on Linux CI and
  supported macOS filesystems. A capability-probe refusal is explicit and must
  not be reported as a passing or silently skipped assertion.

## Acceptance criteria

- A clean temporary repository registers with correct canonical identity,
  explicit default branch, exact default-branch commit, exact HEAD, branch
  state, and `clean: true`.
- A dirty repository reports deterministic staged, unstaged, deleted, renamed,
  and untracked state with `clean: false`.
- Invalid paths, bare or unborn repositories, invalid default-branch names,
  missing default refs, invalid SHAs, and Git failures return stable sanitized
  typed errors.
- Patch bytes and hash are deterministic for identical state and exact base,
  return that base identity, cover all required change classes, and pass
  `git apply --check` against that base in a separate disposable repository.
- Status, patch, and registration operations do not mutate the real index,
  working tree, HEAD, current branch, or default branch.
- Branch creation produces the requested ref at the exact commit without
  checkout and safely refuses collisions.
- Paths containing spaces, nested inputs, symlinks, and detached HEAD are
  behaviorally tested.
- Malicious repository and inherited Git configuration cannot execute external
  helpers or leak a seeded secret through output or errors.
- No persistence, worktree manager, lifecycle, ledger, API, CLI workflow, or
  agent-execution behavior is added.
- Aggregate verification passes.

## Automated verification

- `pnpm --filter @blackbox/git test`
- `pnpm --filter @blackbox/git typecheck`
- `pnpm --filter @blackbox/git build`
- Temporary-repository integration tests for clean, dirty, detached, bare,
  unborn, nested, symlinked, and space-containing paths
- Patch tests for staged, unstaged, deleted, renamed, executable, symlink,
  binary, and untracked changes
- Deterministic patch-byte and SHA-256 checks plus `git apply --check`
- Branch tests for exact start commit, collision refusal, and unchanged
  HEAD/current/default branch
- Adversarial ref, revision, path, output-limit, missing-Git, and redaction tests
- Malicious local/global configuration and attributes tests proving external
  diff, textconv, filter, fsmonitor, hook, credential, and pager helpers do not
  execute
- Capability-probe and unsupported-platform/path tests, with Linux CI coverage
  for executable bits and symlinks and supported macOS verification
- Static checks proving no shell execution and no prohibited mutating or network
  Git command is exposed
- `pnpm verify`
- `git diff --check`
- Generated-artifact and secret inspection

## Manual verification

1. Create a disposable repository in a path containing spaces with an explicit
   `main` branch.
2. Register it and inspect canonical root, common Git directory, default branch,
   exact HEAD, attached state, and cleanliness.
3. Add a staged change, unstaged change, deletion, rename, and untracked file;
   confirm status and changed paths are accurate.
4. Generate a patch against an explicit exact base SHA, confirm the result
   records that base and the real index and working tree are unchanged, then
   verify it against a separate checkout of that base.
5. Create a branch through the adapter and confirm the ref exists while the
   checked-out branch and HEAD remain unchanged.
6. Confirm invalid directory, bare repository, missing default branch, invalid
   ref, invalid SHA, and existing-branch cases fail with sanitized messages.
7. Remove the disposable repositories and confirm the Blackbox canonical
   repository was never modified.

## Exclusions

- Durable repository-registration storage or a repository UUID
- Configuration parsing, `blackbox init`, product API routes, or CLI
  registration commands
- Worktree creation, assignment ownership, retention, cleanup, or cross-worktree
  access
- Patch application, staging branches, integration preparation, commits,
  merges, pushes, resets, or cleans
- Arbitrary command execution, Codex execution, ledger events, conflict
  detection, and filesystem-read instrumentation
- Clone, fetch, pull, remotes, credentials, submodule orchestration, or hosted
  repositories

## Documentation required

- Document the native-Git prerequisite, explicit default-branch input,
  supported primitives, and non-bare local-repository limitation in `README.md`.
- Record the `GitRepository` boundary and native subprocess safety rules in
  `docs/ARCHITECTURE.md`.
- Add repository and Git verification procedures to `docs/VERIFICATION.md`.
- Record implemented behavior and T0006/T0007 ownership boundaries in
  `docs/STATUS.md`.
- Keep this ticket Draft until separate validation and explicit human
  promotion.

## Rollback

Revert the ticket changes. The adapter creates no persisted product state;
manual verification uses disposable repositories and branches that must be
removed explicitly.

## Reviewer focus

- No-shell subprocess construction and argument/ref validation
- Controlled Git environment and refusal of repository-configured helper
  execution
- Canonical-root and explicit-default-branch semantics
- Dirty-state completeness and deterministic changed-path parsing
- Patch completeness, alternate-index isolation, binary handling, and hashing
- Typed-error sanitization and bounded output
- Branch collision safety and unchanged HEAD, index, worktree, and protected refs
- No leakage into persistence, lifecycle, worktree, command-runner, or
  integration ownership

## Dependency evaluation

- Use Node standard-library `child_process`, `fs`, `path`, `os`, and `crypto`.
- Use the installed native Git executable behind `GitRepository`, consistent
  with `docs/ARCHITECTURE.md`.
- Reject `simple-git`, `isomorphic-git`, and handwritten repository parsing as
  unnecessary or divergent abstractions.
- Git remains a user-installed GPLv2 external tool; it is not redistributed or
  linked into Blackbox.
- Replacement cost is medium but confined to the adapter interface.

## Smallest choices

- One new `packages/git` package
- Explicit caller-provided default branch rather than remote heuristics
- Canonical filesystem and Git-directory identity rather than persistence
- Exact commit SHAs rather than revision expressions
- Native Git porcelain/plumbing with deterministic parsing
- Temporary alternate-index patch generation
- Branch-ref creation only; T0007 owns worktree attachment

## Stop conditions

- Stop if required behavior needs shell interpolation or human-oriented terminal
  parsing.
- Stop if complete patch generation requires mutating the real index or working
  tree.
- Stop if repository identity requires persistence or configuration ownership.
- Stop if implementation requires worktree, lifecycle, ledger, command-runner,
  remote Git, or integration-staging behavior.
- Stop if a dependency becomes necessary before its maintenance, license,
  security, transitive impact, and replacement cost are evaluated.
- Stop on conflict with accepted ADRs, architecture invariants, or T0003
  contracts.
- Stop before implementation unless a separate `plan_validator` returns `GO`
  and a human explicitly promotes the ticket to Ready.

## Readiness

This Draft resolves the native-Git package boundary, repository identity,
supported repository states, exact-SHA and branch semantics, patch isolation,
and later-ticket ownership. Separate read-only validation and explicit human
promotion remain mandatory before Ready.
