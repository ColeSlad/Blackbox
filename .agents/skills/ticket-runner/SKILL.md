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

1. Spawn exactly one `ticket_worker`. Confirm its spawn result contains a
   nonempty receiver or agent ID; otherwise return `IMPLEMENTATION_FAILED` with
   blocker code `AGENT_SPAWN_FAILED` and stop.
2. Give it the ticket, both read-only results, and explicit allowed and protected
   scope.
3. Wait for the worker to finish only after its receiver ID is confirmed.
4. Do not spawn another implementation writer.

## Phase D — automated verification

1. Inspect the complete diff and confirm only intentional files changed.
2. Run every mandatory ticket check and preserve complete command output.
3. Spawn `verification_auditor` to map actual evidence to every acceptance
   criterion.
4. Leave browser and other human steps as `MANUAL_REQUIRED`; do not simulate or
   claim them.

## Phase E — independent review

1. Spawn a fresh `ticket_reviewer` with the ticket and current diff.
2. Do not present the worker's self-assessment as review evidence.
3. If the reviewer returns `BLOCKED`, evaluate each finding against the ticket
   and send only accepted findings to the same `ticket_worker` for one focused
   repair cycle.
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
