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

## Project planning

- Use `$project-plan` for product-ticket creation. The `project_planner` remains
  read-only; the invoking planning session is the sole writer when Draft files
  are materialized.
- Propose exactly three dependency-ordered tickets with complete scope,
  acceptance, automated checks, manual verification, exclusions, and reviewer
  focus.
- Create every proposal as `Draft`. Run a separate read-only `plan_validator`
  pass, then require explicit human review before changing any ticket to
  `Ready`.
- Planning never starts `ticket_worker` or modifies application code.

## One-ticket autopilot

- `scripts/codex/autopilot.sh` selects at most one `Ready` ticket whose
  dependencies are `Done`.
- Write-capable autopilot must start from a clean `main` branch and create a
  dedicated branch and worktree.
- Autopilot invokes the existing ticket runner exactly once and stops before
  manual verification, documentation closure, staging, commit, push, merge, or
  worktree cleanup.
- Do not enable recurring or recursive autopilot scheduling.

## Harness refinement

- Use `$harness-retrospective` read-only to analyze named run evidence and an
  optional manual record. It may emit at most one pending proposal and may not
  change product scope.
- Distinguish one-off implementation defects from repeated or systemic harness
  failures. Prefer durable improvements in this order: regression test,
  deterministic check, ticket clarification, architecture clarification, skill
  update, then `AGENTS.md` update.
- A human must approve the exact proposal in a separate record before
  `$harness-improve` may run.
- `harness_improver` is the only writer in an improvement run. Its default scope
  is tests, scripts, `AGENTS.md`, `.codex/`, `.agents/`, ticket templates, and
  workflow documentation.
- Harness improvements never weaken approval, sandbox, testing, review,
  evidence, or human-verification gates, rewrite product requirements to pass,
  implement a product ticket, commit, push, or merge.
- Run deterministic policy validation and a fresh independent read-only review
  for every improvement. Reuse the same improver for at most one focused repair;
  never start a second writer.

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
- `project_planner`: read-only product-increment and Draft-ticket proposer.
- `harness_retrospective`: read-only run-evidence and systemic-failure analyst.
- `harness_improver`: the only writer for one separately approved harness
  proposal.

Never run `ticket_worker` and `ticket_closer` concurrently. Never use a second
implementation writer for repairs; return accepted findings to the same worker
for at most one focused repair cycle.

Never run any two writer roles concurrently. A planning session, ticket run,
closure, or harness-improvement run owns exactly one writer boundary.

## Durable learning

When the same failure occurs twice, propose a durable repository-level control:
a test, ticket-template improvement, architecture rule, `AGENTS.md` rule, skill,
or deterministic script. Do not grow prompts indefinitely when a mechanical
control can prevent recurrence.

See `docs/CODEX_WORKFLOW.md` for commands, evidence locations, manual
verification, closure, and troubleshooting.
