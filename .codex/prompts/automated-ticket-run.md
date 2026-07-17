# Automated ticket run

Invoke the repository `$ticket-runner` skill for the ticket path supplied after
this prompt.

Follow every phase in order. Run the validator and explorer read-only and wait
for both before starting implementation. Stop if either reports `BLOCKED`. Use
exactly one `ticket_worker` as the implementation writer. Preserve complete
factual command evidence, audit acceptance criteria, and obtain a fresh
independent read-only review after implementation.

Every agent must be successfully spawned before it can be described as running
or awaited. Inspect each spawn result and retain its nonempty receiver or agent
ID. If a required spawn fails or returns no ID, use the applicable existing
blocked or failed result status, include blocker code `AGENT_SPAWN_FAILED`, and
stop without edits. Never issue a collaboration wait unless a previously
confirmed spawned agent remains active.

Return a result that conforms to `.codex/schemas/ticket-run-result.schema.json`.
Stop before human manual verification, documentation closure, commit, push, or
merge. Never begin another ticket.
