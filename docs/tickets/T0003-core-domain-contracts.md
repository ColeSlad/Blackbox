# T0003 — Core Domain Contracts

Status: Draft
Milestone: M0 — Foundation

## Outcome

Blackbox has version-1 framework-independent domain types, runtime schemas,
stable errors, and pure lifecycle transition rules.

## Reason

Later lifecycle, persistence, intent, ledger, conflict, causal, replay, and
guardrail work requires stable versioned contracts.

## Dependencies

- T0001 — Done
- T0002 is not a functional dependency, but `pnpm verify` must be used if T0002
  is Done first.

## Preconditions

- Use `typebox@1.3.6` as the single runtime schema dependency.
- Keep TypeBox imports confined to `packages/contracts`; `packages/domain` must
  remain dependency-free.
- Keep lifecycle rules pure; T0006 and T0014 retain orchestration, persistence,
  event emission, and eligibility ownership.
- Verify current package registry, maintenance, license, and advisory facts
  during normal ticket validation before promotion to Ready.

## Allowed Scope

- `packages/domain/`
- New `packages/contracts/`
- `packages/config/` for shared TypeScript and test configuration
- Contract fixtures under `fixtures/contracts/`
- Workspace manifests and lockfile
- `README.md`
- Contract wire-format and lifecycle clarification in `docs/ARCHITECTURE.md`
- `docs/STATUS.md`
- `docs/TICKETS.md`
- `docs/VERIFICATION.md`
- `docs/tickets/T0003-core-domain-contracts.md`

## Protected Areas

- `apps/server/`, `apps/worker/`, `apps/web/`, and `packages/cli/`
- Persistence, Git, queue, worktree, Codex, and command execution
- API routes and browser behavior
- Ledger storage, conflict algorithms, causal analysis, replay, and guardrail
  activation
- Accepted ADR meaning and benchmark ground truth

## Requirements

### Package Boundaries

- `packages/domain` owns framework-independent identifiers, status
  vocabularies, errors, and pure transition rules.
- `packages/contracts` owns TypeBox schemas, parsing, and serialized version-1
  boundary records.
- `packages/contracts` may depend on `packages/domain`.
- `packages/domain` must not depend on contracts, TypeBox, web, Fastify,
  database, queue, Git, Codex, or model-provider packages.

### Schema and Wire Rules

- Use TypeBox schemas as the single source for runtime schema objects and
  inferred TypeScript serialization types.
- Pin `typebox` exactly to `1.3.6` and commit the resulting lockfile.
- Parse all external values from `unknown`.
- Serialized contract keys use `snake_case`, matching the architecture data
  model.
- Inferred TypeScript serialization types retain the same `snake_case` keys.
  T0003 adds no implicit camelCase aliases or key-renaming behavior. Any later
  application-facing camelCase model must use an explicit adapter outside
  `packages/domain`.
- Every top-level version-1 schema requires `schema_version: 1`.
- Nested records inherit the enclosing top-level schema version unless the
  nested record is itself one of the independently parseable schema families.
- Every defined object uses `additionalProperties: false`, except the explicitly
  arbitrary JSON object stored as a ledger payload.
- Every listed property is required. Absence is rejected. A property may be
  `null` only where this ticket explicitly marks it nullable. Wire values never
  use `undefined`.
- Strings described as non-empty must contain at least one non-whitespace
  character.
- Identifiers are opaque non-empty strings.
- Timestamps are RFC 3339 date-time strings containing an explicit UTC offset.
- Git SHAs are lowercase hexadecimal strings of exactly 40 or 64 characters.
- Content hashes use `sha256:` followed by exactly 64 lowercase hexadecimal
  characters.
- Version numbers are integers greater than or equal to 1.
- Sequence numbers are integers greater than or equal to 1.
- Confidence values are finite numbers from 0 through 1 inclusive.
- JSON values are limited recursively to null, booleans, finite numbers,
  strings, arrays of JSON values, and objects whose values are JSON values.
  Functions, symbols, bigint values, and `undefined` are invalid.
- Missing or malformed `schema_version` returns `INVALID_SCHEMA`.
- A recognized record shape with any `schema_version` other than `1` returns
  `UNSUPPORTED_SCHEMA_VERSION` before ordinary field validation.
- Unknown enum values and all other shape failures return `INVALID_SCHEMA`.
- Schema errors contain a safe message and one or more issue paths represented
  as arrays of string or numeric path segments. Errors must not retain or expose
  the rejected payload.
- Forbidden lifecycle edges return `INVALID_STATE_TRANSITION` with current and
  target state names but no external payload.

### Version-1 Schemas

Define these eleven independently parseable schema families.

#### Run

`RunV1` contains:

- `schema_version`: literal `1`;
- `id`: identifier;
- `repository_id`: identifier;
- `title`: non-empty string;
- `base_commit_sha`: Git SHA;
- `status`: run-status enum;
- `configuration_version`: version number;
- `created_at`: timestamp;
- `started_at`: timestamp or explicit `null`;
- `completed_at`: timestamp or explicit `null`.

T0003 validates structure and status vocabulary only. T0006 retains timestamp
and lifecycle orchestration invariants.

#### Ticket

`TicketV1` contains:

- `schema_version`: literal `1`;
- `id`: identifier;
- `run_id`: identifier;
- `external_key`: non-empty string;
- `title`: non-empty string;
- `description`: non-empty string;
- `status`: ticket-status enum;
- `dependencies`: array of unique ticket identifiers;
- `acceptance_criteria`: array of non-empty strings;
- `manual_verification_steps`: array of non-empty strings.

Dependency existence, acyclicity, satisfaction, and start eligibility remain
T0006 responsibilities.

#### Agent Assignment

`AgentAssignmentV1` contains:

- `schema_version`: literal `1`;
- `id`: identifier;
- `run_id`: identifier;
- `ticket_id`: identifier;
- `agent_id`: identifier;
- `worktree_id`: identifier or explicit `null`;
- `status`: assignment-status enum;
- `assigned_at`: timestamp;
- `released_at`: timestamp or explicit `null`.

Worktree provisioning and one-active-assignment enforcement remain T0006 and
T0007 responsibilities.

#### Intent Contract and Nested Intent Records

`IntentContractV1` contains:

- `schema_version`: literal `1`;
- `id`: identifier;
- `assignment_id`: identifier;
- `version`: version number;
- `goal`: non-empty string;
- `reads`: array of unique `ResourceSelectorV1` values;
- `writes`: array of unique `ResourceSelectorV1` values;
- `assumptions`: array of `AssumptionV1` values;
- `public_contract_changes`: array of `ContractChangeV1` values;
- `required_validations`: array of unique non-empty validation-definition
  identifiers;
- `declared_effects`: array of `DeclaredEffectV1` values;
- `created_at`: timestamp.

`AssumptionV1` is a strict nested object containing:

- `id`: identifier;
- `statement`: non-empty string;
- `resource`: `ResourceSelectorV1` or explicit `null`;
- `expected_version`: non-empty string or explicit `null`;
- `severity_if_invalid`: `warning`, `replan`, or `block`.

`expected_version` must be `null` when `resource` is `null`.

`ContractChangeV1` is a strict nested object containing:

- `resource`: `ResourceSelectorV1`;
- `description`: non-empty string.

`DeclaredEffectV1` is a strict nested object containing:

- `description`: non-empty string;
- `resources`: array of unique `ResourceSelectorV1` values.

T0003 defines syntax only. Revision storage, semantic resource resolution,
declared-versus-observed comparison, and invalidation behavior remain T0008
responsibilities.

#### Resource Selector

`ResourceSelectorV1` contains:

- `schema_version`: literal `1`;
- `kind`: `repository`, `commit`, `path`, `symbol`,
  `migration_identifier`, `api_contract`, or `validation_definition`;
- `locator`: non-empty string.

The canonical version-1 identity is the exact pair `(kind, locator)`. T0003 does
not resolve a locator, inspect a repository, expand globs, normalize paths, or
prove that a referenced resource exists.

#### Transaction

`TransactionV1` contains:

- `schema_version`: literal `1`;
- `id`: identifier;
- `run_id`: identifier;
- `ticket_id`: identifier;
- `assignment_id`: identifier;
- `intent_contract_id`: identifier;
- `intent_version`: version number;
- `base_commit_sha`: Git SHA;
- `prepared_patch_hash`: content hash or explicit `null`;
- `status`: transaction-status enum;
- `created_at`: timestamp;
- `updated_at`: timestamp;
- `completed_at`: timestamp or explicit `null`.

T0003 does not enforce admission, prepare, validation, stale-version,
eligibility, persistence, event-emission, or commit preconditions. Those remain
T0014 responsibilities.

#### Ledger-Event Envelope

`LedgerEventEnvelopeV1` contains every property below:

- `schema_version`: literal `1`;
- `event_id`: identifier;
- `event_type`: non-empty string;
- `occurred_at`: timestamp;
- `recorded_at`: timestamp;
- `run_id`: non-null identifier;
- `ticket_id`: identifier or explicit `null`;
- `assignment_id`: identifier or explicit `null`;
- `transaction_id`: identifier or explicit `null`;
- `correlation_id`: identifier or explicit `null`;
- `causation_id`: identifier or explicit `null`;
- `sequence`: sequence number;
- `producer`: non-empty string;
- `payload`: JSON object;
- `payload_hash`: content hash.

Only `payload` permits arbitrary property names, and every payload value must be
valid JSON. Event-family payload schemas, ingestion, sequencing behavior,
deduplication, hashing, storage, and redaction remain T0009 responsibilities.

#### Validation Result

`ValidationResultV1` is a strict discriminated union:

- ticket-scoped results require `scope: ticket`, a non-null `transaction_id`,
  and `run_id: null`;
- integration-scoped results require `scope: integration`, a non-null `run_id`,
  and `transaction_id: null`.

Both alternatives also require:

- `schema_version`: literal `1`;
- `id`: identifier;
- `definition_version`: version number;
- `command`: non-empty string;
- `environment_fingerprint`: non-empty string;
- `status`: `pass`, `fail`, `timeout`, `cancelled`, `skipped`, or
  `unavailable`;
- `exit_code`: integer or explicit `null`;
- `output_artifact`: identifier or explicit `null`;
- `started_at`: timestamp;
- `completed_at`: timestamp or explicit `null`.

Validation execution, evidence collection, and commit-eligibility meaning remain
T0013 and T0014 responsibilities.

#### Conflict

`ConflictV1` contains:

- `schema_version`: literal `1`;
- `id`: identifier;
- `detector_id`: identifier;
- `detector_version`: version number;
- `classification`: non-empty string;
- `severity`: `info`, `warning`, `approval_required`, or `blocker`;
- `decision`: `allow`, `warn`, `wait`, `approval_required`, or `block`;
- `involved_transactions`: array of unique transaction identifiers;
- `involved_resources`: array of unique `ResourceSelectorV1` values;
- `evidence_event_ids`: array of unique ledger-event identifiers;
- `explanation`: non-empty string;
- `confidence`: number from 0 through 1 inclusive;
- `resolution_status`: `open`, `accepted`, `resolved`, or `dismissed`.

Conflict detection, decision policy, persistence, and resolution behavior remain
later-ticket responsibilities.

#### Causal Finding

`CausalFindingV1` is the union of `CausalNodeV1` and `CausalEdgeV1`.

`CausalNodeV1` contains:

- `schema_version`: literal `1`;
- `finding_type`: literal `node`;
- `id`: identifier;
- `run_id`: identifier;
- `kind`: `intent`, `observation`, `assumption`, `decision`, `command`,
  `mutation`, `validation`, `conflict`, `commit`, or `outcome`;
- `source_record_type`: non-empty string;
- `source_record_id`: identifier.

Nodes reference source records and do not copy arbitrary source payloads.

`CausalEdgeV1` contains:

- `schema_version`: literal `1`;
- `finding_type`: literal `edge`;
- `id`: identifier;
- `run_id`: identifier;
- `kind`: `depends_on`, `derived_from`, `reads`, `writes`,
  `authorized_by`, `enables`, `invalidates`, `conflicts_with`, `causes`, or
  `detected_by`;
- `from_node_id`: identifier;
- `to_node_id`: identifier;
- `provenance`: `deterministic` or `inferred`;
- `confidence`: number from 0 through 1 inclusive or explicit `null`;
- `analyzer_version`: non-empty string or explicit `null`;
- `evidence_event_ids`: array of unique ledger-event identifiers.

A deterministic edge requires `confidence: null` and
`analyzer_version: null`. An inferred edge requires non-null confidence,
non-null analyzer version, and at least one evidence-event identifier. Graph
construction and causal analysis remain later-ticket responsibilities.

#### Guardrail

`GuardrailV1` contains:

- `schema_version`: literal `1`;
- `id`: identifier;
- `version`: version number;
- `name`: non-empty string;
- `scope`: `GuardrailScopeV1`;
- `trigger`: non-empty string;
- `predicate`: `GuardrailPredicateV1`;
- `decision`: `allow`, `warn`, `wait`, `replan`, `approval_required`, or
  `block`;
- `evidence_requirement`: `GuardrailEvidenceRequirementV1`;
- `status`: `candidate`, `approved`, `active`, `rejected`, or `retired`;
- `created_from_failure_report_id`: identifier or explicit `null`;
- `evaluation_summary`: `GuardrailEvaluationSummaryV1` or explicit `null`.

`GuardrailScopeV1` is a strict nested object containing:

- `resource_kind`: one resource-kind enum value.

`GuardrailPredicateV1` is a recursive strict union matching the architecture
example:

- `{ equals: { left: non-empty string, right: non-empty string } }`; or
- `{ all: non-empty array of GuardrailPredicateV1 }`.

`GuardrailEvidenceRequirementV1` is a strict nested object containing:

- `event_types`: non-empty array of unique non-empty event-type strings;
- `minimum_count`: integer greater than or equal to 1.

`GuardrailEvaluationSummaryV1` is a strict nested object containing:

- `evaluated_failure_scenarios`: non-negative integer;
- `prevented_failure_scenarios`: non-negative integer;
- `evaluated_success_scenarios`: non-negative integer;
- `false_positive_blocks`: non-negative integer.

Guardrail evaluation, status transitions, approval, activation, and enforcement
remain T0023 responsibilities.

### Run States

Vocabulary:

- `created`
- `running`
- `completed`
- `failed`
- `cancelled`

Legal transitions:

- `created` → `running`, `cancelled`
- `running` → `completed`, `failed`, `cancelled`
- `completed`, `failed`, and `cancelled` are terminal

### Ticket States

Vocabulary:

- `pending`
- `ready`
- `running`
- `blocked`
- `done`
- `failed`
- `cancelled`

Legal transitions:

- `pending` → `ready`, `blocked`, `cancelled`
- `ready` → `running`, `blocked`, `cancelled`
- `running` → `done`, `blocked`, `failed`, `cancelled`
- `blocked` → `ready`, `cancelled`
- `done`, `failed`, and `cancelled` are terminal

Dependency satisfaction and assignment ownership remain T0006 orchestration
preconditions; T0003 only answers whether a state edge is structurally legal.

### Assignment States

Vocabulary:

- `assigned`
- `active`
- `released`
- `failed`
- `cancelled`

Legal transitions:

- `assigned` → `active`, `failed`, `cancelled`
- `active` → `released`, `failed`, `cancelled`
- `released`, `failed`, and `cancelled` are terminal

One-active-assignment enforcement remains T0006 ownership.

### Transaction States

Use the architecture vocabulary:

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

Legal transitions:

- `declared` → `admitted`, `rejected`, `cancelled`, `failed`
- `admitted` → `running`, `rejected`, `cancelled`, `failed`
- `running` → `prepared`, `rejected`, `cancelled`, `failed`
- `prepared` → `validating`, `rejected`, `cancelled`, `failed`
- `validating` → `eligible`, `rejected`, `cancelled`, `failed`
- `eligible` → `committed`, `rejected`, `cancelled`, `failed`
- `committed` → `compensating`
- `compensating` → `compensated`, `failed`
- `rejected`, `cancelled`, `compensated`, and `failed` are terminal

Validation evidence, stale-version checks, atomic transition persistence, ledger
emission, and commit eligibility remain T0014 responsibilities.

### Tests and Examples

- Export immutable transition tables and pure transition functions.
- Test every legal transition.
- Test every non-listed transition from every state.
- Test unknown current and target states through runtime parsers.
- Add one valid version-1 fixture per schema family.
- Add malformed, unknown-version, unknown-enum, and invalid-transition fixtures.
- Add a deterministic dependency-boundary test proving prohibited imports are
  absent.

## Dependency Evaluation

### `typebox@1.3.6`

- Intended use: provide JSON-Schema-compatible runtime schemas, runtime parsing,
  and inferred TypeScript serialization types without separate handwritten
  validators.
- Selection:
  - npm reports `typebox@1.3.6` as the current `latest` release;
  - upstream documents TypeBox 1.x as the current ESM line for TypeScript 6.0
    through 7.0 and later;
  - this repository already uses ESM and TypeScript 6.0.3;
  - the package has no declared runtime, peer, or optional dependencies.
- Alternatives considered:
  - `@sinclair/typebox@0.34.52` is the actively maintained 0.x LTS line, but
    upstream recommends the unscoped `typebox` 1.x package for new development;
  - handwritten validators would duplicate schema and TypeScript definitions;
  - Ajv plus separately authored TypeScript types would add a second source of
    truth and at least one additional direct dependency;
  - Zod provides runtime validation but is less directly aligned with the
    architecture's JSON Schema preference.
- Maintenance evidence:
  - npm metadata was modified on 2026-07-08;
  - the upstream `sinclairzx81/typebox` repository was active and unarchived,
    with a push recorded on 2026-07-16;
  - maintenance facts must be rechecked if promotion or implementation occurs
    materially later.
- License:
  - npm declares MIT;
  - the upstream repository license file contains the MIT license.
- Security and transitive impact:
  - registry metadata declares no runtime, peer, or optional dependencies;
  - an OSV query for npm package `typebox` version `1.3.6` returned no known
    advisories on 2026-07-17;
  - absence of a reported advisory is not a security guarantee;
  - after installation, inspect the committed lockfile and run the repository
    advisory audit before acceptance;
  - stop if the resolved package differs, introduces unexpected dependencies,
    or produces a license or advisory concern.
- Boundary control: only `packages/contracts` may import `typebox`.
  `packages/domain` must remain dependency-free and framework-independent.
- Removal cost: medium. Wire schemas remain explicit, but parsers and inferred
  serialization types would require replacement.
- Pin exactly `typebox@1.3.6`.

## Acceptance Criteria

- All eleven schema families expose version-1 runtime schemas and TypeScript
  types.
- Valid fixtures parse successfully.
- Unknown schema versions and enum values fail safely.
- Stable errors distinguish invalid shape, unsupported version, and forbidden
  transition.
- Every legal run, ticket, assignment, and transaction transition passes.
- Every non-listed transition fails.
- Domain code remains framework and infrastructure independent.
- Contracts contain no application orchestration or persistence behavior.
- T0014 responsibilities are not implemented.
- All serialized contract keys use the specified snake_case wire convention.
- Every strict object rejects additional properties.
- Every required field and explicit-null rule is covered by tests.
- Validation-result scope and identifier ownership are enforced by its union.
- Deterministic and inferred causal edges enforce their distinct metadata rules.
- No unspecified nested value is accepted as `unknown` except ledger JSON
  payload contents.
- Aggregate verification passes.

## Automated Checks

- `pnpm --filter @blackbox/domain test`
- `pnpm --filter @blackbox/contracts test`
- `pnpm --filter @blackbox/domain typecheck`
- `pnpm --filter @blackbox/contracts typecheck`
- Deterministic prohibited-import check
- Confirm `typebox` is pinned exactly to `1.3.6`.
- Confirm the lockfile resolves no unexpected `typebox` transitive dependency.
- Run the repository advisory audit after installation.
- Recheck registry version, repository, license, and publication metadata before
  acceptance.
- `pnpm lint`
- `pnpm typecheck`
- `pnpm test`
- `pnpm build`
- `pnpm verify` when available
- `git diff --check`

## Manual Verification

1. Inspect one serialized example for every schema family.
2. Parse a valid version-1 transaction.
3. Change its version and confirm `UNSUPPORTED_SCHEMA_VERSION`.
4. Attempt one legal transition and inspect the resulting state.
5. Attempt one forbidden transition and confirm `INVALID_STATE_TRANSITION`.
6. Confirm no infrastructure or framework type appears in the domain API.

## Exclusions

- Persistence and migrations
- Lifecycle application services, API, CLI, or UI
- Event ingestion or ledger storage
- Conflict detection
- Causal analysis
- Replay
- Guardrail evaluation or activation
- Automatic schema migration
- T0014 atomic orchestration and evidence checks

## Documentation Updates

- Add the approved status vocabularies and transition tables to
  `docs/ARCHITECTURE.md`.
- Document schema and version checks in `docs/VERIFICATION.md`.
- Record available contracts and limitations in `docs/STATUS.md`.
- Keep the ticket Draft until separate validation and human promotion.

## Rollback

Revert the ticket commit. No persisted product data exists yet.

## Reviewer Focus

- Architecture field coverage
- Runtime validation rather than TypeScript-only claims
- Complete transition matrices
- Domain dependency direction
- T0006 and T0014 ownership separation
- Dependency evidence and exact pinning
- Safe unknown-version behavior

## Readiness

The schema mechanism, lifecycle vocabularies, legal transitions, and ownership
boundaries are resolved. Normal dependency fact-checking, `plan_validator`, and
explicit human promotion remain mandatory gates rather than unresolved design
decisions.
