---
name: ticket-runner
description: Execute one Ready repository ticket with read-only validation and exploration, exactly one implementation writer, independent review, and an evidence report. Stop before human verification, commit, or merge.
---

# Ticket Runner

Accept one ticket path from the user prompt and execute only that ticket. Add
this workflow to the active plan before starting.

## Phase A — establish state

1. Read the root and applicable nested `AGENTS.md` files.
2. Read the ticket completely.
3. Read the authoritative product, architecture, ADR, status, index, and
   verification documents relevant to the ticket.
4. Capture `git status --short` and preserve unrelated changes.
5. Refuse to proceed when:
   - the ticket path is missing or outside the repository;
   - the individual ticket status is not `Ready`;
   - any dependency is not `Done`;
   - unrelated changes cannot be safely preserved;
   - repository guidance conflicts materially.

## Phase B — parallel read-only gate

1. Spawn `plan_validator` and `project_explorer` as read-only agents. Inspect
   both spawn results and record each nonempty receiver or agent ID.
2. If either spawn fails or returns no nonempty receiver or agent ID, use the
   applicable schema-supported blocked status, include blocker code
   `AGENT_SPAWN_FAILED`, and stop without waiting or editing.
3. Allow confirmed agents to run concurrently and wait for both results. Never
   call `wait` unless at least one confirmed spawned agent remains active, and
   never claim an agent is running unless its spawn result was confirmed.
4. Do not start a writing agent while either read-only agent is running.
5. Treat the run as blocked when either result is `BLOCKED`, including when the
   other result is `GO`.
6. On a blocker, return a consolidated blocker report and stop without edits.

## Phase C — implementation

Use only the backend named by the invocation. Never select or infer a different
backend, and never run both backends.

### CODEX backend

1. Spawn exactly one `ticket_worker`. Confirm its spawn result contains a
   nonempty receiver or agent ID; otherwise return `IMPLEMENTATION_FAILED` with
   blocker code `AGENT_SPAWN_FAILED` and stop.
2. Give it the ticket, both read-only results, and explicit allowed and protected
   scope.
3. Wait for the worker to finish only after its receiver ID is confirmed.
4. Do not invoke the Hermes wrapper or spawn another implementation writer.

### HERMES backend

The harness mechanically separates this backend into six non-overlapping
execution phases: gate, writer, shell verification, evidence inspection, audit,
and review. No Codex process is alive while Hermes writes.

1. `HERMES_READ_ONLY_GATES`: spawn only `plan_validator` and
   `project_explorer`, then return the bounded gate result. Do not spawn a
   writer, edit files, or invoke Hermes.
2. The shell harness validates exactly one schema-conforming result with worker
   backend `HERMES`, validator `GO`, explorer `GO`, no blockers, worker
   `NOT_RUN`, no changed files, review `NOT_RUN`, and status
   `READY_FOR_IMPLEMENTATION`. It writes the ignored gate contract and invokes
   `scripts/codex/run-hermes-worker.sh` exactly once as the sole writer.
   Before the gate starts, it freezes every selected ticket-check executable in
   a private bound map; no agent receives the caller's PATH. If Hermes changes a
   mapped target, stop before any check or post phase.
   File-based OAuth is optional and direct-run-only: it requires the exact pair
   `--hermes-auth-source user-hermes --hermes-auth-provider openai-codex`.
   Never infer either selector, accept a partial pair, add them to autopilot, or
   substitute another source or provider. The unchanged provider-environment
   path remains available when neither selector is present.
3. The capability probe runs first with no provider environment, auth file, user
   configuration, source path in its arguments or environment, or network. Its
   controller proves the held home contains only its empty temporary directory
   immediately before launch; OS runtime directories created after process start
   do not authorize auth or user configuration.
   Seatbelt profile explicitly denies reads and writes of the selected host auth
   source. The controller sends that profile through standard input, closes the
   pipe before consuming output, and requires the Hermes target to inherit EOF
   with no nonstandard profile descriptor. Only after capability success may the shell-owned controller
   descriptor-walk and validate the current user's supported Hermes v0.19 auth
   store, copy only the `openai-codex` record into a new mode-0600 file in the
   held ephemeral home, and close the source. The writer may refresh only that
   ephemeral copy; it receives no provider environment values on this path and
   remains denied host-source reads and writes. Missing, malformed, or unsafe
   post-run auth blocks after original and discoverable refreshed values are
   scrubbed from bounded output and the worktree.
4. The shell-owned controller copies the frozen implementation state into a
   disposable, isolated Git mirror, runs every literal ticket check there, and
   retains bounded command output plus exact exit evidence. Then
   `HERMES_READ_ONLY_VERIFICATION` uses a fresh read-only Codex process only to
   inspect that controller-owned evidence. It must not rerun a ticket command.
   Return `PARTIAL`; do not audit, review, edit, or start a writer.
5. `HERMES_READ_ONLY_AUDIT`: use a second fresh read-only Codex process as the
   verification auditor. Bind it to the validated verification-result digest,
   require every exact ticket criterion to pass, and return `PARTIAL` without
   review or manual-gate authority.
6. `HERMES_READ_ONLY_REVIEW`: use a third fresh read-only Codex process as the
   independent reviewer. Bind it to validated verification and audit digests.
   Only exact `PASS` with no findings may request manual verification.
7. The shell-owned controller validates phase PIDs, immutable repository and
   Git metadata before and after every read-only phase, exact cross-phase
   evidence, actual changed paths, all required passing checks, accepted audit,
   passing review, and the human gate. Exit zero alone is never sufficient.
   It reads ticket status, dependencies, acceptance criteria, and literal check
   commands before the writer starts; neither Hermes nor a later Codex phase may
   change those inputs or prior phase evidence. The verification mirror must
   match the frozen HEAD, index, staged diff, unstaged diff, status, and content
   manifest, must use Git metadata wholly inside the mirror, and must be
   destroyed before its evidence can pass. Each read-only Codex process is
   directly supervised with only its precreated result file writable and no
   provider credentials in its environment.
8. If any gate, parser, capability probe, auth-source validation, containment,
   Hermes execution, check, or review fails, stop without a Codex writer, a
   second Hermes process, or a fallback implementation path.

## Phase D — automated verification

For the HERMES backend, Phase C's shell-owned disposable-mirror verification is
authoritative; no agent reruns its commands. For the CODEX backend:

1. Inspect the complete diff and confirm only intentional files changed.
2. Run every mandatory ticket check and preserve complete command output.
3. Spawn `verification_auditor` to map actual evidence to every acceptance
   criterion.
4. Leave browser and other human steps as `MANUAL_REQUIRED`; do not simulate or
   claim them.

## Phase E — independent review

1. Spawn a fresh `ticket_reviewer` with the ticket and current diff.
2. Do not present the worker's self-assessment as review evidence.
3. If the reviewer returns `BLOCKED`, evaluate each finding against the ticket.
   For the CODEX backend, send only accepted findings to the same
   `ticket_worker` for one focused repair cycle. For the HERMES backend, stop
   with `REVIEW_BLOCKED`; this initial integration never starts a repair writer.
4. Rerun affected checks and the verification audit.
5. Spawn one fresh `ticket_reviewer` after repairs.
6. If significant blockers persist, stop with `REVIEW_BLOCKED` or `PARTIAL`.
   Do not create an endless review loop.

## Phase F — report and stop

Return:

- ticket ID, title, and path;
- result status;
- validator and explorer results;
- worker summary;
- worker backend, exactly `CODEX` or `HERMES`;
- changed files;
- commands and check results;
- an acceptance-criteria table with evidence;
- reviewer result, findings, and dispositions;
- unresolved risks;
- exact human manual-verification steps still required;
- the next human action;
- an explicit statement that no commit or merge occurred.

Stop after the evidence report. Do not close documentation, mark the ticket
`Done`, begin a dependent ticket, commit, push, or merge.
