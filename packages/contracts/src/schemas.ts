import {
  ASSIGNMENT_STATUSES,
  RUN_STATUSES,
  TICKET_STATUSES,
  TRANSACTION_STATUSES,
} from "@blackbox/domain";
import Type from "typebox";

const strictObject = <const Properties extends Type.TProperties>(
  properties: Properties,
) => Type.Object(properties, { additionalProperties: false });

const nullable = <const Schema extends Type.TSchema>(schema: Schema) =>
  Type.Union([schema, Type.Null()]);

export const NonEmptyStringSchema = Type.String({
  minLength: 1,
  pattern: "\\S",
});
export const IdentifierSchema = NonEmptyStringSchema;
export const TimestampSchema = Type.String({ format: "date-time" });
export const GitShaSchema = Type.String({
  pattern: "^(?:[0-9a-f]{40}|[0-9a-f]{64})$",
});
export const ContentHashSchema = Type.String({
  pattern: "^sha256:[0-9a-f]{64}$",
});
export const VersionNumberSchema = Type.Integer({ minimum: 1 });
export const SequenceNumberSchema = VersionNumberSchema;
export const ConfidenceSchema = Type.Number({ minimum: 0, maximum: 1 });

const SchemaVersionV1Schema = Type.Literal(1);
const RunStatusSchema = Type.Enum(RUN_STATUSES);
const TicketStatusSchema = Type.Enum(TICKET_STATUSES);
const AssignmentStatusSchema = Type.Enum(ASSIGNMENT_STATUSES);
const TransactionStatusSchema = Type.Enum(TRANSACTION_STATUSES);

export const ResourceKindV1Schema = Type.Enum([
  "repository",
  "commit",
  "path",
  "symbol",
  "migration_identifier",
  "api_contract",
  "validation_definition",
] as const);

export const ResourceSelectorV1Schema = strictObject({
  schema_version: SchemaVersionV1Schema,
  kind: ResourceKindV1Schema,
  locator: NonEmptyStringSchema,
});

export const RunV1Schema = strictObject({
  schema_version: SchemaVersionV1Schema,
  id: IdentifierSchema,
  repository_id: IdentifierSchema,
  title: NonEmptyStringSchema,
  base_commit_sha: GitShaSchema,
  status: RunStatusSchema,
  configuration_version: VersionNumberSchema,
  created_at: TimestampSchema,
  started_at: nullable(TimestampSchema),
  completed_at: nullable(TimestampSchema),
});

export const TicketV1Schema = strictObject({
  schema_version: SchemaVersionV1Schema,
  id: IdentifierSchema,
  run_id: IdentifierSchema,
  external_key: NonEmptyStringSchema,
  title: NonEmptyStringSchema,
  description: NonEmptyStringSchema,
  status: TicketStatusSchema,
  dependencies: Type.Array(IdentifierSchema, { uniqueItems: true }),
  acceptance_criteria: Type.Array(NonEmptyStringSchema),
  manual_verification_steps: Type.Array(NonEmptyStringSchema),
});

export const AgentAssignmentV1Schema = strictObject({
  schema_version: SchemaVersionV1Schema,
  id: IdentifierSchema,
  run_id: IdentifierSchema,
  ticket_id: IdentifierSchema,
  agent_id: IdentifierSchema,
  worktree_id: nullable(IdentifierSchema),
  status: AssignmentStatusSchema,
  assigned_at: TimestampSchema,
  released_at: nullable(TimestampSchema),
});

const AssumptionWithResourceV1Schema = strictObject({
  id: IdentifierSchema,
  statement: NonEmptyStringSchema,
  resource: ResourceSelectorV1Schema,
  expected_version: nullable(NonEmptyStringSchema),
  severity_if_invalid: Type.Enum(["warning", "replan", "block"] as const),
});

const AssumptionWithoutResourceV1Schema = strictObject({
  id: IdentifierSchema,
  statement: NonEmptyStringSchema,
  resource: Type.Null(),
  expected_version: Type.Null(),
  severity_if_invalid: Type.Enum(["warning", "replan", "block"] as const),
});

export const AssumptionV1Schema = Type.Union([
  AssumptionWithResourceV1Schema,
  AssumptionWithoutResourceV1Schema,
]);

export const ContractChangeV1Schema = strictObject({
  resource: ResourceSelectorV1Schema,
  description: NonEmptyStringSchema,
});

export const DeclaredEffectV1Schema = strictObject({
  description: NonEmptyStringSchema,
  resources: Type.Array(ResourceSelectorV1Schema, { uniqueItems: true }),
});

export const IntentContractV1Schema = strictObject({
  schema_version: SchemaVersionV1Schema,
  id: IdentifierSchema,
  assignment_id: IdentifierSchema,
  version: VersionNumberSchema,
  goal: NonEmptyStringSchema,
  reads: Type.Array(ResourceSelectorV1Schema, { uniqueItems: true }),
  writes: Type.Array(ResourceSelectorV1Schema, { uniqueItems: true }),
  assumptions: Type.Array(AssumptionV1Schema),
  public_contract_changes: Type.Array(ContractChangeV1Schema),
  required_validations: Type.Array(NonEmptyStringSchema, { uniqueItems: true }),
  declared_effects: Type.Array(DeclaredEffectV1Schema),
  created_at: TimestampSchema,
});

export const TransactionV1Schema = strictObject({
  schema_version: SchemaVersionV1Schema,
  id: IdentifierSchema,
  run_id: IdentifierSchema,
  ticket_id: IdentifierSchema,
  assignment_id: IdentifierSchema,
  intent_contract_id: IdentifierSchema,
  intent_version: VersionNumberSchema,
  base_commit_sha: GitShaSchema,
  prepared_patch_hash: nullable(ContentHashSchema),
  status: TransactionStatusSchema,
  created_at: TimestampSchema,
  updated_at: TimestampSchema,
  completed_at: nullable(TimestampSchema),
});

const JsonDefinitions = {
  JsonValueV1: Type.Union([
    Type.Null(),
    Type.Boolean(),
    Type.Number(),
    Type.String(),
    Type.Array(Type.Ref("JsonValueV1")),
    Type.Ref("JsonObjectV1"),
  ]),
  JsonObjectV1: Type.Record(Type.String(), Type.Ref("JsonValueV1"), {
    additionalProperties: false,
  }),
};

export const JsonValueV1Schema = Type.Cyclic(JsonDefinitions, "JsonValueV1");
export const JsonObjectV1Schema = Type.Cyclic(JsonDefinitions, "JsonObjectV1");

export const LedgerEventEnvelopeV1Schema = strictObject({
  schema_version: SchemaVersionV1Schema,
  event_id: IdentifierSchema,
  event_type: NonEmptyStringSchema,
  occurred_at: TimestampSchema,
  recorded_at: TimestampSchema,
  run_id: IdentifierSchema,
  ticket_id: nullable(IdentifierSchema),
  assignment_id: nullable(IdentifierSchema),
  transaction_id: nullable(IdentifierSchema),
  correlation_id: nullable(IdentifierSchema),
  causation_id: nullable(IdentifierSchema),
  sequence: SequenceNumberSchema,
  producer: NonEmptyStringSchema,
  payload: JsonObjectV1Schema,
  payload_hash: ContentHashSchema,
});

const ValidationResultFields = {
  schema_version: SchemaVersionV1Schema,
  id: IdentifierSchema,
  definition_version: VersionNumberSchema,
  command: NonEmptyStringSchema,
  environment_fingerprint: NonEmptyStringSchema,
  status: Type.Enum([
    "pass",
    "fail",
    "timeout",
    "cancelled",
    "skipped",
    "unavailable",
  ] as const),
  exit_code: nullable(Type.Integer()),
  output_artifact: nullable(IdentifierSchema),
  started_at: TimestampSchema,
  completed_at: nullable(TimestampSchema),
};

export const TicketValidationResultV1Schema = strictObject({
  ...ValidationResultFields,
  scope: Type.Literal("ticket"),
  transaction_id: IdentifierSchema,
  run_id: Type.Null(),
});

export const IntegrationValidationResultV1Schema = strictObject({
  ...ValidationResultFields,
  scope: Type.Literal("integration"),
  transaction_id: Type.Null(),
  run_id: IdentifierSchema,
});

export const ValidationResultV1Schema = Type.Union([
  TicketValidationResultV1Schema,
  IntegrationValidationResultV1Schema,
]);

export const ConflictV1Schema = strictObject({
  schema_version: SchemaVersionV1Schema,
  id: IdentifierSchema,
  detector_id: IdentifierSchema,
  detector_version: VersionNumberSchema,
  classification: NonEmptyStringSchema,
  severity: Type.Enum([
    "info",
    "warning",
    "approval_required",
    "blocker",
  ] as const),
  decision: Type.Enum([
    "allow",
    "warn",
    "wait",
    "approval_required",
    "block",
  ] as const),
  involved_transactions: Type.Array(IdentifierSchema, { uniqueItems: true }),
  involved_resources: Type.Array(ResourceSelectorV1Schema, {
    uniqueItems: true,
  }),
  evidence_event_ids: Type.Array(IdentifierSchema, { uniqueItems: true }),
  explanation: NonEmptyStringSchema,
  confidence: ConfidenceSchema,
  resolution_status: Type.Enum([
    "open",
    "accepted",
    "resolved",
    "dismissed",
  ] as const),
});

export const CausalNodeV1Schema = strictObject({
  schema_version: SchemaVersionV1Schema,
  finding_type: Type.Literal("node"),
  id: IdentifierSchema,
  run_id: IdentifierSchema,
  kind: Type.Enum([
    "intent",
    "observation",
    "assumption",
    "decision",
    "command",
    "mutation",
    "validation",
    "conflict",
    "commit",
    "outcome",
  ] as const),
  source_record_type: NonEmptyStringSchema,
  source_record_id: IdentifierSchema,
});

const CausalEdgeFields = {
  schema_version: SchemaVersionV1Schema,
  finding_type: Type.Literal("edge"),
  id: IdentifierSchema,
  run_id: IdentifierSchema,
  kind: Type.Enum([
    "depends_on",
    "derived_from",
    "reads",
    "writes",
    "authorized_by",
    "enables",
    "invalidates",
    "conflicts_with",
    "causes",
    "detected_by",
  ] as const),
  from_node_id: IdentifierSchema,
  to_node_id: IdentifierSchema,
};

export const DeterministicCausalEdgeV1Schema = strictObject({
  ...CausalEdgeFields,
  provenance: Type.Literal("deterministic"),
  confidence: Type.Null(),
  analyzer_version: Type.Null(),
  evidence_event_ids: Type.Array(IdentifierSchema, { uniqueItems: true }),
});

export const InferredCausalEdgeV1Schema = strictObject({
  ...CausalEdgeFields,
  provenance: Type.Literal("inferred"),
  confidence: ConfidenceSchema,
  analyzer_version: NonEmptyStringSchema,
  evidence_event_ids: Type.Array(IdentifierSchema, {
    minItems: 1,
    uniqueItems: true,
  }),
});

export const CausalEdgeV1Schema = Type.Union([
  DeterministicCausalEdgeV1Schema,
  InferredCausalEdgeV1Schema,
]);

export const CausalFindingV1Schema = Type.Union([
  CausalNodeV1Schema,
  DeterministicCausalEdgeV1Schema,
  InferredCausalEdgeV1Schema,
]);

export const GuardrailScopeV1Schema = strictObject({
  resource_kind: ResourceKindV1Schema,
});

const GuardrailPredicateDefinitions = {
  GuardrailPredicateV1: Type.Union([
    strictObject({
      equals: strictObject({
        left: NonEmptyStringSchema,
        right: NonEmptyStringSchema,
      }),
    }),
    strictObject({
      all: Type.Array(Type.Ref("GuardrailPredicateV1"), { minItems: 1 }),
    }),
  ]),
};

export const GuardrailPredicateV1Schema = Type.Cyclic(
  GuardrailPredicateDefinitions,
  "GuardrailPredicateV1",
);

export const GuardrailEvidenceRequirementV1Schema = strictObject({
  event_types: Type.Array(NonEmptyStringSchema, {
    minItems: 1,
    uniqueItems: true,
  }),
  minimum_count: Type.Integer({ minimum: 1 }),
});

export const GuardrailEvaluationSummaryV1Schema = strictObject({
  evaluated_failure_scenarios: Type.Integer({ minimum: 0 }),
  prevented_failure_scenarios: Type.Integer({ minimum: 0 }),
  evaluated_success_scenarios: Type.Integer({ minimum: 0 }),
  false_positive_blocks: Type.Integer({ minimum: 0 }),
});

export const GuardrailV1Schema = strictObject({
  schema_version: SchemaVersionV1Schema,
  id: IdentifierSchema,
  version: VersionNumberSchema,
  name: NonEmptyStringSchema,
  scope: GuardrailScopeV1Schema,
  trigger: NonEmptyStringSchema,
  predicate: GuardrailPredicateV1Schema,
  decision: Type.Enum([
    "allow",
    "warn",
    "wait",
    "replan",
    "approval_required",
    "block",
  ] as const),
  evidence_requirement: GuardrailEvidenceRequirementV1Schema,
  status: Type.Enum([
    "candidate",
    "approved",
    "active",
    "rejected",
    "retired",
  ] as const),
  created_from_failure_report_id: nullable(IdentifierSchema),
  evaluation_summary: nullable(GuardrailEvaluationSummaryV1Schema),
});

export type ResourceSelectorV1 = Type.Static<typeof ResourceSelectorV1Schema>;
export type RunV1 = Type.Static<typeof RunV1Schema>;
export type TicketV1 = Type.Static<typeof TicketV1Schema>;
export type AgentAssignmentV1 = Type.Static<typeof AgentAssignmentV1Schema>;
export type AssumptionV1 = Type.Static<typeof AssumptionV1Schema>;
export type ContractChangeV1 = Type.Static<typeof ContractChangeV1Schema>;
export type DeclaredEffectV1 = Type.Static<typeof DeclaredEffectV1Schema>;
export type IntentContractV1 = Type.Static<typeof IntentContractV1Schema>;
export type TransactionV1 = Type.Static<typeof TransactionV1Schema>;
export type JsonValueV1 = Type.Static<typeof JsonValueV1Schema>;
export type JsonObjectV1 = Type.Static<typeof JsonObjectV1Schema>;
export type LedgerEventEnvelopeV1 = Type.Static<
  typeof LedgerEventEnvelopeV1Schema
>;
export type ValidationResultV1 = Type.Static<typeof ValidationResultV1Schema>;
export type ConflictV1 = Type.Static<typeof ConflictV1Schema>;
export type CausalNodeV1 = Type.Static<typeof CausalNodeV1Schema>;
export type CausalEdgeV1 = Type.Static<typeof CausalEdgeV1Schema>;
export type CausalFindingV1 = Type.Static<typeof CausalFindingV1Schema>;
export type GuardrailScopeV1 = Type.Static<typeof GuardrailScopeV1Schema>;
export type GuardrailPredicateV1 = Type.Static<
  typeof GuardrailPredicateV1Schema
>;
export type GuardrailEvidenceRequirementV1 = Type.Static<
  typeof GuardrailEvidenceRequirementV1Schema
>;
export type GuardrailEvaluationSummaryV1 = Type.Static<
  typeof GuardrailEvaluationSummaryV1Schema
>;
export type GuardrailV1 = Type.Static<typeof GuardrailV1Schema>;
