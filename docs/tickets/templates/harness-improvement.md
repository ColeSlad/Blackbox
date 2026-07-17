# HR-XXXX — Harness Improvement Title

Status: Draft

## Retrospective proposal

- Proposal ID: `HR-XXXX`
- Source ticket: `TXXXX`
- Evidence directory: `.codex-runs/retrospectives/TXXXX/TIMESTAMP/`
- Recommendation category: Regression test / Deterministic check / Ticket clarification / Architecture clarification / Skill update / AGENTS.md update

## Outcome

Describe one durable process improvement and the failure class it prevents.

## Evidence

- Cite the exact run artifact, failed check, review finding, or manual record.
- Explain whether the failure repeated or why it is systemic.
- Separate one-off implementation defects from harness defects.

## Approved scope

- Tests, scripts, `AGENTS.md`, `.codex/`, `.agents/`, ticket templates, or workflow documentation only.
- List exact paths or path prefixes.

## Protected areas

- Product implementation and product requirements.
- Accepted ADR meaning and benchmark ground truth.
- Approval, sandbox, review, testing, and human-verification requirements.
- Unrelated harness behavior.

## Acceptance criteria

- The approved failure class has one deterministic regression or policy check.
- Existing harness checks remain passing.
- No product scope or application file changes.
- An independent read-only review passes.

## Automated verification

- `./scripts/codex/doctor.sh`
- Add proposal-specific commands with expected results.

## Manual verification

1. Inspect the complete harness diff against the approved proposal.
2. Confirm the safety gates are unchanged or stronger.
3. Confirm no product requirement or application behavior changed.

## Exclusions

- Product-ticket implementation.
- Multiple durable recommendations in one run.
- Recurring scheduling.
- Commit, push, or merge.

## Reviewer focus

- Exact match to the approved recommendation.
- One-writer enforcement and allowed-path confinement.
- Regression strength and failure behavior.
- No weakened approval, sandbox, evidence, review, or human gate.

## Human approval

Record approval separately; do not edit retrospective output in place:

```text
Harness improvement approval: Approved
Proposal ID: HR-XXXX
Proposal SHA-256: SHA256_OF_RESULT_JSON
Approved by: NAME
Reason: WHY THIS ONE CHANGE IS APPROVED
```
