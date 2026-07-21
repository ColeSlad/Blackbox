# Automated ticket run

Invoke the repository `$ticket-runner` skill for the ticket path and phase
supplied after this prompt. Obey the phase exactly; never continue into another
phase yourself.

`CODEX_FULL` runs the complete Codex workflow: read-only gates, exactly one
`ticket_worker`, automated verification, audit, and independent review.

`HERMES_READ_ONLY_GATES` runs only the read-only validator and explorer gates.
Do not spawn `ticket_worker`, edit files, run an implementation command, invoke
Hermes, or perform post-implementation checks. Return
`READY_FOR_IMPLEMENTATION` only when both gates are exactly `GO` with no
blockers. In that result, record worker backend `HERMES`, worker result
`NOT_RUN`, no changed files, and review result `NOT_RUN`. A shell-owned workflow
validates this result and decides whether to start the Hermes writer after this
Codex process exits.

The optional Hermes file-auth handoff is also shell-owned. Read-only agents must
not inspect, request, describe, or reproduce its host source or credential
content. The capability probe and every Codex phase remain credential-free; only
the one contained writer may receive the controller-created provider-only
ephemeral copy after the probe succeeds. Auth-source failure stops before the
writer and cannot authorize a fallback.

Before `HERMES_READ_ONLY_VERIFICATION`, the shell-owned controller executes the
literal mapped checks in a disposable isolated-Git mirror bound to the frozen
implementation state. `HERMES_READ_ONLY_VERIFICATION` is a fresh process that
only inspects that controller-owned command evidence. It must not rerun a ticket
command. It returns `PARTIAL`, performs no acceptance audit or review, never
opens the manual gate, and never edits or starts a writer.

`HERMES_READ_ONLY_AUDIT` is a separate fresh process acting only as the
verification auditor. It consumes the controller-bound verification result,
maps every exact ticket acceptance criterion to retained evidence, returns
`PARTIAL`, performs no review, never opens the manual gate, and never edits or
starts a writer.

`HERMES_READ_ONLY_REVIEW` is a third fresh process acting only as the independent
reviewer. It consumes the controller-bound verification and audit results and
inspects the complete diff. Only a strict `PASS` with no findings may return
`READY_FOR_MANUAL_VERIFICATION` with the human gate required. Any finding must
block. Do not spawn, message, follow up, or repair with `ticket_worker`; do not
invoke Hermes; and do not edit files.

The shell-owned controller validates every post-process result, retained event
evidence, exact ticket identity and criteria, actual Git file manifest, bound
shell-command outcomes, process separation, audit acceptance, review result,
and manual gate. A schema-valid assertion or zero process exit is never
sufficient by itself. Treat the ticket, its status, dependencies, acceptance
criteria, automated-check commands, harness prompts and configuration, product
authorities, ADRs, and all prior phase evidence as immutable. For verification,
inspect the already-executed literal ticket commands and cite only the
controller-designated shell evidence paths. Do not expect provider credentials
in any read-only Codex phase.

Every agent must be successfully spawned before it can be described as running
or awaited. Inspect each spawn result and retain its nonempty receiver or agent
ID. If a required spawn fails or returns no ID, use the applicable existing
blocked or failed result status, include blocker code `AGENT_SPAWN_FAILED`, and
stop without edits. Never issue a collaboration wait unless a previously
confirmed spawned agent remains active.

Return a result that conforms to `.codex/schemas/ticket-run-result.schema.json`.
Record the selected backend as exactly `CODEX` or `HERMES` in `worker.backend`.
Stop before human manual verification, documentation closure, commit, push, or
merge. Never begin another ticket.
