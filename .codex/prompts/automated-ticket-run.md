# Automated ticket run

Invoke the repository `$ticket-runner` skill for the ticket path supplied after
this prompt.

Follow every phase in order. Run the validator and explorer read-only and wait
for both before starting implementation. Stop if either reports `BLOCKED`. Use
exactly one `ticket_worker` as the implementation writer. Preserve complete
factual command evidence, audit acceptance criteria, and obtain a fresh
independent read-only review after implementation.

Return a result that conforms to `.codex/schemas/ticket-run-result.schema.json`.
Stop before human manual verification, documentation closure, commit, push, or
merge. Never begin another ticket.
