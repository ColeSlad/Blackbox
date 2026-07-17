---
name: harness-improve
description: Apply one explicitly approved retrospective proposal with exactly one harness writer, deterministic validation, and independent read-only review, stopping before commit or merge.
---

# Harness Improve

Require one structured retrospective proposal and a separate explicit human
approval record naming the same proposal ID and SHA-256 digest.

## Preflight

1. Read `AGENTS.md`, the proposal, approval record, cited evidence, and relevant
   harness files.
2. Confirm the proposal is still `PENDING`, its digest matches the approval,
   recommends exactly one change, sets product-scope change to `false`, and
   names only permitted harness paths.
3. Run `scripts/codex/doctor.sh` and deterministic policy validation before any
   writer starts. Stop without edits when validation or approval is missing,
   failed, contradictory, or stale.
4. Capture the complete pre-run repository manifest.

## Improvement

1. Spawn exactly one `harness_improver` as the only writer. Confirm the spawn
   returned an active receiver before waiting; if it fails, stop as blocked
   without calling a receiver-less wait.
2. Apply only the approved recommendation. Do not start `ticket_worker`,
   `ticket_closer`, another improver, or any other writer.
3. Permit changes only to tests, scripts, `AGENTS.md`, `.codex/`, `.agents/`,
   `docs/tickets/templates/`, and `docs/CODEX_WORKFLOW.md`, unless an explicit
   harness ticket grants a narrower additional path.
4. Reject any change to product code, product requirements, approval policy,
   sandbox protections, independent review, testing, or human verification.

## Verification and review

1. Inspect the complete diff and compare it with the approved paths.
2. Run every proposal-specific check plus `scripts/codex/doctor.sh`.
3. Start a fresh `ticket_reviewer` read-only with the proposal, approval, and
   complete harness diff. Treat it as an independent harness review. Confirm an
   active reviewer receiver exists before waiting, otherwise stop as blocked.
4. If review blocks, return accepted findings to the same `harness_improver` for
   at most one focused repair cycle, rerun affected checks, and obtain one fresh
   read-only review. Never start a second writer.
5. Stop as blocked or partial if significant findings remain.

## Report and stop

Return the proposal ID, exactly-one-writer confirmation, changed files, command
evidence, checks, independent review, remaining risks, and next human action.
Stop before staging, commit, push, merge, product-ticket execution, or recurring
scheduling.
