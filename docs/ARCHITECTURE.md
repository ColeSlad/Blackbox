# Architecture

## System overview

Blackbox is a local-first control plane placed between a multi-agent orchestrator and a Git repository. It gives each writing agent an isolated worktree, records declared intent and observed behavior, stages resulting patches, validates their combined effects, and produces causal diagnostics when a run fails.

The system is divided into a control plane, an execution plane, and an analysis plane:

- The **control plane** owns runs, tickets, agents, intent contracts, admission decisions, transaction state, and merge eligibility.
- The **execution plane** launches or wraps Codex processes in isolated worktrees and captures commands, filesystem activity, Git changes, and validation results.
- The **analysis plane** derives conflicts, dependency edges, replay bundles, failure slices, and candidate guardrails from the append-only execution ledger.

The initial deployment is a single local application composed of a server process, worker processes, a PostgreSQL database, repository worktrees, and a web client. Logical component boundaries must remain explicit even if multiple components are initially packaged together.

## Approved implementation platform

The initial MVP uses Node.js 24 LTS, strict TypeScript with ECMAScript modules,
and a pnpm monorepo. Fastify is restricted to the HTTP adapter, while React and
Vite are restricted to the browser package. Server, worker, CLI, domain,
contract, shared-configuration, and fixture boundaries remain separate workspace
packages. Root pnpm scripts coordinate the workspace without an additional task
orchestration framework.

Codex integration uses a dedicated execution-plane subprocess adapter around the
installed CLI. The adapter prefers `codex exec --json`, records raw process and
event evidence, performs runtime capability detection, and normalizes supported
events without leaking Codex-specific types into the domain layer.

See accepted [ADR 0001](decisions/0001-typescript-pnpm-monorepo.md) and
[ADR 0002](decisions/0002-codex-cli-subprocess-boundary.md).

## Components

### Command-line interface

Responsibilities:

- Initialize Blackbox configuration in a repository.
- Create, inspect, start, stop, replay, and export runs.
- Register tickets and agent assignments.
- Print machine-readable and human-readable command results.
- Provide non-interactive operation suitable for scripts and CI.

Must not:

- Contain orchestration business logic.
- Read or mutate persistence directly.
- Infer success from process exit status alone when server state is available.

### Web application

Responsibilities:

- Display runs, tickets, agent status, intents, timelines, conflicts, validations, and failure reports.
- Link every diagnostic claim to supporting ledger events.
- Allow users to approve, reject, or downgrade candidate guardrails.
- Provide filters by run, agent, ticket, resource, event type, and time.

Must not:

- Execute shell commands directly.
- Apply Git patches directly.
- Recompute authoritative analysis in the browser.

### API server

Responsibilities:

- Expose authenticated local APIs used by the CLI and web application.
- Validate commands and schemas at system boundaries.
- Coordinate application services and transactions.
- Enforce state-machine transitions and authorization rules.
- Publish durable domain events through an outbox.

Must not:

- Launch untrusted agent commands in the server process.
- Treat client-provided derived fields as authoritative.
- Depend on UI-specific concepts.

### Run coordinator

Responsibilities:

- Create and advance runs through their lifecycle.
- Resolve ticket dependencies and eligible parallel work.
- Assign one writing agent to each active ticket.
- Request intent contracts before execution.
- Coordinate admission, execution, prepare, validation, commit eligibility, and completion.
- Cancel or pause dependent work when an upstream transaction invalidates it.

Must not:

- Perform Git operations directly.
- Decide semantic conflicts solely through an LLM response.
- Mark a ticket Done without verification evidence.

### Intent registry

Responsibilities:

- Store versioned agent intent contracts.
- Validate required fields and supported resource selectors.
- Compare declared intent with observed behavior.
- Track assumptions and the resource versions on which they depend.
- Preserve every revision rather than overwriting history.

Must not:

- Treat an agent declaration as proof that an effect is safe.
- Mutate historical intent versions.

### Admission and conflict engine

Responsibilities:

- Detect deterministic conflicts before and during execution.
- Evaluate write overlap, stale bases, resource reservations, dependency ordering, and policy constraints.
- Classify outcomes as allow, warn, wait, approval-required, or block.
- Persist the rule, evidence, and explanation for every decision.
- Support pluggable conflict detectors behind a stable interface.

Must not:

- Block on untraceable model intuition.
- Modify agent worktrees.
- Conflate a warning with a verified conflict.

### Agent runner

Responsibilities:

- Launch or wrap Codex in a dedicated worker process.
- Enforce the assigned worktree and transaction identifier.
- Capture process lifecycle, standard streams, command metadata, and exit status.
- Apply resource, timeout, and cancellation limits.
- Emit normalized execution events to the ledger ingestion boundary.

Must not:

- Run inside the API server process.
- Access another agent's worktree unless explicitly performing a read-only comparison.
- Write directly to the canonical branch.

### Worktree manager

Responsibilities:

- Create isolated Git worktrees from a recorded base commit.
- Verify worktree cleanliness before assignment.
- Compute patches, changed paths, changed symbols, and base divergence.
- Apply approved patches to a staging branch or integration worktree.
- Clean up abandoned worktrees according to retention policy.

Must not:

- Decide whether a patch is semantically valid.
- Delete a worktree that is referenced by an active or retained replay bundle.

### Execution instrumentation

Responsibilities:

- Capture shell commands and results through a controlled command wrapper.
- Capture Git state before and after relevant operations.
- Capture file writes and, where practical, file reads relevant to declared assumptions.
- Normalize events into the execution-ledger schema.
- Associate every observed effect with a run, ticket, agent, and transaction.

Must not:

- Depend on terminal output parsing when a structured source exists.
- claim complete observability for operations outside instrumented boundaries.
- Store secrets without applying configured redaction rules.

### Validation service

Responsibilities:

- Resolve repository-defined validation commands.
- Run ticket-level checks in the agent worktree.
- Run cross-agent checks in an integration worktree.
- Record command, environment fingerprint, inputs, outputs, duration, and result.
- Map acceptance criteria to verification evidence.

Must not:

- Suppress failing output.
- Mark a validation as passing when it was skipped or unavailable.
- Execute arbitrary validation definitions received from an untrusted remote source without policy review.

### Transaction and effect manager

Responsibilities:

- Model the lifecycle of each agent change as a transaction.
- Keep agent changes isolated until prepare and validation succeed.
- Track staged, reversible, committed, rejected, and compensated effects.
- Use idempotency keys for internal effect requests.
- Enforce commit-time revalidation of base versions, intent assumptions, and authority.

Must not:

- Claim ACID guarantees for systems not controlled by Blackbox.
- Commit a patch when the relevant transaction is not in an eligible state.
- perform irreversible external actions in the MVP.

### Execution ledger

Responsibilities:

- Store immutable, ordered events describing all recorded execution behavior.
- Deduplicate retried event submissions.
- Preserve causal correlation identifiers and parent-child relationships.
- Serve as the source of truth for timelines, replay, and diagnosis.
- Support export with schema and application version metadata.

Must not:

- Update or delete historical events through normal application flows.
- Store derived diagnostic conclusions as if they were raw events.

### Projection service

Responsibilities:

- Build query-optimized projections from ledger events.
- Maintain current run, ticket, agent, transaction, validation, and conflict state.
- Rebuild projections from the ledger.
- Detect projector version drift and require rebuild when semantics change.

Must not:

- Become the only copy of information required for replay or audit.
- accept client-side mutations.

### Causal graph builder

Responsibilities:

- Convert ledger events and intent data into typed execution nodes and edges.
- Link observations, resource versions, assumptions, decisions, commands, mutations, validations, and outcomes.
- Assign evidence and confidence to inferred edges.
- Preserve alternative causal hypotheses when evidence is ambiguous.

Must not:

- Modify source ledger events.
- Represent low-confidence inferred edges as deterministic facts.

### Failure analyzer

Responsibilities:

- Start from a failed outcome and compute a backward dependency slice.
- Identify candidate earliest decisive events.
- Distinguish root, enabling, propagation, and detection events.
- Support deterministic analyzers and optional model-assisted analyzers.
- Produce a structured report with claims, evidence, confidence, and alternatives.

Must not:

- Assign blame to a person.
- present model-generated attribution without supporting recorded evidence.
- Hide analysis limitations or missing instrumentation.

### Replay service

Responsibilities:

- Create a portable replay bundle containing repository state, configuration, recorded inputs, and validation definitions.
- Restore an isolated repository and execute supported recorded steps.
- Compare replay state and outcomes with the original run.
- Record fidelity differences and nondeterministic boundaries.

Must not:

- Call uncontrolled external systems during deterministic replay.
- Describe a replay as exact when model generation or dependencies were not captured.
- overwrite original run data.

### Guardrail service

Responsibilities:

- Represent runtime policies in a versioned, reviewable rule format.
- Generate candidate rules from supported failure templates and diagnostic evidence.
- Evaluate candidates against failing and successful replay scenarios.
- Report prevented failures, false positives, performance cost, and unsupported cases.
- Require explicit approval before activation in the MVP.

Must not:

- Activate generated semantic policies automatically.
- mutate historical rule versions.
- claim that passing recorded scenarios proves general safety.

### Worker queue

Responsibilities:

- Schedule long-running agent, validation, replay, projection, and analysis jobs.
- Provide leases, heartbeats, retries, cancellation, and dead-letter handling.
- Enforce idempotent job handlers.
- Make job state observable through the API.

Must not:

- Store authoritative domain state only in queue metadata.
- retry non-idempotent operations without an explicit policy.

## Data model

The source of truth consists of immutable ledger events plus versioned command-side records needed to enforce transitions.

### Run

Represents one coordinated multi-agent objective.

Key fields:

- `id`
- `repository_id`
- `title`
- `base_commit_sha`
- `status`
- `configuration_version`
- `created_at`
- `started_at`
- `completed_at`

### Ticket

Represents one independently verifiable unit of work.

Key fields:

- `id`
- `run_id`
- `external_key`
- `title`
- `description`
- `status`
- `dependencies`
- `acceptance_criteria`
- `manual_verification_steps`

### Agent assignment

Associates one writing agent with one ticket for a bounded interval.

Key fields:

- `id`
- `run_id`
- `ticket_id`
- `agent_id`
- `worktree_id`
- `status`
- `assigned_at`
- `released_at`

### Intent contract

A versioned declaration of expected work.

Key fields:

- `id`
- `assignment_id`
- `version`
- `goal`
- `reads`
- `writes`
- `assumptions`
- `public_contract_changes`
- `required_validations`
- `declared_effects`
- `created_at`

### Resource reference

A canonical selector used in intents and conflicts.

Initial resource kinds:

- Repository
- Commit
- Path
- Symbol
- Database migration identifier
- API contract
- Validation definition

### Transaction

Represents an agent's isolated set of proposed effects.

Statuses:

- `declared`
- `admitted`
- `running`
- `prepared`
- `validating`
- `eligible`
- `committed`
- `rejected`
- `cancelled`
- `compensating`
- `compensated`
- `failed`

### Ledger event

An immutable observed or declared fact.

Required envelope fields:

- `event_id`
- `event_type`
- `schema_version`
- `occurred_at`
- `recorded_at`
- `run_id`
- `ticket_id`
- `assignment_id`
- `transaction_id`
- `correlation_id`
- `causation_id`
- `sequence`
- `producer`
- `payload`
- `payload_hash`

Initial event families:

- Run lifecycle
- Ticket lifecycle
- Agent lifecycle
- Intent submitted or revised
- Admission decision
- Command started or completed
- File observed or mutated
- Git state captured
- Patch prepared
- Validation started or completed
- Conflict detected or resolved
- Transaction state changed
- Replay state changed
- Diagnostic generated
- Guardrail evaluated or activated

### Validation result

Records one execution of one validation definition.

Key fields:

- `id`
- `transaction_id` or `run_id`
- `definition_version`
- `scope`
- `command`
- `environment_fingerprint`
- `status`
- `exit_code`
- `output_artifact`
- `started_at`
- `completed_at`

### Conflict

Represents a detected incompatibility or risk.

Key fields:

- `id`
- `detector_id`
- `detector_version`
- `classification`
- `severity`
- `decision`
- `involved_transactions`
- `involved_resources`
- `evidence_event_ids`
- `explanation`
- `confidence`
- `resolution_status`

### Causal node and edge

Nodes reference source records rather than copying them.

Node kinds:

- Intent
- Observation
- Assumption
- Decision
- Command
- Mutation
- Validation
- Conflict
- Commit
- Outcome

Edge kinds:

- `depends_on`
- `derived_from`
- `reads`
- `writes`
- `authorized_by`
- `enables`
- `invalidates`
- `conflicts_with`
- `causes`
- `detected_by`

Each inferred edge includes confidence, analyzer version, and evidence references.

### Failure report

Key fields:

- `id`
- `run_id`
- `failed_outcome`
- `earliest_decisive_candidates`
- `contributing_events`
- `causal_paths`
- `alternative_hypotheses`
- `confidence`
- `limitations`
- `analyzer_versions`

### Guardrail

A versioned runtime rule.

Key fields:

- `id`
- `version`
- `name`
- `scope`
- `trigger`
- `predicate`
- `decision`
- `evidence_requirement`
- `status`
- `created_from_failure_report_id`
- `evaluation_summary`

## Interfaces

### Repository configuration

Stored at `.blackbox/config.yaml`:

```yaml
version: 1
repository:
  default_branch: main

validation:
  ticket:
    - id: lint
      command: npm run lint
    - id: typecheck
      command: npm run typecheck
  integration:
    - id: test
      command: npm test
    - id: build
      command: npm run build

execution:
  allowed_command_roots:
    - npm
    - npx
    - git
  command_timeout_seconds: 900

privacy:
  store_model_messages: false
  redact_environment_patterns:
    - "*_TOKEN"
    - "*_SECRET"
```

Configuration is versioned. A run stores the exact resolved configuration used at creation.

### Intent contract API

```typescript
interface IntentContractV1 {
  goal: string;
  reads: ResourceSelector[];
  writes: ResourceSelector[];
  assumptions: Assumption[];
  publicContractChanges: ContractChange[];
  requiredValidations: string[];
  declaredEffects: DeclaredEffect[];
}

interface Assumption {
  id: string;
  statement: string;
  resource?: ResourceSelector;
  expectedVersion?: string;
  severityIfInvalid: "warning" | "replan" | "block";
}
```

### Conflict detector interface

```typescript
interface ConflictDetector {
  readonly id: string;
  readonly version: string;

  evaluate(context: ConflictContext): Promise<ConflictFinding[]>;
}

interface ConflictFinding {
  classification: string;
  severity: "info" | "warning" | "approval_required" | "blocker";
  involvedTransactions: string[];
  involvedResources: ResourceSelector[];
  evidenceEventIds: string[];
  explanation: string;
  confidence: number;
}
```

Detectors must be pure with respect to domain state. Findings are persisted by the calling application service.

### Execution-event ingestion

Workers submit batches of normalized events through an authenticated local endpoint. Each event uses a client-generated UUID and monotonically increasing per-producer sequence number. Duplicate event IDs are accepted idempotently.

### Validation adapter interface

```typescript
interface ValidationAdapter {
  prepare(definition: ValidationDefinition, context: ValidationContext): Promise<PreparedValidation>;
  execute(prepared: PreparedValidation): Promise<ValidationExecutionResult>;
}
```

### Failure analyzer interface

```typescript
interface FailureAnalyzer {
  readonly id: string;
  readonly version: string;

  analyze(input: FailureAnalysisInput): Promise<FailureAnalysisFinding>;
}
```

Multiple analyzers may contribute findings. The report aggregator must preserve disagreements.

### Guardrail format

The MVP uses a constrained declarative format rather than arbitrary code:

```yaml
version: 1
name: current-base-required-at-prepare
scope:
  resource_kind: commit
trigger: transaction.prepare
predicate:
  all:
    - equals:
        left: transaction.base_commit
        right: repository.integration_head
on_failure:
  decision: replan
  message: The integration base changed after this transaction started.
```

### Domain-event delivery

The API transaction writes domain changes and an outbox record atomically. A publisher delivers events to workers. Consumers must be idempotent and track processed event IDs.

## Persistence

### PostgreSQL

Stores:

- Runs, tickets, assignments, intents, transactions, conflicts, validations, rules, and command-side state.
- Append-only execution ledger events.
- Query projections and job metadata.
- Causal nodes and edges for the MVP.

Migration rules:

- All schema changes use ordered migrations committed to the repository.
- Applied migrations are immutable.
- Destructive changes require an explicit data migration or documented reset policy before production use.
- Every persisted payload containing an extensible object includes a schema version.

### Git repository and worktrees

Stores:

- Canonical source code.
- Agent-isolated working state.
- Integration staging state.
- Commits and patches used by replay.

A run records the base commit SHA. Prepared patches are content-addressed and retained according to run-retention settings.

### Artifact store

The MVP may use the local filesystem behind an `ArtifactStore` interface.

Stores:

- Full command output exceeding database limits.
- Patch files.
- validation logs.
- Replay bundles.
- Exported trace bundles.

Artifacts are addressed by cryptographic hash. Database rows store metadata, ownership, size, content type, and hash.

### Secrets

Secrets are not persisted in the ledger. The system stores redaction metadata and secret references, not raw values. Local development secrets remain in environment variables or an explicitly configured secret provider.

### Versioning

The following are independently versioned:

- Application release.
- Database schema.
- Repository configuration.
- Ledger event schemas.
- Intent contracts.
- Conflict detectors.
- Failure analyzers.
- Guardrail definitions.
- Replay-bundle format.

A diagnostic or replay result records all relevant versions.

## Architectural invariants

- Every writing agent is associated with exactly one active ticket and one isolated worktree.
- Only one writing agent may own a ticket at a time.
- No agent worktree may write directly to the canonical protected branch.
- Every recorded effect belongs to a run, ticket, assignment, and transaction.
- The execution ledger is append-only through supported application paths.
- Projection state must be rebuildable from ledger events and versioned command records.
- A transaction cannot become commit-eligible without all required validations passing against the prepared patch.
- Commit-time checks must revalidate assumptions and resource versions that can change during execution.
- A skipped, unavailable, timed-out, or cancelled validation is never equivalent to a passing validation.
- Every conflict decision and diagnostic conclusion must reference evidence.
- Inferred causal edges must be distinguishable from deterministic provenance edges.
- Failed replay fidelity must be reported, never hidden.
- Candidate guardrails cannot become active without explicit user approval in the MVP.
- Secret values must not appear in normal ledger payloads, logs, exports, or UI responses.
- Worker retries must be idempotent or explicitly rejected.
- Unknown enum values and event versions must fail safely rather than being silently coerced.

## Dependency policy

Dependencies are permitted only when they satisfy all of the following:

- They solve a documented need that is not reasonably covered by the standard library or an existing approved dependency.
- They have an active maintenance history and a license compatible with the repository.
- Their transitive dependency and security impact is understood.
- They do not duplicate an existing architectural responsibility.
- They can be wrapped behind an internal interface when they represent infrastructure that may change.
- They do not introduce an agent-framework dependency into core domain packages.

Initial policy:

- Prefer a modular monolith over independently deployed services.
- Prefer PostgreSQL over adding separate databases.
- Prefer native Git commands behind a `GitRepository` interface over a large Git abstraction library unless testing proves otherwise.
- Prefer OpenTelemetry-compatible schemas and exporters for observability.
- Prefer JSON Schema or a typed schema library for boundary validation.
- Do not add a graph database, message broker, vector database, or model provider until a measured requirement justifies it.
- Pin direct dependency versions through the chosen package manager lockfile.
- Automated dependency updates require the same verification gates as product changes.

Every new dependency must be noted in the implementing ticket with:

- Intended use.
- Alternatives considered.
- Security and license notes.
- Removal or replacement cost.

## Error handling

- Domain errors use stable machine-readable codes and safe human-readable messages.
- Expected failures such as conflict, invalid state transition, failed validation, and stale version are represented explicitly rather than as generic internal errors.
- Unexpected errors receive a correlation ID and preserve a sanitized diagnostic record.
- API errors must not expose secrets, raw stack traces, or unredacted command environments.
- Worker failures record the attempted job, retryability decision, and final disposition.
- Retriable operations use bounded exponential backoff and idempotency keys.
- Non-idempotent operations are not retried automatically.
- Partial failures must leave the transaction in an explicit recoverable or terminal state.
- Cancellation propagates to child processes and records whether termination was graceful or forced.
- Filesystem and Git operations use temporary paths and atomic rename where practical.
- Corrupted or incompatible replay bundles fail validation before executing commands.
- The UI must distinguish system failure, agent failure, validation failure, conflict blocking, and user cancellation.

## Security and privacy

Trust boundaries:

- Agent-generated commands and content are untrusted.
- Repository contents may contain malicious instructions or secrets.
- Model output is untrusted input.
- Browser and CLI clients are outside the domain boundary.
- Worker processes are less trusted than the API server and database.
- Exported replay bundles may contain proprietary source code.

Controls:

- Agent commands run as a non-privileged user in a configured repository root.
- Path access is normalized and constrained to approved worktree and artifact locations.
- Shell execution uses argument arrays when possible and avoids unnecessary shell interpolation.
- Environment variables are allowlisted and redacted before recording.
- Model prompts and responses are disabled from persistence by default for the MVP.
- Authentication may be local-only initially, but the API still requires a session or local token to prevent cross-origin access.
- State-changing browser requests require CSRF protection or same-site authenticated APIs.
- Database queries are parameterized.
- Artifact downloads verify authorization and content hashes.
- Replay requires explicit user action and defaults to network-disabled execution.
- Security-sensitive configuration changes are recorded in the ledger.
- Retention and deletion settings apply to logs, patches, artifacts, and exports.

Out of scope for the MVP:

- Strong multi-tenant isolation.
- Running untrusted public repositories safely on a hosted service.
- Regulatory compliance certification.
- Protection against a fully compromised host machine.

## Testing strategy

### Unit tests

Required for:

- Domain state transitions.
- Intent and event schema validation.
- Resource matching and version comparison.
- Conflict detectors.
- Causal graph construction rules.
- Failure-slicing algorithms.
- Guardrail parsing and evaluation.
- Redaction and path-confinement logic.

Unit tests must avoid real Git repositories and external processes unless the unit under test is the adapter itself.

### Integration tests

Required for:

- PostgreSQL repositories and migrations.
- Outbox publishing and idempotent consumption.
- Worktree creation, patch extraction, staging, and cleanup.
- Agent-runner process lifecycle and cancellation.
- Command and validation capture.
- Projection rebuild from ledger events.
- Replay bundle creation and restoration.

Integration tests use temporary repositories and isolated database instances.

### End-to-end tests

Required for the primary workflow:

1. Initialize a repository.
2. Create a run and tickets.
3. Register intents.
4. Execute simulated agents.
5. prepare patches.
6. detect a conflict or run integration validation.
7. display evidence in the web interface.
8. produce a failure report or a merge-eligible result.

At least one successful scenario and one seeded failure scenario must run in CI.

### Browser tests

Required for:

- Run creation and status display.
- Intent and conflict inspection.
- Timeline filtering.
- Evidence navigation.
- Failure-report display.
- Guardrail approval and rejection.

Browser tests must assert visible outcomes and console cleanliness.

### Benchmark tests

A separate deterministic scenario suite must measure:

- Conflict recall and false-positive blocking.
- Replay fidelity.
- Earliest-decisive-step accuracy.
- Guardrail prevention and overblocking.

Benchmark results are versioned artifacts and are not silently updated.

### Manual testing

Required for:

- Running Blackbox against a real local Codex CLI installation.
- Inspecting worktree isolation and cleanup.
- Reviewing a full causal report for comprehensibility and evidence quality.
- Confirming redaction behavior with representative secret names.
- Confirming cancellation of a long-running command.
- Reproducing the documented demo from a clean checkout.

## Open technical decisions

- PostgreSQL job queue versus an external local queue.
- Filesystem event capture strategy across macOS and Linux.
- Exact mechanism for observing file reads without unacceptable overhead.
- Initial symbol-indexing implementation and supported languages.
- Integration strategy: sequential patch application, merge queue, or synthetic merge commit.
- How much agent reasoning metadata to capture when model-message storage is disabled.
- Exact definition and test oracle for an earliest decisive event.
- Whether replay records command outputs or re-executes every deterministic command.
- How to represent alternative causal explanations in the first UI.
- When to introduce OpenTelemetry export versus using only the internal ledger.
- Retention defaults for patches, command output, and replay bundles.
