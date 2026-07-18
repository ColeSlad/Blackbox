import {
  InvalidSchemaError,
  UnsupportedSchemaVersionError,
  type IssuePath,
  type IssuePathSegment,
} from "@blackbox/domain";
import Compile from "typebox/compile";
import type Type from "typebox";

import {
  AgentAssignmentV1Schema,
  CausalFindingV1Schema,
  ConflictV1Schema,
  GuardrailV1Schema,
  IntentContractV1Schema,
  LedgerEventEnvelopeV1Schema,
  ResourceSelectorV1Schema,
  RunV1Schema,
  TicketV1Schema,
  TransactionV1Schema,
  ValidationResultV1Schema,
} from "./schemas.js";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

type VersionCheck = "valid" | "invalid" | "unsupported";

function readSchemaVersion(
  value: unknown,
): { hasSchemaVersion: boolean; schemaVersion: unknown } | undefined {
  try {
    if (!isRecord(value)) {
      return undefined;
    }
    return {
      hasSchemaVersion: Object.hasOwn(value, "schema_version"),
      schemaVersion: value.schema_version,
    };
  } catch {
    return undefined;
  }
}

function checkVersionOne(value: unknown): VersionCheck {
  const versionRead = readSchemaVersion(value);
  if (
    versionRead === undefined ||
    !versionRead.hasSchemaVersion ||
    typeof versionRead.schemaVersion !== "number" ||
    !Number.isInteger(versionRead.schemaVersion)
  ) {
    return "invalid";
  }
  return versionRead.schemaVersion === 1 ? "valid" : "unsupported";
}

function decodePointerSegment(segment: string): IssuePathSegment {
  const decoded = segment.replaceAll("~1", "/").replaceAll("~0", "~");
  return /^(?:0|[1-9][0-9]*)$/.test(decoded) ? Number(decoded) : decoded;
}

function issuePath(instancePath: string): IssuePath {
  if (instancePath === "") {
    return [];
  }
  return instancePath.split("/").slice(1).map(decodePointerSegment);
}

function uniqueIssuePaths(instancePaths: readonly string[]): IssuePath[] {
  const paths = instancePaths.map(issuePath);
  if (paths.length === 0) {
    return [[]];
  }
  const seen = new Set<string>();
  return paths.filter((path) => {
    const key = JSON.stringify(path);
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function createParser<const Schema extends Type.TSchema>(
  schema: Schema,
  precheck?: (value: Record<string, unknown>) => boolean,
) {
  const validator = Compile(schema);
  return (value: unknown): Type.Static<Schema> => {
    const versionCheck = checkVersionOne(value);
    if (versionCheck === "invalid") {
      throw new InvalidSchemaError([["schema_version"]]);
    }
    if (versionCheck === "unsupported") {
      throw new UnsupportedSchemaVersionError();
    }

    if (precheck !== undefined) {
      if (!runPrecheck(value, precheck)) {
        throw new InvalidSchemaError([["payload"]]);
      }
    }

    let checkResult: boolean | undefined;
    try {
      checkResult = validator.Check(value);
    } catch {
      checkResult = undefined;
    }
    if (checkResult === true) {
      return value as Type.Static<Schema>;
    }
    if (checkResult === undefined) {
      throw new InvalidSchemaError([[]]);
    }

    let issuePaths: IssuePath[] | undefined;
    try {
      issuePaths = uniqueIssuePaths(
        validator.Errors(value).map((error) => error.instancePath),
      );
    } catch {
      issuePaths = undefined;
    }
    if (issuePaths === undefined) {
      throw new InvalidSchemaError([[]]);
    }
    throw new InvalidSchemaError(issuePaths);
  };
}

function runPrecheck(
  value: unknown,
  precheck: (value: Record<string, unknown>) => boolean,
): boolean {
  try {
    return isRecord(value) && precheck(value);
  } catch {
    return false;
  }
}

function isJsonValue(value: unknown, ancestors = new Set<object>()): boolean {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean" ||
    (typeof value === "number" && Number.isFinite(value))
  ) {
    return true;
  }
  if (typeof value !== "object" || ancestors.has(value)) {
    return false;
  }

  ancestors.add(value);
  const valid = Array.isArray(value)
    ? value.every((item) => isJsonValue(item, ancestors))
    : isJsonObject(value, ancestors);
  ancestors.delete(value);
  return valid;
}

function isJsonObject(value: object, ancestors: Set<object>): boolean {
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    return false;
  }
  return Reflect.ownKeys(value).every((key) => {
    if (typeof key !== "string") {
      return false;
    }
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    return (
      descriptor !== undefined &&
      descriptor.enumerable &&
      "value" in descriptor &&
      isJsonValue(descriptor.value, ancestors)
    );
  });
}

export const parseRunV1 = createParser(RunV1Schema);
export const parseTicketV1 = createParser(TicketV1Schema);
export const parseAgentAssignmentV1 = createParser(AgentAssignmentV1Schema);
export const parseIntentContractV1 = createParser(IntentContractV1Schema);
export const parseResourceSelectorV1 = createParser(ResourceSelectorV1Schema);
export const parseTransactionV1 = createParser(TransactionV1Schema);
export const parseLedgerEventEnvelopeV1 = createParser(
  LedgerEventEnvelopeV1Schema,
  (value) =>
    typeof value.payload === "object" &&
    value.payload !== null &&
    !Array.isArray(value.payload) &&
    isJsonValue(value.payload),
);
export const parseValidationResultV1 = createParser(ValidationResultV1Schema);
export const parseConflictV1 = createParser(ConflictV1Schema);
export const parseCausalFindingV1 = createParser(CausalFindingV1Schema);
export const parseGuardrailV1 = createParser(GuardrailV1Schema);
