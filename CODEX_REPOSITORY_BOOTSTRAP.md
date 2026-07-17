# Codex Repository Harness Bootstrap

Give this entire file to Codex from the root of the Blackbox repository.

Recommended interactive use:

```bash
codex
```

Then paste:

```text
Execute CODEX_REPOSITORY_BOOTSTRAP.md completely.
```

Recommended non-interactive use:

```bash
codex exec \
  --sandbox workspace-write \
  "Execute CODEX_REPOSITORY_BOOTSTRAP.md completely. Do not implement any product ticket."
```

## Mission

Set up a repository-scoped Codex engineering harness for Blackbox.

The harness must:

1. configure specialized validation, exploration, implementation, review, verification, and documentation agents;
2. provide a reusable `$ticket-runner` workflow;
3. support non-interactive local automation through `codex exec`;
4. preserve the rule that exactly one writing agent implements a ticket;
5. stop before implementation whenever read-only validation finds a blocker;
6. require a fresh independent review after implementation;
7. preserve human gates for manual verification, acceptance, commit, and merge;
8. save structured run evidence without committing transient agent logs;
9. remain usable before T0001 creates the application workspace;
10. avoid implementing Blackbox product behavior as part of this setup.

This task creates the **engineering harness only**. It does not execute T0001 and does not implement the project skeleton.

---

# 1. Mandatory operating constraints

These rules are authoritative for this bootstrap.

## Safety and scope

- Inspect the repository before editing.
- Preserve all unrelated working-tree changes.
- Do not delete or overwrite an existing file without first reading it and merging compatible content.
- Do not modify application source code.
- Do not implement any ticket.
- Do not install application dependencies.
- Do not commit, push, merge, rebase, reset, clean, or alter Git history.
- Do not write secrets, API keys, authentication tokens, or user-level Codex configuration into the repository.
- Do not configure unattended use of `danger-full-access`.
- Use repository-scoped configuration only.
- Omit explicit model names from project agent files unless the installed Codex version requires one. Agents should normally inherit the user's current model.
- Prefer standard-library shell or Python automation so this harness works before pnpm dependencies are installed.

## Ticket ownership

- A ticket may have only one writing agent.
- Validation, exploration, and review agents must be read-only.
- The implementation agent may be re-used for one focused repair cycle; do not spawn a second implementation agent.
- Documentation closure happens in a separate run after human verification. The documentation closer is the only writer in that closure run.
- Never let two writing agents operate concurrently in the same checkout.

## Gate ordering

A normal ticket run must follow this sequence:

```text
read repository guidance
        ↓
validate ticket ──┐
                  ├── both read-only and may run concurrently
explore repository┘
        ↓
wait for both results
        ↓
stop if either reports BLOCKED
        ↓
start exactly one implementation worker
        ↓
run automated checks
        ↓
start a fresh read-only reviewer
        ↓
optionally return accepted findings to the same worker once
        ↓
run affected checks again
        ↓
produce evidence report
        ↓
STOP for human manual verification
```

The automated runner must never:

- mark a ticket `Done`;
- perform the human manual-verification steps;
- claim that browser behavior was verified when it was not;
- commit or merge;
- begin a dependent ticket;
- silently loosen sandbox or approval settings;
- continue after an authoritative blocker.

---

# 2. Inspect and reconcile the repository first

Before creating files:

1. Run `git rev-parse --show-toplevel`.
2. Run `git status --short`.
3. Read, when present:
   - `AGENTS.md`
   - `docs/PRODUCT.md`
   - `docs/ARCHITECTURE.md`
   - `docs/STATUS.md`
   - `docs/TICKETS.md`
   - `docs/VERIFICATION.md`
   - `docs/adr/*.md`
   - `docs/tickets/*.md`
   - existing `.codex/**`
   - existing `.agents/**`
   - existing `scripts/**`
4. Run:
   - `codex --version`
   - `codex exec --help`
   - `codex review --help`
5. Confirm the installed CLI supports project-scoped custom agents and `codex exec`.
6. If a requested Codex feature is unavailable in the installed version:
   - do not invent unsupported syntax;
   - implement the compatible subset;
   - record the limitation in `docs/CODEX_WORKFLOW.md`;
   - provide the exact upgrade or manual fallback command;
   - continue only when the fallback preserves the safety gates.

## Documentation authority

Use these source-of-truth rules:

1. The individual ticket file is authoritative for its own status, scope, dependencies, acceptance criteria, checks, and manual verification.
2. Accepted ADRs and `docs/ARCHITECTURE.md` are authoritative for architectural boundaries.
3. `docs/PRODUCT.md` is authoritative for product intent and MVP scope.
4. `docs/TICKETS.md` is an index, not a duplicate specification.
5. `docs/STATUS.md` records factual repository state only.
6. `docs/VERIFICATION.md` defines general verification policy.

When authoritative documents conflict, validation must report `BLOCKED`. Do not choose a convenient interpretation.

---

# 3. Required repository structure

Create or reconcile this structure:

```text
AGENTS.md

.codex/
  config.toml
  agents/
    plan-validator.toml
    project-explorer.toml
    ticket-worker.toml
    ticket-reviewer.toml
    verification-auditor.toml
    ticket-closer.toml
  prompts/
    automated-ticket-run.md
    independent-review.md
    ticket-closure.md
  schemas/
    ticket-run-result.schema.json
    review-result.schema.json
    closure-result.schema.json

.agents/
  skills/
    ticket-runner/
      SKILL.md
    ticket-review/
      SKILL.md
    ticket-close/
      SKILL.md

scripts/
  codex/
    doctor.sh
    run-ticket.sh
    review-ticket.sh
    close-ticket.sh
    run-next-ready.sh
    common.sh

docs/
  CODEX_WORKFLOW.md

.codex-runs/
  .gitkeep
```

Add `.codex-runs/**` to `.gitignore`, while preserving `.codex-runs/.gitkeep` if the repository prefers keeping the directory visible.

If equivalent files already exist, reconcile them instead of creating duplicates.

---

# 4. Create or update `AGENTS.md`

`AGENTS.md` must be concise enough to remain useful in every Codex run. It should point to detailed workflow documentation rather than duplicating everything.

It must include the following substance.

## Project purpose

Blackbox is a transactional runtime and causal debugger for parallel coding-agent fleets. Repository work must favor explicit state, verifiable behavior, causal evidence, narrow boundaries, and reversible changes.

## Authoritative documents

List the source-of-truth order defined above and instruct agents to stop on unresolved conflicts.

## Ticket workflow

Require agents to:

- work only on a `Ready` ticket;
- verify all dependencies are `Done`;
- run read-only validation and exploration before implementation;
- wait for both before starting a writer;
- use exactly one writer;
- run a fresh independent read-only review;
- produce acceptance-criteria evidence;
- stop for human manual verification;
- never commit or merge unless explicitly instructed by the human in a separate step.

## Change discipline

Require agents to:

- stay within ticket scope;
- preserve unrelated changes;
- avoid speculative abstractions;
- add dependencies only when evaluated as required by architecture policy;
- add regression tests when fixing reproducible defects;
- update factual documentation when behavior changes;
- report commands and results honestly;
- distinguish automated evidence from manual verification.

## Agent delegation

Name the configured roles and summarize when each must be used:

- `plan_validator`
- `project_explorer`
- `ticket_worker`
- `ticket_reviewer`
- `verification_auditor`
- `ticket_closer`

Make clear that only `ticket_worker` writes during implementation, and only `ticket_closer` writes during a later documentation-only closure.

## Durable learning

When the same failure occurs twice, propose a permanent improvement to a test, ticket template, architecture document, `AGENTS.md`, skill, or deterministic script. Do not grow prompts indefinitely when a repository-level control would solve the problem.

Link to `docs/CODEX_WORKFLOW.md` for detailed commands.

---

# 5. Configure project-scoped subagents

Create `.codex/config.toml` with conservative shared subagent limits:

```toml
[agents]
max_threads = 4
max_depth = 1
interrupt_message = true
```

Do not set project-level credentials, provider configuration, telemetry destinations, or a hard-coded model.

Create the following standalone custom agent files in `.codex/agents/`.

## `plan-validator.toml`

Required behavior:

- Name: `plan_validator`.
- Sandbox: read-only.
- Validate the ticket against the actual repository and authoritative documentation.
- Check status, dependencies, false preconditions, acceptance-test feasibility, scope contradictions, unresolved ADR requirements, and dependency-policy violations.
- Do not propose implementation details beyond what is necessary to explain a blocker.
- Return one of:
  - `GO`
  - `BLOCKED`
- Every blocker must cite concrete repository paths and, where possible, line ranges.
- Never edit files.

Suggested configuration shape:

```toml
name = "plan_validator"
description = "Read-only ticket validator that checks authoritative prerequisites before implementation."
sandbox_mode = "read-only"
developer_instructions = """
Validate the requested ticket against the current repository before any writing agent starts.
Check status, dependencies, authoritative document consistency, acceptance-criteria feasibility,
unmet architecture decisions, false preconditions, and dependency-policy compliance.
Return GO or BLOCKED with concrete file evidence. Never edit files.
"""
```

## `project-explorer.toml`

Required behavior:

- Name: `project_explorer`.
- Sandbox: read-only.
- Map the existing implementation paths, package boundaries, commands, tests, likely files, integration risks, and unrelated working-tree changes.
- Identify the smallest compliant implementation route.
- Report a concise execution plan and verification map.
- Explicitly report blockers when the repository cannot satisfy the ticket as written.
- Never edit files.

## `ticket-worker.toml`

Required behavior:

- Name: `ticket_worker`.
- Sandbox: workspace-write.
- Be the only implementation writer.
- Implement only the selected ticket.
- Preserve unrelated changes.
- Follow authoritative documents and the read-only analyses.
- Run ticket-specific checks.
- Do not commit, merge, mark the ticket `Done`, perform manual verification, or start another ticket.
- Return a changed-files list, command log, test results, acceptance-criteria report, deviations, and remaining risks.
- When invoked for repairs, address only accepted findings.

## `ticket-reviewer.toml`

Required behavior:

- Name: `ticket_reviewer`.
- Sandbox: read-only.
- Review the completed diff independently.
- Prioritize:
  - unmet acceptance criteria;
  - correctness defects;
  - behavior regressions;
  - architecture violations;
  - unrelated scope;
  - unsafe or unnecessary dependencies;
  - missing tests;
  - misleading documentation.
- Ignore style-only preferences unless they conceal a real defect.
- Cite files and explain reproduction or impact.
- Return `PASS`, `PASS_WITH_NONBLOCKING_FINDINGS`, or `BLOCKED`.
- Never edit files.

## `verification-auditor.toml`

Required behavior:

- Name: `verification_auditor`.
- Sandbox: read-only.
- Compare the ticket's acceptance criteria and required evidence with actual command output and repository state.
- Distinguish:
  - verified automatically;
  - requires human manual verification;
  - failed;
  - not attempted.
- Never invent evidence.
- Never treat an agent statement as equivalent to command output.
- Never edit files.

## `ticket-closer.toml`

Required behavior:

- Name: `ticket_closer`.
- Sandbox: workspace-write.
- Run only after a human provides an explicit manual-verification record.
- Modify documentation only.
- Update:
  - `docs/STATUS.md`;
  - `docs/TICKETS.md`;
  - the selected ticket file;
  - `docs/completed-tickets/`.
- Do not modify application code.
- Do not add speculative future plans.
- Do not commit or merge.
- Refuse closure when evidence is incomplete or manual verification failed.

Use narrow, opinionated instructions. Do not give read-only agents write-capable sandboxes.

---

# 6. Create the `$ticket-runner` skill

Create `.agents/skills/ticket-runner/SKILL.md`.

Use valid skill metadata:

```yaml
---
name: ticket-runner
description: Execute one Ready repository ticket with read-only validation and exploration, exactly one implementation writer, independent review, and an evidence report. Stop before human verification, commit, or merge.
---
```

The skill must accept a ticket path from the user prompt.

Its workflow must be explicit:

## Phase A — establish state

1. Read `AGENTS.md` and all authoritative documents relevant to the ticket.
2. Read the ticket completely.
3. Capture `git status --short`.
4. Refuse to proceed when:
   - the ticket is not `Ready`;
   - a dependency is not `Done`;
   - the ticket path is missing;
   - unrelated changes cannot be safely preserved;
   - repository guidance conflicts materially.

## Phase B — parallel read-only gate

1. Spawn `plan_validator`.
2. Spawn `project_explorer`.
3. Allow them to run concurrently.
4. Wait for both.
5. Do not start any writing agent while either is running.
6. If either returns `BLOCKED`, stop and produce a blocker report.
7. If one returns `GO` and the other identifies a blocker, treat the run as blocked.

## Phase C — implementation

1. Spawn exactly one `ticket_worker`.
2. Give it:
   - the ticket;
   - relevant validation findings;
   - relevant exploration findings;
   - explicit scope boundaries.
3. Wait for completion.
4. Do not spawn another writer.

## Phase D — automated verification

1. Run the ticket's mandatory checks.
2. Preserve complete command output.
3. Spawn `verification_auditor` to map evidence to criteria.
4. Do not claim manual checks are complete.

## Phase E — independent review

1. Spawn a fresh `ticket_reviewer`.
2. Give it the ticket and current diff, not the worker's self-assessment as authority.
3. If it reports blockers:
   - summarize actionable findings;
   - invoke the same `ticket_worker` for at most one focused repair cycle;
   - rerun affected checks;
   - invoke a fresh `ticket_reviewer` once more.
4. If significant blockers persist after the repair cycle, stop with status `BLOCKED` or `PARTIAL`.
5. Do not create endless review loops.

## Phase F — report and stop

Return:

- ticket ID and title;
- result status;
- validator result;
- explorer result;
- worker summary;
- changed files;
- commands run;
- test/build/lint/type-check results;
- acceptance-criteria table with evidence;
- reviewer result and findings;
- unresolved risks;
- exact manual-verification steps still required;
- explicit statement that no commit or merge occurred.

Stop after the report.

---

# 7. Create the independent-review skill

Create `.agents/skills/ticket-review/SKILL.md` with metadata similar to:

```yaml
---
name: ticket-review
description: Perform a fresh read-only review of uncommitted or branch changes against one ticket, emphasizing correctness, scope, architecture, dependencies, and tests.
---
```

Required behavior:

- Accept a ticket path.
- Use `ticket_reviewer`.
- Review staged, unstaged, and untracked changes when asked for an uncommitted review.
- Do not edit files.
- Produce findings ordered by severity.
- Include a clear overall result.
- Avoid duplicating style-only comments.

---

# 8. Create the ticket-closure skill

Create `.agents/skills/ticket-close/SKILL.md` with metadata similar to:

```yaml
---
name: ticket-close
description: Close one accepted ticket through documentation-only updates after explicit human manual-verification evidence is provided.
---
```

Required behavior:

- Require:
  - ticket path;
  - automated-review result;
  - human manual-verification record.
- Use `verification_auditor` first.
- Stop if evidence is incomplete.
- Then use exactly one `ticket_closer`.
- Inspect the resulting documentation diff.
- Never modify application code.
- Never commit or merge.

---

# 9. Create non-interactive automation prompts

Create `.codex/prompts/automated-ticket-run.md`.

It must instruct the root Codex agent to:

- invoke `$ticket-runner`;
- use the ticket path supplied after the prompt;
- obey the read-only gate;
- use exactly one writer;
- save a complete factual report;
- stop before manual verification, documentation closure, commit, or merge.

Create `.codex/prompts/independent-review.md`.

It must instruct Codex to:

- review the selected ticket against current changes;
- prioritize acceptance criteria, correctness, architecture, scope, tests, and dependencies;
- remain read-only;
- return structured findings.

Create `.codex/prompts/ticket-closure.md`.

It must instruct Codex to:

- require a human verification record;
- perform documentation-only closure;
- stop before commit or merge.

Prompts must use relative repository paths and contain no secrets.

---

# 10. Create structured-output schemas

Create JSON Schemas compatible with the installed `codex exec --output-schema` behavior.

## Ticket-run result schema

`.codex/schemas/ticket-run-result.schema.json` must require:

```text
ticket_id
ticket_path
status
summary
validator
explorer
worker
changed_files
commands
checks
acceptance_criteria
review
manual_verification_required
next_action
```

Recommended status values:

```text
BLOCKED_VALIDATION
BLOCKED_EXPLORATION
IMPLEMENTATION_FAILED
VERIFICATION_FAILED
REVIEW_BLOCKED
READY_FOR_MANUAL_VERIFICATION
PARTIAL
```

Each acceptance criterion must have:

```text
criterion
status
evidence
```

Criterion status values:

```text
PASS
FAIL
NOT_RUN
MANUAL_REQUIRED
BLOCKED
```

## Review result schema

`.codex/schemas/review-result.schema.json` must require:

```text
ticket_id
result
summary
findings
```

Each finding must include:

```text
severity
title
path
line
explanation
recommended_action
```

Use `null` for a line when exact line information is unavailable.

## Closure result schema

`.codex/schemas/closure-result.schema.json` must require:

```text
ticket_id
result
documentation_files_changed
manual_verification_recorded
application_files_changed
summary
```

The expected successful value of `application_files_changed` is `false`.

Schemas must use `additionalProperties: false` where practical.

---

# 11. Create deterministic local scripts

The scripts must run from any subdirectory by resolving the Git root.

They must use strict shell behavior:

```bash
set -euo pipefail
```

Place shared helpers in `scripts/codex/common.sh`.

Do not require `jq`, Node packages, or Python packages for the base workflow. Python 3 standard library may be used when JSON parsing is necessary, but the shell entry points must provide clear errors when Python is absent.

## `doctor.sh`

Check and report:

- Git repository root;
- working-tree status;
- existence of required planning documents;
- existence of the requested ticket directory;
- `codex` availability and version;
- `codex exec` availability;
- `codex review` availability;
- required project agent files;
- required skill files;
- required schemas;
- project trust/config caveat;
- absence of obvious secret files in the harness;
- shell syntax of all shell scripts;
- JSON validity of all schemas.

Exit nonzero on a blocking failure.

Do not modify files.

## `run-ticket.sh`

Usage:

```bash
./scripts/codex/run-ticket.sh docs/tickets/T0001-project-skeleton.md
```

Behavior:

1. Require exactly one ticket path.
2. Resolve and validate that the ticket is inside the repository.
3. Run `doctor.sh`.
4. Refuse when the ticket is not `Ready`.
5. Create a timestamped directory:

```text
.codex-runs/<ticket-id>/<UTC timestamp>/
```

6. Save:
   - copied ticket path metadata;
   - pre-run `git status --short`;
   - JSONL event stream;
   - final structured result;
   - final human-readable message;
   - post-run `git status --short`;
   - diff summary.
7. Invoke `codex exec` in workspace-write mode.
8. Use the automated ticket prompt and ticket path as context.
9. Use the ticket-run output schema.
10. Use the installed CLI's supported non-interactive approval syntax. New approvals must fail rather than silently escalating.
11. Never pass `danger-full-access`.
12. Propagate Codex's nonzero exit status.
13. Print the run directory and next human action.

A representative command shape is:

```bash
codex exec \
  --sandbox workspace-write \
  --json \
  --output-schema .codex/schemas/ticket-run-result.schema.json \
  --output-last-message "$RUN_DIR/result.json" \
  "Execute the repository ticket-runner workflow for: $TICKET_PATH"
```

Verify exact flags against `codex exec --help` and adapt to the installed CLI rather than blindly copying this example.

## `review-ticket.sh`

Usage:

```bash
./scripts/codex/review-ticket.sh docs/tickets/T0001-project-skeleton.md
```

Behavior:

- Run `doctor.sh`.
- Remain read-only.
- Prefer `codex review` for the actual Git review when its current CLI interface supports the required ticket-specific instructions.
- Otherwise use `codex exec --sandbox read-only` with the independent-review prompt and review schema.
- Save output under `.codex-runs/reviews/<ticket-id>/<timestamp>/`.
- Never modify files.
- Exit nonzero when the review result is `BLOCKED`.

Do not incorrectly combine mutually exclusive `codex review` options. Inspect `codex review --help` first.

## `close-ticket.sh`

Usage:

```bash
./scripts/codex/close-ticket.sh \
  docs/tickets/T0001-project-skeleton.md \
  path/to/manual-verification.md
```

Behavior:

- Require the ticket and a manual-verification record.
- Reject missing or failing verification.
- Save pre-run and post-run Git status.
- Invoke the ticket-closure workflow in workspace-write mode.
- Use the closure schema.
- Verify afterward that only documentation files changed during the closure run.
- Never commit or merge.

## `run-next-ready.sh`

This is a convenience wrapper, not an autonomous merge bot.

Behavior:

1. Read `docs/TICKETS.md`.
2. Identify the first `Ready` ticket with all dependencies `Done`.
3. Print the selected ticket and require one of:
   - `--dry-run`, which only reports;
   - `--execute`, which invokes `run-ticket.sh`.
4. Default to `--dry-run`.
5. Never loop through several tickets.
6. Never select a Draft, Blocked, In progress, Review, Manual verification, or Done ticket.
7. Never create a branch automatically unless the user later explicitly chooses to add that feature.

---

# 12. Add optional GitHub review automation safely

Create a documented **optional** workflow template rather than enabling autonomous implementation by default.

Preferred path:

```text
.github/workflows/codex-review.yml.example
```

The example should:

- use `openai/codex-action@v1`;
- trigger through `workflow_dispatch` or demonstrate a pull-request trigger;
- request read-only repository permissions;
- check out the proposed merge commit with full history;
- use `.codex/prompts/independent-review.md`;
- write the Codex result to an artifact;
- explain that `OPENAI_API_KEY` must be configured as a GitHub secret;
- not apply patches;
- not commit;
- not merge;
- not expose secrets to pull requests from untrusted forks.

Document how to enable it by copying the example to `.github/workflows/codex-review.yml` only after reviewing repository security requirements.

Do not create unattended implementation workflows in the MVP harness.

---

# 13. Create `docs/CODEX_WORKFLOW.md`

This document is the human operating guide.

It must include:

## Prerequisites

- Git.
- Current Codex CLI installed and authenticated.
- Repository marked trusted if project-scoped Codex configuration should load.
- Shell compatible with the scripts.
- Python 3 only if the generated scripts use it.

## One-time setup verification

```bash
./scripts/codex/doctor.sh
```

## Interactive ticket execution

```bash
codex
```

Then:

```text
$ticket-runner

Execute docs/tickets/T0001-project-skeleton.md.
```

## Automated local ticket execution

```bash
./scripts/codex/run-ticket.sh docs/tickets/T0001-project-skeleton.md
```

Explain that this automates the validator, explorer, worker, verifier, and reviewer but stops before human manual verification.

## Independent review

```bash
./scripts/codex/review-ticket.sh docs/tickets/T0001-project-skeleton.md
```

Also document the direct manual command:

```bash
codex review --uncommitted
```

Note that the exact available review modes should be checked through `codex review --help`.

## Manual verification

Provide this reusable record template:

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

Make clear that the human must follow the selected ticket exactly.

## Documentation closure

```bash
./scripts/codex/close-ticket.sh \
  docs/tickets/T0001-project-skeleton.md \
  .codex-runs/manual/T0001.md
```

## Commit and merge

Document commands as a manual step only. Do not put them in the automation scripts.

## Worktrees

Explain that separate worktrees are appropriate only after several sequential tickets have stabilized the process and only when ticket dependencies, interfaces, and files do not overlap.

## Scheduled operation

Document two supported approaches:

1. **ChatGPT desktop scheduled task** using the repository and an isolated worktree. State that the desktop app must be running and the local project available.
2. **Operating-system scheduler** calling `run-next-ready.sh --dry-run` or a deliberately approved `run-ticket.sh` command.

Recommend scheduling read-only review, triage, or dry-run discovery before scheduling write-capable ticket execution.

## Run artifacts

Explain `.codex-runs/` contents and that they are local evidence, not automatically trusted proof. Important accepted evidence should be summarized into ticket documentation rather than committing raw model traces.

## Troubleshooting

Cover:

- project custom agents not loading because repository trust is missing;
- skill not visible until Codex restart;
- unsupported CLI flags;
- non-interactive approval failures;
- dirty working tree;
- ticket blocked by conflicting docs;
- review loops;
- missing manual evidence.

---

# 14. Git ignore and security controls

Update `.gitignore` conservatively to ignore:

```gitignore
.codex-runs/*
!.codex-runs/.gitkeep
.env
.env.*
!.env.example
```

Do not duplicate existing entries unnecessarily.

Inspect for accidental secrets in all newly created files.

Do not place user-specific absolute paths in committed configuration.

Project agent configuration may define sandbox modes, but must not define machine credentials or personal notification hooks.

---

# 15. Validation of the harness

After implementation, perform all of the following without executing T0001:

1. Run `git diff --check`.
2. Run `bash -n` on every shell script.
3. Validate every JSON Schema as parseable JSON.
4. Run `./scripts/codex/doctor.sh`.
5. Confirm every custom read-only agent explicitly uses a read-only sandbox.
6. Confirm `ticket_worker` is the only implementation writer.
7. Confirm `ticket_closer` is documentation-only and used only in a separate closure flow.
8. Confirm `run-ticket.sh` contains no commit, push, merge, reset, or clean command.
9. Confirm no script uses `danger-full-access`.
10. Confirm the default behavior of `run-next-ready.sh` is dry-run.
11. Confirm no application source files changed.
12. Confirm no product dependency was installed.
13. Confirm the T0001 ticket was not executed.
14. Confirm no secrets or user-level Codex configuration were committed.
15. Run a read-only smoke prompt that asks Codex to list the configured project agent roles and repository skills.
16. If feasible without edits, test the runner against a temporary synthetic `Blocked` ticket outside the authoritative ticket index and confirm it stops before spawning a writer. Remove the temporary file afterward.
17. Review the complete diff independently.

Do not claim a check passed unless its command or direct inspection was performed.

---

# 16. Required final report

At the end, return:

## Summary

What harness capabilities were created.

## Files changed

Every created or modified file.

## Codex capabilities detected

- Codex version.
- `codex exec` support.
- custom subagent support.
- skills support.
- `codex review` modes detected.
- any unsupported requested feature.

## Validation

A table of each harness validation and its result.

## Automation commands

Exactly:

```bash
./scripts/codex/doctor.sh
./scripts/codex/run-ticket.sh docs/tickets/T0001-project-skeleton.md
./scripts/codex/review-ticket.sh docs/tickets/T0001-project-skeleton.md
./scripts/codex/close-ticket.sh docs/tickets/T0001-project-skeleton.md PATH_TO_MANUAL_VERIFICATION.md
./scripts/codex/run-next-ready.sh --dry-run
```

## Human actions still required

At minimum:

- review the harness diff;
- decide whether to commit it;
- run T0001 separately;
- perform manual verification;
- commit and merge manually.

## Explicit exclusions

State that:

- T0001 was not implemented;
- no application code was changed;
- no commit or merge occurred;
- no unattended implementation scheduler was enabled.

---

# 17. Acceptance criteria

This bootstrap is complete only when all of these are true:

- Repository-scoped Codex subagents exist for validation, exploration, implementation, review, verification, and closure.
- Validation, exploration, review, and verification roles are read-only.
- The ticket runner cannot start the worker until both read-only analyses finish successfully.
- The ticket runner uses exactly one implementation writer.
- The ticket runner stops before human manual verification.
- The closure workflow requires an explicit human verification record.
- Local non-interactive automation exists through `codex exec`.
- Structured run results and event logs are saved under an ignored directory.
- An independent review command exists.
- The default next-ticket command is dry-run only.
- No automation commits, pushes, merges, or begins a dependent ticket.
- A human-readable operating guide exists.
- The harness passes its deterministic validation checks.
- No application behavior or T0001 implementation was added.

When a requested capability cannot be supported by the installed Codex CLI, document the exact limitation and preserve the safety properties through a manual fallback. Do not fabricate support.