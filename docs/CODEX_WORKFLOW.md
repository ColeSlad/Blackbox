# Codex Engineering Workflow

This repository-scoped harness plans Draft tickets, runs one bounded ticket
through controlled implementation, analyzes evidence for durable process
improvements, and applies one separately approved harness improvement. Every
write-capable workflow has one writer boundary and stops before commit or merge.

The harness is engineering infrastructure only. It does not implement Blackbox
product behavior.

## Prerequisites

- Git.
- A current Codex CLI installed and authenticated.
- The repository marked trusted when project-scoped Codex agents and skills
  should load.
- Bash and standard Unix command-line tools.
- Python 3 standard library for path validation, JSON handling, and evidence
  manifests.

The harness was reconciled against Codex CLI `0.144.5`. This version supports
`codex exec`, project custom agents, skills, `--output-schema`, and review modes
for uncommitted changes, a base branch, or a commit. `codex review` does not
currently expose `--json` or `--output-schema`; `review-ticket.sh` therefore
stores its human-readable result and requires an explicit overall-result marker.
If native uncommitted review is unavailable in a future installation, the script
falls back to read-only `codex exec` with the review schema.

This CLI's structured-output subset rejects some otherwise valid JSON Schema
keywords, including `allOf` and `uniqueItems` in the tested positions. The
repository schemas therefore use the supported structural subset and enforce
cross-field, zero-or-three, uniqueness, index-preservation, and writer-count
rules deterministically in the wrapper scripts.

Custom-agent spawning works in persistent `codex exec` sessions but failed in a
tested `--ephemeral` session with a missing parent-thread error. Repository
multi-agent wrappers intentionally do not use `--ephemeral`. Read-only planning
and retrospective agents can take several minutes while auditing the large
architecture and evidence sources; their scripts retain events and fail closed
on nonzero interruption.

Non-interactive scripts use the global `codex --ask-for-approval never` policy,
spelled as `codex -a never ...`, so a new permission request fails instead of
silently escalating. No script uses `danger-full-access`.

## One-time setup verification

Run from any repository subdirectory:

```bash
./scripts/codex/doctor.sh
```

The doctor reports Git state, planning documents, Codex capabilities, agent and
skill files, schemas, shell syntax, JSON validity, model/config overrides, and
obvious secret-file risks. It also reminds you that a Codex restart may be
needed after adding project skills.

## Agent roles

- `plan_validator`: read-only prerequisite and ticket consistency gate.
- `project_explorer`: read-only repository map and verification plan.
- `ticket_worker`: the only implementation writer.
- `verification_auditor`: read-only acceptance-evidence audit.
- `ticket_reviewer`: fresh independent read-only diff review.
- `ticket_closer`: the only writer in a later documentation-only closure run.
- `project_planner`: read-only product increment and Draft-ticket proposer.
- `harness_retrospective`: read-only systemic process-failure analyst.
- `harness_improver`: sole writer for one explicitly approved harness proposal.

A ticket worker never runs concurrently with another writer. A focused repair
cycle reuses the same worker once. Closure is a separate run after a human
verification record exists.

Planning uses read-only planner and validator agents; only the invoking planning
session may materialize Draft documents. Retrospectives have no writer.
Harness-improvement runs use one improver and a later independent read-only
reviewer. No workflow may overlap writer roles.

## Ticket planning

Preview the next three smallest dependency-ordered product increments:

```bash
./scripts/codex/plan-next.sh --dry-run
```

The default is dry-run, so Codex receives a read-only sandbox and only structured
planning evidence is stored. To materialize reviewed proposals from a clean
working tree:

```bash
./scripts/codex/plan-next.sh --execute
```

The `$project-plan` workflow reads product, architecture, status, ticket index,
accepted ADR, individual-ticket, completed-ticket, and verification sources. It
uses `project_planner` read-only, creates exactly three complete ticket
specifications as `Draft`, and runs `plan_validator` read-only as a separate
validation phase. Planning may create new files below `docs/tickets/` and any
necessary Draft rows in `docs/TICKETS.md`; it may not change application code.

A validation result never promotes a ticket automatically. A human must review
the specification, reconcile blockers, and make a separate explicit status
change to `Ready`. Only then may ticket execution be considered.

## Interactive ticket execution

Start Codex in the repository:

```bash
codex
```

Then invoke:

```text
$ticket-runner

Execute docs/tickets/T0001-project-skeleton.md.
```

The runner reads the individual ticket as the authority for its status and
scope, waits for both read-only gates, uses one writer only when both return
`GO`, audits real command evidence, obtains a fresh independent review, and
stops for human verification.

## Automated local ticket execution

```bash
./scripts/codex/run-ticket.sh docs/tickets/T0001-project-skeleton.md
```

The script:

1. validates the ticket path and `Ready` status;
2. runs the harness doctor;
3. saves pre-run Git state;
4. invokes `codex exec` in `workspace-write` with approval escalation disabled;
5. applies the ticket-run result schema;
6. saves the JSONL event stream, structured result, final summary, stderr, post-run
   Git state, and diff summary;
7. propagates a nonzero Codex exit status.

It automates validation, exploration, one worker, verification auditing, and
review. It does not perform human verification or documentation closure.

`run-ticket.sh` sends the Codex JSONL stream through
`scripts/codex/run-codex-observed.py`. The observer preserves complete events
while printing concise phase messages, commands, read-only gate waits, and
terminal status to the invoking terminal and `progress.log`. This makes a long
read-only phase visibly active without starting a writer early.

Codex CLI `0.144.5` does not expose custom-agent spawn events in the parent
`--json` stream, and successful collaboration waits can contain an empty
`receiver_thread_ids` array. The wrapper therefore cannot infer spawn failure
from that field. The skill requires explicit spawn-result confirmation and
fails closed when spawning itself reports failure; retained progress and event
logs remain the factual runtime evidence.

## Independent review

```bash
./scripts/codex/review-ticket.sh docs/tickets/T0001-project-skeleton.md
```

This wrapper remains read-only, reviews staged, unstaged, and untracked changes,
stores the result under `.codex-runs/reviews/`, and exits nonzero for a blocking
result. The current native review modes can be inspected with:

```bash
codex review --help
codex review --uncommitted
```

## Manual verification

Follow the selected ticket exactly. Do not reuse this generic template to omit a
ticket-specific step.

```text
Manual verification: Pass / Fail

Environment:
- Operating system:
- Browser:
- Node version:
- Package-manager version:

Checks:
- Dependency installation:
- Development server:
- Expected UI:
- Browser console:
- Tests:
- Production build:

Notes:
```

Store a completed local record under an ignored path such as
`.codex-runs/manual/T0001.md`. Record observed results, not intended results.

## Documentation closure

After automated evidence and independent review pass and a human record exists:

```bash
./scripts/codex/close-ticket.sh \
  docs/tickets/T0001-project-skeleton.md \
  .codex-runs/manual/T0001.md
```

The closure flow audits the evidence first, permits one documentation-only
writer, and verifies by file manifest that only `docs/STATUS.md`,
`docs/TICKETS.md`, the selected ticket, and `docs/completed-tickets/` changed
during the run.

## Commit and merge

Commit and merge are human-controlled, separate steps. After reviewing the full
diff and all evidence, a human may deliberately run commands such as:

```bash
git status --short
git diff --check
git diff
git add <reviewed-paths>
git commit
git push
```

No harness script stages, commits, pushes, rebases, or merges.

## Next-ready discovery

The convenience wrapper follows `docs/TICKETS.md` ordering and dependencies, but
uses each individual ticket file as the authority for `Ready` and `Done` status.
It selects at most one eligible ticket. Its default is read-only discovery:

```bash
./scripts/codex/run-next-ready.sh --dry-run
```

Write-capable execution requires the explicit `--execute` flag. The wrapper
never loops through tickets or creates a branch.

## One-ticket autopilot

Autopilot combines next-ready discovery, worktree isolation, and the existing
ticket runner. It handles exactly one ticket per invocation and defaults to
read-only planning:

```bash
./scripts/codex/autopilot.sh --dry-run
```

The dry run identifies at most one individual ticket whose status is `Ready`
and whose dependencies from its authoritative `## Dependencies` section are
individually `Done`. A dependency mismatch with `docs/TICKETS.md` blocks
selection rather than choosing a convenient source. The dry run creates no
branch, worktree, or writer.

Write-capable operation requires a clean `main` checkout and an explicit flag:

```bash
./scripts/codex/autopilot.sh --execute
```

The script creates one `codex/autopilot-*` branch and a dedicated sibling
worktree below `.codex-worktrees/`, invokes that worktree's
`scripts/codex/run-ticket.sh` exactly once, then stops. It never recursively
invokes itself, selects a second ticket, performs manual verification, closes
documentation, stages changes, commits, pushes, merges, or removes the worktree.
The final output identifies the ticket, branch, worktree, and exact human steps.

## Retrospective flow

After a ticket run—or after manual verification supplies additional evidence—run
a read-only retrospective against one explicit evidence directory:

```bash
./scripts/codex/retrospective.sh \
  T0001 \
  .codex-runs/T0001/TIMESTAMP \
  .codex-runs/manual/T0001.md
```

The manual record is optional. The `$harness-retrospective` workflow reads only
the named evidence, ticket, checks, review findings, and manual record. It
distinguishes one-off implementation defects from repeated or systemic harness
failures and emits either no improvement or one highest-value proposal.

The wrapper accepts only the latest timestamped direct ticket-run directory at
`.codex-runs/<ticket-id>/<timestamp>/`, verifies its metadata names that ticket
and the `ticket-runner` workflow, and rejects planning, review, closure,
retrospective, stale, or cross-ticket evidence. An optional manual record must
be named `.codex-runs/manual/<ticket-id>.md` or
`.codex-runs/manual/<ticket-id>-*.md`.

Recommendations prefer regression tests, deterministic checks, ticket
clarification, architecture clarification, skill updates, then `AGENTS.md`
updates. Structured results are stored below
`.codex-runs/retrospectives/<ticket-id>/<timestamp>/`. Every proposal remains
`PENDING`, forbids product-scope changes, and requires separate human approval.

## Harness-improvement approval

Do not edit a retrospective result to approve it. Create a separate ignored
record such as `.codex-runs/approvals/HR-example.md`. First compute the exact
proposal digest:

```bash
shasum -a 256 .codex-runs/retrospectives/T0001/TIMESTAMP/result.json
```

Bind the approval to both the proposal ID and digest:

```text
Harness improvement approval: Approved
Proposal ID: HR-example
Proposal SHA-256: SHA256_FROM_THE_COMMAND
Approved by: NAME
Reason: WHY THIS ONE CHANGE IS APPROVED
```

Preview the exact approved proposal without starting a writer:

```bash
./scripts/codex/apply-harness-improvement.sh \
  .codex-runs/retrospectives/T0001/TIMESTAMP/result.json \
  .codex-runs/approvals/HR-example.md \
  --dry-run
```

Apply it explicitly from a clean working tree:

```bash
./scripts/codex/apply-harness-improvement.sh \
  .codex-runs/retrospectives/T0001/TIMESTAMP/result.json \
  .codex-runs/approvals/HR-example.md \
  --execute
```

The `$harness-improve` workflow validates the pending proposal and digest-bound
separate approval before starting exactly one `harness_improver`. File manifests enforce
both proposal-specific paths and the global harness-only boundary: tests,
scripts, `AGENTS.md`, `.codex/`, `.agents/`, ticket templates, and this workflow
document. Product code and product requirements are prohibited.

The improver runs proposal checks and the doctor, then a fresh
`ticket_reviewer` performs independent read-only harness review. One focused
repair may reuse the same improver; a second writer is forbidden. The script
exits nonzero on failed validation, prohibited paths, blocking review, product
scope change, or an unconfirmed one-writer result. It stops before staging,
commit, push, or merge.

## Worktree isolation

Autopilot creates a branch and sibling worktree from a verified clean `main` so
ticket changes cannot dirty the canonical checkout. The worktree remains after
the run for evidence inspection, manual verification, closure, and human Git
decisions. Never point two writing workflows at the same worktree.

Worktrees do not relax ticket status, dependency, validation, review, or human
approval gates. Remove an abandoned worktree only after inspecting and retaining
needed evidence, and perform that cleanup manually outside the harness scripts.

## Scheduling criteria

No recurring scheduler is enabled. Do not schedule write-capable autopilot until
all of these conditions are demonstrated across multiple manually supervised
runs:

- dry-run selection consistently chooses the intended single ticket;
- ticket statuses and dependencies remain accurate;
- clean-main and worktree isolation failures are deterministic;
- runner evidence, review, and recovery are reliable;
- manual verification and closure remain explicitly human initiated;
- credential, sandbox, and approval behavior is understood on the host;
- failed runs do not trigger automatic retries or a second ticket.

Until then, scheduling may invoke read-only `doctor.sh`, planning dry-runs,
autopilot dry-runs, reviews, or retrospectives only. Any future scheduler is a
separate reviewed harness proposal and must not create a recursive loop.

## Optional GitHub review

`.github/workflows/codex-review.yml.example` is an opt-in, read-only template
using `openai/codex-action@v1`. It checks out the proposed merge commit with full
history, blocks untrusted fork PRs from the secret-bearing job, uses the
repository independent-review prompt, and uploads the result as an artifact.

To enable it, first review repository and fork-security requirements, configure
`OPENAI_API_KEY` as a GitHub secret, then copy the example:

```bash
cp .github/workflows/codex-review.yml.example .github/workflows/codex-review.yml
```

The example does not apply patches, commit, or merge.

## Run artifacts

Local evidence is stored below `.codex-runs/`:

- `<ticket-id>/<timestamp>/` for ticket runs;
- `reviews/<ticket-id>/<timestamp>/` for independent reviews;
- `closures/<ticket-id>/<timestamp>/` for documentation closure;
- `manual/` for human verification records.
- `planning/PROJECT/<timestamp>/` for three-ticket planning results;
- `retrospectives/<ticket-id>/<timestamp>/` for structured retrospective output;
- `improvements/<proposal-id>/<timestamp>/` for approved harness-improvement
  evidence;
- the dedicated autopilot worktree's `.codex-runs/<ticket-id>/<timestamp>/` for
  its one ticket run.

Artifacts include status snapshots, metadata, Codex events or review output,
structured results where supported, stderr, file manifests for closure, and diff
summaries. They are ignored by Git except for `.codex-runs/.gitkeep`.

Raw model traces are local evidence, not automatically trusted proof. Summarize
accepted evidence into ticket documentation rather than committing raw traces.

## Troubleshooting

### Project agents do not load

Open Codex from the repository root, approve repository trust when prompted, and
restart Codex. Then run `./scripts/codex/doctor.sh`.

### A skill is not visible

Restart Codex after adding or changing `.agents/skills/`. Confirm the skill's
`SKILL.md` has valid `name` and `description` frontmatter.

### A CLI flag is unsupported

Run `codex --version`, `codex exec --help`, and `codex review --help`. Upgrade the
CLI through the installation method reported by `codex doctor --json`; for the
current Homebrew installation the command is:

```bash
brew upgrade --cask codex
```

Do not copy unsupported flags into scripts. Preserve read-only gates through the
documented `codex exec --sandbox read-only` fallback.

### Non-interactive approval fails

This is expected when a run needs new authority. Inspect the request and rerun
interactively if a human chooses to grant it; do not weaken the script sandbox.

### The working tree is dirty

Inspect `git status --short`. Preserve unrelated changes and stop when they
cannot be separated safely from the selected ticket.

### A ticket is blocked by conflicting documents

Reconcile the authoritative ticket, accepted ADRs, and architecture before
implementation. `docs/TICKETS.md` is an index, while the individual ticket owns
its detailed status and scope.

### Review loops

Use at most one focused repair cycle with the same worker and one fresh review.
Stop as `BLOCKED` or `PARTIAL` if significant findings remain.

### Manual evidence is missing

Do not run closure. Complete the exact ticket steps and provide an explicit
`Manual verification: Pass` record first.

### Automated run recovery

Do not rerun blindly. Keep the failed branch and worktree unchanged, inspect the
run's `events.jsonl`, `codex.stderr.log`, structured result, status snapshots,
and diff summary, and determine whether any partial changes are safe to retain.
Run the relevant deterministic command manually. If the cause may be systemic,
run `retrospective.sh` against that exact evidence directory and seek approval
for at most one durable improvement.

After diagnosis, a human chooses whether to continue in the same isolated
worktree, discard it, or write a clarifying ticket. The harness never resets,
cleans, deletes a worktree, or automatically retries.

### Harness proposal is rejected or stale

Leave the retrospective result unchanged. Record rejection separately or create
a new retrospective from newer evidence. `apply-harness-improvement.sh` refuses
missing, ambiguous, mismatched, product-scope, or non-pending proposals before a
writer starts.
