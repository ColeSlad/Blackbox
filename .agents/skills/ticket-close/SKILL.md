---
name: ticket-close
description: Close one accepted ticket through documentation-only updates after explicit human manual-verification evidence is provided.
---

# Ticket Close

Require all of the following from the user:

- the ticket path;
- the final automated-review result;
- an explicit human manual-verification record.

Then:

1. Read `AGENTS.md`, the ticket, the evidence report, and the manual record.
2. Spawn `verification_auditor` read-only to confirm the automated evidence,
   independent review, and human record are complete and passing.
3. Stop without edits when evidence is missing, failed, or contradictory.
4. Spawn exactly one `ticket_closer` as the only writer in this closure run.
5. Permit changes only to `docs/STATUS.md`, `docs/TICKETS.md`, the selected ticket
   file, and `docs/completed-tickets/`.
6. Inspect the resulting diff and fail closure if any application or harness file
   changed.
7. Report the documentation changes and stop before commit or merge.
