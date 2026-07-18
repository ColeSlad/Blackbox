import { readFile } from "node:fs/promises";

import {
  ERROR_CODES,
  InvalidSchemaError,
  InvalidStateTransitionError,
  UnsupportedSchemaVersionError,
  transitionTicketStatus,
} from "@blackbox/domain";
import Compile from "typebox/compile";
import { describe, expect, it } from "vitest";

import {
  AssumptionV1Schema,
  CausalNodeV1Schema,
  ContractChangeV1Schema,
  DeclaredEffectV1Schema,
  DeterministicCausalEdgeV1Schema,
  GuardrailEvaluationSummaryV1Schema,
  GuardrailEvidenceRequirementV1Schema,
  GuardrailPredicateV1Schema,
  GuardrailScopeV1Schema,
  InferredCausalEdgeV1Schema,
  IntegrationValidationResultV1Schema,
  ResourceSelectorV1Schema,
  TicketValidationResultV1Schema,
  parseAgentAssignmentV1,
  parseCausalFindingV1,
  parseConflictV1,
  parseGuardrailV1,
  parseIntentContractV1,
  parseLedgerEventEnvelopeV1,
  parseResourceSelectorV1,
  parseRunV1,
  parseTicketV1,
  parseTransactionV1,
  parseValidationResultV1,
} from "./index.js";

const repositoryRoot = new URL("../../../", import.meta.url);

async function loadFixture(fileName: string): Promise<Record<string, unknown>> {
  return JSON.parse(
    await readFile(
      new URL(`fixtures/contracts/${fileName}`, repositoryRoot),
      "utf8",
    ),
  ) as Record<string, unknown>;
}

type Parser = (value: unknown) => unknown;

const schemaFamilies: readonly [string, string, Parser][] = [
  ["run", "run-v1.json", parseRunV1],
  ["ticket", "ticket-v1.json", parseTicketV1],
  ["agent assignment", "agent-assignment-v1.json", parseAgentAssignmentV1],
  ["intent contract", "intent-contract-v1.json", parseIntentContractV1],
  ["resource selector", "resource-selector-v1.json", parseResourceSelectorV1],
  ["transaction", "transaction-v1.json", parseTransactionV1],
  [
    "ledger-event envelope",
    "ledger-event-envelope-v1.json",
    parseLedgerEventEnvelopeV1,
  ],
  ["validation result", "validation-result-v1.json", parseValidationResultV1],
  ["conflict", "conflict-v1.json", parseConflictV1],
  ["causal finding", "causal-finding-v1.json", parseCausalFindingV1],
  ["guardrail", "guardrail-v1.json", parseGuardrailV1],
];

function expectInvalid(action: () => unknown): InvalidSchemaError {
  try {
    action();
    expect.unreachable("invalid contract should fail");
  } catch (error) {
    expect(error).toBeInstanceOf(InvalidSchemaError);
    expect(error).toMatchObject({ code: ERROR_CODES.invalidSchema });
    return error as InvalidSchemaError;
  }
}

function expectSafeInvalid(
  action: () => unknown,
  issuePath: readonly (string | number)[],
  secret: string,
): InvalidSchemaError {
  const error = expectInvalid(action);
  expect(error.issuePaths).toEqual([issuePath]);
  expect(`${error.name}: ${error.message}`).not.toContain(secret);
  expect(JSON.stringify(error)).not.toContain(secret);
  expect(Object.hasOwn(error, "cause")).toBe(false);
  return error;
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

function setPath(
  value: Record<string, unknown>,
  path: readonly string[],
  replacement: unknown,
): void {
  let cursor = value;
  for (const segment of path.slice(0, -1)) {
    cursor = cursor[segment] as Record<string, unknown>;
  }
  cursor[path.at(-1) as string] = replacement;
}

describe("version-one schema families", () => {
  for (const [name, fixtureName, parser] of schemaFamilies) {
    it(`parses the inspectable ${name} fixture`, async () => {
      const fixture = await loadFixture(fixtureName);
      expect(parser(fixture)).toEqual(fixture);
    });

    it(`${name} requires every top-level field`, async () => {
      const fixture = await loadFixture(fixtureName);
      for (const key of Object.keys(fixture)) {
        const missingField = clone(fixture);
        delete missingField[key];
        expectInvalid(() => parser(missingField));
      }
    });

    it(`${name} rejects additional top-level fields`, async () => {
      const fixture = await loadFixture(fixtureName);
      expectInvalid(() => parser({ ...fixture, unexpected: true }));
    });

    it(`${name} reports a supported-version error before shape errors`, async () => {
      const fixture = await loadFixture(fixtureName);
      fixture.schema_version = 2;
      delete fixture.id;
      expect(() => parser(fixture)).toThrowError(UnsupportedSchemaVersionError);
    });

    it(`${name} rejects malformed schema versions`, async () => {
      const fixture = await loadFixture(fixtureName);
      fixture.schema_version = "1";
      const error = expectInvalid(() => parser(fixture));
      expect(error.issuePaths).toEqual([["schema_version"]]);
    });
  }

  it("loads focused malformed, unknown-version, and unknown-enum fixtures", async () => {
    const malformedRun = await loadFixture("invalid/malformed-run-v1.json");
    const unknownVersion = await loadFixture(
      "invalid/unknown-version-transaction-v1.json",
    );
    const unknownEnum = await loadFixture(
      "invalid/unknown-enum-ticket-v1.json",
    );
    expectInvalid(() => parseRunV1(malformedRun));
    expect(() => parseTransactionV1(unknownVersion)).toThrowError(
      UnsupportedSchemaVersionError,
    );
    expectInvalid(() => parseTicketV1(unknownEnum));
  });

  it("loads the invalid-transition fixture through the domain transition parser", async () => {
    const fixture = await loadFixture(
      "invalid/invalid-transition-ticket-v1.json",
    );
    expect(() =>
      transitionTicketStatus(fixture.current_state, fixture.target_state),
    ).toThrowError(InvalidStateTransitionError);
  });

  it("returns safe issue paths without retaining a rejected payload", async () => {
    const fixture = await loadFixture("run-v1.json");
    fixture.title = "secret-rejected-value";
    fixture.configuration_version = 0;
    const error = expectInvalid(() => parseRunV1(fixture));
    expect(error.issuePaths.length).toBeGreaterThan(0);
    for (const path of error.issuePaths) {
      expect(Array.isArray(path)).toBe(true);
      expect(Object.isFrozen(path)).toBe(true);
    }
    expect(JSON.stringify(error)).not.toContain("secret-rejected-value");
  });

  it("normalizes a throwing schema_version accessor", () => {
    const secret = "secret-schema-version-accessor";
    const input = Object.defineProperty({}, "schema_version", {
      enumerable: true,
      get() {
        throw new Error(secret);
      },
    });

    expectSafeInvalid(() => parseRunV1(input), ["schema_version"], secret);
  });

  it("never inspects a hostile value thrown by schema_version", () => {
    const secret = "secret-hostile-thrown-proxy";
    const hostileThrownValue = new Proxy(
      {},
      {
        getPrototypeOf() {
          throw new Error(secret);
        },
      },
    );
    const input = Object.defineProperty({}, "schema_version", {
      enumerable: true,
      get() {
        throw hostileThrownValue;
      },
    });

    expectSafeInvalid(() => parseRunV1(input), ["schema_version"], secret);
  });

  it("never rethrows an attacker-created stable error", () => {
    const secret = "secret-attacker-error-property";
    const attackerError = Object.assign(
      new InvalidSchemaError([["attacker_path"]]),
      { secret },
    );
    const input = Object.defineProperty({}, "schema_version", {
      enumerable: true,
      get() {
        throw attackerError;
      },
    });

    const error = expectSafeInvalid(
      () => parseRunV1(input),
      ["schema_version"],
      secret,
    );
    expect(error).not.toBe(attackerError);
    expect(error).not.toHaveProperty("secret");
  });

  it("normalizes a throwing ordinary field accessor at the safe root path", async () => {
    const secret = "secret-title-accessor";
    const input = await loadFixture("run-v1.json");
    Object.defineProperty(input, "title", {
      enumerable: true,
      get() {
        throw new Error(secret);
      },
    });

    expectSafeInvalid(() => parseRunV1(input), [], secret);
  });

  it("normalizes hostile ledger payload reflection at the payload path", async () => {
    const secret = "secret-proxy-reflection";
    const input = await loadFixture("ledger-event-envelope-v1.json");
    input.payload = new Proxy(
      {},
      {
        ownKeys() {
          throw new Error(secret);
        },
      },
    );

    expectSafeInvalid(
      () => parseLedgerEventEnvelopeV1(input),
      ["payload"],
      secret,
    );
  });
});

describe("strict nested records", () => {
  it("requires all properties and rejects extras for every nested object", async () => {
    const intent = await loadFixture("intent-contract-v1.json");
    const validation = await loadFixture("validation-result-v1.json");
    const causal = await loadFixture("causal-finding-v1.json");
    const guardrail = await loadFixture("guardrail-v1.json");
    const resource = await loadFixture("resource-selector-v1.json");

    const integrationValidation = {
      ...validation,
      scope: "integration",
      transaction_id: null,
      run_id: "run-1",
    };
    const deterministicEdge = {
      ...causal,
      provenance: "deterministic",
      confidence: null,
      analyzer_version: null,
      evidence_event_ids: [],
    };
    const causalNode = {
      schema_version: 1,
      finding_type: "node",
      id: "node-1",
      run_id: "run-1",
      kind: "intent",
      source_record_type: "intent_contract",
      source_record_id: "intent-1",
    };

    const nestedCases = [
      [ResourceSelectorV1Schema, resource],
      [
        AssumptionV1Schema,
        (intent.assumptions as Record<string, unknown>[])[0],
      ],
      [
        ContractChangeV1Schema,
        (intent.public_contract_changes as Record<string, unknown>[])[0],
      ],
      [
        DeclaredEffectV1Schema,
        (intent.declared_effects as Record<string, unknown>[])[0],
      ],
      [TicketValidationResultV1Schema, validation],
      [IntegrationValidationResultV1Schema, integrationValidation],
      [CausalNodeV1Schema, causalNode],
      [DeterministicCausalEdgeV1Schema, deterministicEdge],
      [InferredCausalEdgeV1Schema, causal],
      [GuardrailScopeV1Schema, guardrail.scope],
      [GuardrailPredicateV1Schema, guardrail.predicate],
      [GuardrailEvidenceRequirementV1Schema, guardrail.evidence_requirement],
      [GuardrailEvaluationSummaryV1Schema, guardrail.evaluation_summary],
    ] as const;

    for (const [schema, rawValue] of nestedCases) {
      const value = rawValue as Record<string, unknown>;
      const validator = Compile(schema);
      expect(validator.Check(value)).toBe(true);
      for (const key of Object.keys(value)) {
        const missing = clone(value);
        delete missing[key];
        expect(validator.Check(missing)).toBe(false);
      }
      expect(validator.Check({ ...value, unexpected: true })).toBe(false);
    }
  });

  it("keeps both recursive predicate alternatives strict", async () => {
    const guardrail = await loadFixture("guardrail-v1.json");
    const predicate = guardrail.predicate as Record<string, unknown>;
    const all = predicate.all as Record<string, unknown>[];
    const equals = all[0]?.equals as Record<string, unknown>;
    equals.unexpected = true;
    expectInvalid(() => parseGuardrailV1(guardrail));
  });

  it("requires every property in the recursive equals record", async () => {
    const guardrail = await loadFixture("guardrail-v1.json");
    const predicate = guardrail.predicate as Record<string, unknown>;
    const all = predicate.all as Record<string, unknown>[];
    const child = all[0] as Record<string, unknown>;
    const equals = child.equals as Record<string, unknown>;
    for (const key of Object.keys(equals)) {
      const invalid = clone(guardrail);
      const invalidPredicate = invalid.predicate as Record<string, unknown>;
      const invalidAll = invalidPredicate.all as Record<string, unknown>[];
      const invalidEquals = invalidAll[0]?.equals as Record<string, unknown>;
      delete invalidEquals[key];
      expectInvalid(() => parseGuardrailV1(invalid));
    }
  });
});

describe("primitive and collection rules", () => {
  it("rejects whitespace-only strings and identifiers", async () => {
    const run = await loadFixture("run-v1.json");
    for (const field of ["id", "title"] as const) {
      const invalid = clone(run);
      invalid[field] = "   ";
      expectInvalid(() => parseRunV1(invalid));
    }
  });

  it("requires RFC 3339 timestamps with explicit offsets", async () => {
    const run = await loadFixture("run-v1.json");
    for (const timestamp of [
      "2026-07-18T12:00:00",
      "2026-02-30T12:00:00Z",
      "not-a-timestamp",
    ]) {
      expectInvalid(() => parseRunV1({ ...run, created_at: timestamp }));
    }
  });

  it("enforces Git SHA, content hash, integer, sequence, and confidence rules", async () => {
    const run = await loadFixture("run-v1.json");
    expectInvalid(() =>
      parseRunV1({ ...run, base_commit_sha: "A".repeat(40) }),
    );
    expectInvalid(() => parseRunV1({ ...run, configuration_version: 0 }));

    const transaction = await loadFixture("transaction-v1.json");
    expectInvalid(() =>
      parseTransactionV1({
        ...transaction,
        prepared_patch_hash: "b".repeat(64),
      }),
    );

    const event = await loadFixture("ledger-event-envelope-v1.json");
    expectInvalid(() =>
      parseLedgerEventEnvelopeV1({ ...event, sequence: 1.5 }),
    );

    const conflict = await loadFixture("conflict-v1.json");
    for (const confidence of [-0.1, 1.1, Number.POSITIVE_INFINITY]) {
      expectInvalid(() => parseConflictV1({ ...conflict, confidence }));
    }
  });

  it("accepts recursive JSON and rejects non-JSON ledger payload values", async () => {
    const event = await loadFixture("ledger-event-envelope-v1.json");
    expect(
      parseLedgerEventEnvelopeV1({
        ...event,
        payload: { nested: [null, true, 1, "text", { child: [] }] },
      }),
    ).toBeDefined();
    for (const invalidValue of [
      undefined,
      Number.NaN,
      Number.POSITIVE_INFINITY,
      1n,
      Symbol("invalid"),
      () => undefined,
    ]) {
      expectInvalid(() =>
        parseLedgerEventEnvelopeV1({
          ...event,
          payload: { invalid: invalidValue },
        }),
      );
    }

    const symbolKey = Symbol("invalid");
    expectInvalid(() =>
      parseLedgerEventEnvelopeV1({
        ...event,
        payload: { [symbolKey]: "not-json" },
      }),
    );
    expectInvalid(() =>
      parseLedgerEventEnvelopeV1({ ...event, payload: new Date() }),
    );
    const cyclicPayload: Record<string, unknown> = {};
    cyclicPayload.self = cyclicPayload;
    expectInvalid(() =>
      parseLedgerEventEnvelopeV1({ ...event, payload: cyclicPayload }),
    );
  });

  it("enforces unique primitive and resource-selector arrays", async () => {
    const ticket = await loadFixture("ticket-v1.json");
    expectInvalid(() =>
      parseTicketV1({ ...ticket, dependencies: ["ticket-0", "ticket-0"] }),
    );

    const intent = await loadFixture("intent-contract-v1.json");
    const reads = intent.reads as unknown[];
    const writes = intent.writes as unknown[];
    for (const [field, values] of [
      ["reads", reads],
      ["writes", writes],
    ] as const) {
      expectInvalid(() =>
        parseIntentContractV1({
          ...intent,
          [field]: [values[0], values[0]],
        }),
      );
    }
    expectInvalid(() =>
      parseIntentContractV1({
        ...intent,
        required_validations: ["contracts-unit", "contracts-unit"],
      }),
    );
    const declaredEffects = clone(
      intent.declared_effects as Record<string, unknown>[],
    );
    const effectResources = declaredEffects[0]?.resources as unknown[];
    (declaredEffects[0] as Record<string, unknown>).resources = [
      effectResources[0],
      effectResources[0],
    ];
    expectInvalid(() =>
      parseIntentContractV1({ ...intent, declared_effects: declaredEffects }),
    );

    const conflict = await loadFixture("conflict-v1.json");
    const conflictResources = conflict.involved_resources as unknown[];
    for (const [field, values] of [
      ["involved_transactions", ["transaction-1", "transaction-1"]],
      ["involved_resources", [conflictResources[0], conflictResources[0]]],
      ["evidence_event_ids", ["event-1", "event-1"]],
    ] as const) {
      expectInvalid(() => parseConflictV1({ ...conflict, [field]: values }));
    }

    const causal = await loadFixture("causal-finding-v1.json");
    expectInvalid(() =>
      parseCausalFindingV1({
        ...causal,
        evidence_event_ids: ["event-1", "event-1"],
      }),
    );

    const guardrail = await loadFixture("guardrail-v1.json");
    expectInvalid(() =>
      parseGuardrailV1({
        ...guardrail,
        evidence_requirement: {
          event_types: ["validation.completed", "validation.completed"],
          minimum_count: 1,
        },
      }),
    );
  });
});

describe("explicit null and conditional invariants", () => {
  it("accepts null and rejects undefined for every nullable top-level field", async () => {
    const nullCases: readonly [string, Parser, readonly string[]][] = [
      ["run-v1.json", parseRunV1, ["started_at", "completed_at"]],
      [
        "agent-assignment-v1.json",
        parseAgentAssignmentV1,
        ["worktree_id", "released_at"],
      ],
      [
        "transaction-v1.json",
        parseTransactionV1,
        ["prepared_patch_hash", "completed_at"],
      ],
      [
        "ledger-event-envelope-v1.json",
        parseLedgerEventEnvelopeV1,
        [
          "ticket_id",
          "assignment_id",
          "transaction_id",
          "correlation_id",
          "causation_id",
        ],
      ],
      [
        "validation-result-v1.json",
        parseValidationResultV1,
        ["exit_code", "output_artifact", "completed_at"],
      ],
      [
        "guardrail-v1.json",
        parseGuardrailV1,
        ["created_from_failure_report_id", "evaluation_summary"],
      ],
    ];

    for (const [fixtureName, parser, fields] of nullCases) {
      const fixture = await loadFixture(fixtureName);
      for (const field of fields) {
        expect(parser({ ...fixture, [field]: null })).toBeDefined();
        expectInvalid(() => parser({ ...fixture, [field]: undefined }));
      }
    }
  });

  it("requires non-null ledger run ownership", async () => {
    const event = await loadFixture("ledger-event-envelope-v1.json");
    expectInvalid(() => parseLedgerEventEnvelopeV1({ ...event, run_id: null }));
  });

  it("requires null expected_version when an assumption has no resource", async () => {
    const intent = await loadFixture("intent-contract-v1.json");
    const assumption = (
      intent.assumptions as Record<string, unknown>[]
    )[0] as Record<string, unknown>;
    expectInvalid(() =>
      parseIntentContractV1({
        ...intent,
        assumptions: [{ ...assumption, expected_version: "v1" }],
      }),
    );

    const resource = await loadFixture("resource-selector-v1.json");
    expect(
      parseIntentContractV1({
        ...intent,
        assumptions: [{ ...assumption, resource, expected_version: "v1" }],
      }),
    ).toBeDefined();
    expect(
      parseIntentContractV1({
        ...intent,
        assumptions: [{ ...assumption, resource, expected_version: null }],
      }),
    ).toBeDefined();
  });

  it("enforces validation scope identifier ownership", async () => {
    const validation = await loadFixture("validation-result-v1.json");
    expectInvalid(() =>
      parseValidationResultV1({ ...validation, run_id: "run-1" }),
    );
    expect(
      parseValidationResultV1({
        ...validation,
        scope: "integration",
        transaction_id: null,
        run_id: "run-1",
      }),
    ).toBeDefined();
    expectInvalid(() =>
      parseValidationResultV1({
        ...validation,
        scope: "integration",
        transaction_id: "transaction-1",
        run_id: "run-1",
      }),
    );
  });

  it("enforces deterministic and inferred causal edge metadata", async () => {
    const causal = await loadFixture("causal-finding-v1.json");
    expectInvalid(() =>
      parseCausalFindingV1({ ...causal, evidence_event_ids: [] }),
    );
    expectInvalid(() =>
      parseCausalFindingV1({ ...causal, analyzer_version: null }),
    );
    expect(
      parseCausalFindingV1({
        ...causal,
        provenance: "deterministic",
        confidence: null,
        analyzer_version: null,
        evidence_event_ids: [],
      }),
    ).toBeDefined();
    expectInvalid(() =>
      parseCausalFindingV1({
        ...causal,
        provenance: "deterministic",
        confidence: 1,
        analyzer_version: null,
      }),
    );
  });

  it("requires non-empty recursive predicates and evidence requirements", async () => {
    const guardrail = await loadFixture("guardrail-v1.json");
    expectInvalid(() =>
      parseGuardrailV1({ ...guardrail, predicate: { all: [] } }),
    );
    expectInvalid(() =>
      parseGuardrailV1({
        ...guardrail,
        evidence_requirement: { event_types: [], minimum_count: 1 },
      }),
    );
  });
});

describe("enum rejection", () => {
  it("rejects unknown values for every contract enum boundary", async () => {
    const run = await loadFixture("run-v1.json");
    const ticket = await loadFixture("ticket-v1.json");
    const assignment = await loadFixture("agent-assignment-v1.json");
    const resource = await loadFixture("resource-selector-v1.json");
    const transaction = await loadFixture("transaction-v1.json");
    const validation = await loadFixture("validation-result-v1.json");
    const conflict = await loadFixture("conflict-v1.json");
    const causal = await loadFixture("causal-finding-v1.json");
    const guardrail = await loadFixture("guardrail-v1.json");

    expectInvalid(() => parseRunV1({ ...run, status: "unknown" }));
    expectInvalid(() => parseTicketV1({ ...ticket, status: "unknown" }));
    expectInvalid(() =>
      parseAgentAssignmentV1({ ...assignment, status: "unknown" }),
    );
    expectInvalid(() =>
      parseResourceSelectorV1({ ...resource, kind: "unknown" }),
    );
    expectInvalid(() =>
      parseTransactionV1({ ...transaction, status: "unknown" }),
    );
    expectInvalid(() =>
      parseValidationResultV1({ ...validation, status: "unknown" }),
    );
    expectInvalid(() =>
      parseValidationResultV1({ ...validation, scope: "unknown" }),
    );
    for (const field of [
      "severity",
      "decision",
      "resolution_status",
    ] as const) {
      expectInvalid(() => parseConflictV1({ ...conflict, [field]: "unknown" }));
    }
    for (const field of ["finding_type", "kind", "provenance"] as const) {
      expectInvalid(() =>
        parseCausalFindingV1({ ...causal, [field]: "unknown" }),
      );
    }
    for (const field of ["decision", "status"] as const) {
      expectInvalid(() =>
        parseGuardrailV1({ ...guardrail, [field]: "unknown" }),
      );
    }
    expectInvalid(() =>
      parseGuardrailV1({
        ...guardrail,
        scope: { resource_kind: "unknown" },
      }),
    );
  });

  it("rejects an unknown nested assumption severity", async () => {
    const intent = await loadFixture("intent-contract-v1.json");
    const assumptions = clone(intent.assumptions as Record<string, unknown>[]);
    setPath(
      assumptions[0] as Record<string, unknown>,
      ["severity_if_invalid"],
      "unknown",
    );
    expectInvalid(() => parseIntentContractV1({ ...intent, assumptions }));
  });
});
