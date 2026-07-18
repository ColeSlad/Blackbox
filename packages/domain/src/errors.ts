export const ERROR_CODES = Object.freeze({
  invalidSchema: "INVALID_SCHEMA",
  unsupportedSchemaVersion: "UNSUPPORTED_SCHEMA_VERSION",
  invalidStateTransition: "INVALID_STATE_TRANSITION",
} as const);

export type ErrorCode = (typeof ERROR_CODES)[keyof typeof ERROR_CODES];
export type IssuePathSegment = string | number;
export type IssuePath = readonly IssuePathSegment[];

function freezeIssuePaths(paths: readonly IssuePath[]): readonly IssuePath[] {
  return Object.freeze(paths.map((path) => Object.freeze([...path])));
}

export class InvalidSchemaError extends Error {
  readonly code = ERROR_CODES.invalidSchema;
  readonly issuePaths: readonly IssuePath[];

  constructor(issuePaths: readonly IssuePath[] = [[]]) {
    super("Contract schema validation failed");
    this.name = "InvalidSchemaError";
    this.issuePaths = freezeIssuePaths(issuePaths);
  }
}

export class UnsupportedSchemaVersionError extends Error {
  readonly code = ERROR_CODES.unsupportedSchemaVersion;
  readonly issuePaths: readonly IssuePath[];

  constructor() {
    super("Unsupported contract schema version");
    this.name = "UnsupportedSchemaVersionError";
    this.issuePaths = freezeIssuePaths([["schema_version"]]);
  }
}

export class InvalidStateTransitionError extends Error {
  readonly code = ERROR_CODES.invalidStateTransition;

  constructor(
    readonly currentState: string,
    readonly targetState: string,
  ) {
    super(`Invalid state transition: ${currentState} -> ${targetState}`);
    this.name = "InvalidStateTransitionError";
  }
}
