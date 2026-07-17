# Codex Engineering Workflow

This repository-scoped harness runs one bounded ticket through read-only
validation and exploration, one implementation writer, automated evidence
auditing, and fresh independent review. It stops before human manual
verification, documentation closure, commit, or merge.

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

A ticket worker never runs concurrently with another writer. A focused repair
cycle reuses the same worker once. Closure is a separate run after a human
verification record exists.

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

## Worktrees

Use the current checkout for the initial sequential tickets. Consider isolated
worktrees only after several ticket runs have stabilized the process and only
when dependencies, interfaces, and file ownership do not overlap. Worktrees do
not relax the one-writer-per-ticket rule or any validation gate.

## Scheduled operation

Two scheduling approaches are supported:

1. A ChatGPT desktop scheduled task can use this repository and an isolated
   worktree while the desktop app is running and the local project is available.
2. An operating-system scheduler can call
   `run-next-ready.sh --dry-run` or one deliberately approved
   `run-ticket.sh <ticket>` command.

Schedule read-only review, triage, or dry-run discovery before scheduling
write-capable ticket execution. The harness does not enable an unattended
implementation scheduler.

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
