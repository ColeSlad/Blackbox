# ADR 0002 — Codex CLI subprocess boundary

Status: Accepted

Date: 2026-07-17

## Context

Blackbox must run against a locally installed Codex CLI while preserving process
lifecycle, worktree, command, output, and failure evidence. Core domain packages
must not depend on a model provider or an agent framework.

## Decision

- Integrate Codex through a dedicated execution-plane subprocess adapter.
- Prefer the non-interactive `codex exec --json` stream when the installed CLI
  reports that capability.
- Capture the exact invocation, working directory, allowed environment, process
  identifier, standard streams, JSONL events, exit status, cancellation result,
  and CLI version as factual evidence.
- Treat JSONL as an external versioned protocol. Validate and normalize supported
  events at the adapter boundary, retain unknown events as raw evidence, and fail
  safely when a required event cannot be interpreted.
- Detect capabilities at runtime rather than assuming every installed Codex
  version exposes identical flags or event fields.
- Keep model-provider concepts and Codex-specific event types outside the domain
  and application layers.
- Do not embed an agent framework or call a model-provider SDK in the MVP.

## Consequences

- Blackbox can observe and cancel the real local process without coupling domain
  logic to Codex internals.
- CLI upgrades may require adapter compatibility work and recorded fixtures.
- Raw and normalized event retention must follow security, redaction, and
  artifact-retention policy.
- A process exit code alone is evidence, not proof of successful orchestration;
  supported terminal state and validation evidence remain required.

## Alternatives considered

- Direct model-provider API integration: rejected because it bypasses the local
  Codex execution and approval boundary Blackbox is intended to observe.
- Embedding an agent framework: rejected because it would couple orchestration
  policy and domain state to a third-party runtime.
- Treating human-readable terminal output as the primary protocol: rejected
  because it is less deterministic than the supported JSONL event stream.

## Deferred questions

- Exact event normalization and compatibility fixtures belong to T0012.
- Process sandboxing, resource limits, and cancellation semantics belong to the
  instrumented runner and security tickets.
- Reasoning-message retention remains disabled unless a later approved privacy
  decision defines a safe need and retention policy.
