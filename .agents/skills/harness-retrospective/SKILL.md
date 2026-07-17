---
name: harness-retrospective
description: Analyze one ticket run's evidence and optional manual verification read-only, distinguish implementation defects from harness defects, and produce at most one pending durable-improvement proposal.
---

# Harness Retrospective

## Inputs

Require:

- one ticket ID;
- one run-evidence directory below `.codex-runs/`;
- an optional manual-verification record.

## Workflow

1. Read this skill, capture repository status, and remain read-only.
2. As the first workflow action, spawn exactly one `harness_retrospective`
   read-only. Give it the matching ticket, supplied run artifacts, automated
   outputs, review findings, optional manual record, and `AGENTS.md`; let that
   agent own the evidence audit rather than duplicating it in the parent.
3. Confirm the spawn returned an active receiver before waiting. If spawning is
   unavailable or fails, return insufficient evidence immediately; never wait
   with no agent.
4. Distinguish isolated implementation defects from repeated or systemic
   workflow defects using cited evidence. Do not infer repetition from one
   occurrence alone.
5. Return either no recommendation or one highest-value durable recommendation.
6. Apply this preference order: regression test, deterministic check, ticket
   clarification, architecture clarification, skill update, `AGENTS.md` update.
7. Set proposal approval to `PENDING` and product-scope change to `false`.
8. Store the structured result under `.codex-runs/retrospectives/` when invoked
   by the repository script.

Do not edit files, approve or apply a recommendation, reinterpret product scope,
start a writer, commit, push, or merge.
