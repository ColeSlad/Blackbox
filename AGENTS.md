# Project Instructions

## Project purpose

Blackbox is a transactional runtime and causal debugger for parallel coding-agent
fleets. Favor explicit state, verifiable behavior, causal evidence, narrow
boundaries, and reversible changes.

## Authoritative documents

Read the applicable sources before changing the repository:

1. The selected file under `docs/tickets/` is authoritative for that ticket's
   status, scope, dependencies, acceptance criteria, checks, and manual steps.
2. Accepted ADRs and `docs/ARCHITECTURE.md` define architectural boundaries.
3. `docs/PRODUCT.md` defines product intent and MVP scope.
4. `docs/TICKETS.md` is the ticket index, dependency map, and milestone summary;
   it is not a duplicate ticket specification.
5. `docs/STATUS.md` records factual repository state.
6. `docs/VERIFICATION.md` defines general verification policy.

Stop and report unresolved conflicts between authoritative sources. Do not choose
a convenient interpretation.

## Ticket workflow

- Work only on a ticket whose individual file is `Ready`.
- Confirm every dependency is `Done` before implementation.
- Run `plan_validator` and `project_explorer` read-only, allow them to run in
  parallel, and wait for both.
- Stop before editing if either read-only gate reports `BLOCKED`.
- Use exactly one `ticket_worker` as the implementation writer.
- Run every ticket-specific automated check and retain factual evidence.
- Use `verification_auditor` to map actual evidence to acceptance criteria.
- Start a fresh `ticket_reviewer` after implementation and verification.
- Stop for human manual verification after the evidence report.
- Never mark a ticket `Done`, commit, push, or merge unless a human explicitly
  requests that separate action.

## Change discipline

- Stay within the selected ticket's allowed scope and protected-area rules.
- Preserve unrelated working-tree changes.
- Prefer the smallest complete change and avoid speculative abstractions.
- Add dependencies only after the ticket records the evaluation required by the
  architecture dependency policy.
- Add a regression test when fixing a reproducible defect when practical.
- Update factual documentation when accepted behavior changes.
- Report commands and results honestly; a skipped or unavailable check is not a
  passing check.
- Distinguish automated evidence from human manual verification.

## Agent delegation

- `plan_validator`: read-only prerequisite and ticket-consistency gate.
- `project_explorer`: read-only implementation map, risk scan, and verification
  plan.
- `ticket_worker`: the only writer during an implementation run.
- `verification_auditor`: read-only comparison of evidence to acceptance
  criteria.
- `ticket_reviewer`: fresh, independent, read-only review of the completed diff.
- `ticket_closer`: the only writer in a later documentation-only closure run,
  after explicit human verification evidence.

Never run `ticket_worker` and `ticket_closer` concurrently. Never use a second
implementation writer for repairs; return accepted findings to the same worker
for at most one focused repair cycle.

## Durable learning

When the same failure occurs twice, propose a durable repository-level control:
a test, ticket-template improvement, architecture rule, `AGENTS.md` rule, skill,
or deterministic script. Do not grow prompts indefinitely when a mechanical
control can prevent recurrence.

See `docs/CODEX_WORKFLOW.md` for commands, evidence locations, manual
verification, closure, and troubleshooting.
