# Ticket documentation closure

Invoke the repository `$ticket-close` skill for the ticket and human
manual-verification record supplied after this prompt.

Require complete passing automated evidence, an independent review result, and
an explicit passing human record. Stop when evidence is incomplete or failed.
Use exactly one `ticket_closer` and modify documentation only. Return a result
that conforms to `.codex/schemas/closure-result.schema.json`.

Stop before commit, push, or merge.
