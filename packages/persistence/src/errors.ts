export const PERSISTENCE_ERROR_CODES = Object.freeze({
  CONFIGURATION_INVALID: "PERSISTENCE_CONFIGURATION_INVALID",
  CONNECTION_FAILED: "PERSISTENCE_CONNECTION_FAILED",
  QUERY_FAILED: "PERSISTENCE_QUERY_FAILED",
  CONSTRAINT_VIOLATION: "PERSISTENCE_CONSTRAINT_VIOLATION",
  RESET_REFUSED: "PERSISTENCE_RESET_REFUSED",
  MIGRATION_INVALID: "MIGRATION_INVALID",
  MIGRATION_CHECKSUM_CHANGED: "MIGRATION_CHECKSUM_CHANGED",
  MIGRATION_FILE_MISSING: "MIGRATION_FILE_MISSING",
  MIGRATION_FUTURE_VERSION: "MIGRATION_FUTURE_VERSION",
} as const);

export type PersistenceErrorCode =
  (typeof PERSISTENCE_ERROR_CODES)[keyof typeof PERSISTENCE_ERROR_CODES];

const trustedErrorToken = Symbol("trusted-persistence-error");
const trustedErrors = new WeakMap<object, SafePersistenceError>();

export interface SafePersistenceError {
  readonly code: PersistenceErrorCode;
  readonly message: string;
}

export class PersistenceError extends Error {
  readonly code: PersistenceErrorCode;

  constructor(code: PersistenceErrorCode, message: string, token?: symbol) {
    super(message);
    this.name = "PersistenceError";
    this.code = code;
    if (token === trustedErrorToken) {
      trustedErrors.set(this, Object.freeze({ code, message }));
      Object.freeze(this);
    }
  }
}

function trustedError(
  code: PersistenceErrorCode,
  message: string,
): PersistenceError {
  return new PersistenceError(code, message, trustedErrorToken);
}

export function safePersistenceError(
  value: unknown,
): SafePersistenceError | undefined {
  try {
    if (
      (typeof value !== "object" && typeof value !== "function") ||
      value === null
    ) {
      return undefined;
    }
    return trustedErrors.get(value);
  } catch {
    return undefined;
  }
}

export function trustedPersistenceError(
  value: unknown,
): PersistenceError | undefined {
  return safePersistenceError(value) === undefined
    ? undefined
    : (value as PersistenceError);
}

export function configurationError(): PersistenceError {
  return trustedError(
    PERSISTENCE_ERROR_CODES.CONFIGURATION_INVALID,
    "Database configuration is invalid.",
  );
}

export function connectionError(): PersistenceError {
  return trustedError(
    PERSISTENCE_ERROR_CODES.CONNECTION_FAILED,
    "Database connection failed.",
  );
}

export function queryError(isConstraintViolation = false): PersistenceError {
  return trustedError(
    isConstraintViolation
      ? PERSISTENCE_ERROR_CODES.CONSTRAINT_VIOLATION
      : PERSISTENCE_ERROR_CODES.QUERY_FAILED,
    isConstraintViolation
      ? "Database constraint rejected the operation."
      : "Database operation failed.",
  );
}

export function queryErrorFromCaught(value: unknown): PersistenceError {
  let isConstraintViolation = false;
  try {
    if (
      (typeof value === "object" || typeof value === "function") &&
      value !== null
    ) {
      const code = Reflect.get(value, "code") as unknown;
      isConstraintViolation = typeof code === "string" && code.startsWith("23");
    }
  } catch {
    isConstraintViolation = false;
  }
  return queryError(isConstraintViolation);
}

export function migrationError(
  code:
    | typeof PERSISTENCE_ERROR_CODES.MIGRATION_INVALID
    | typeof PERSISTENCE_ERROR_CODES.MIGRATION_CHECKSUM_CHANGED
    | typeof PERSISTENCE_ERROR_CODES.MIGRATION_FILE_MISSING
    | typeof PERSISTENCE_ERROR_CODES.MIGRATION_FUTURE_VERSION,
): PersistenceError {
  switch (code) {
    case PERSISTENCE_ERROR_CODES.MIGRATION_CHECKSUM_CHANGED:
      return trustedError(code, "An applied migration checksum has changed.");
    case PERSISTENCE_ERROR_CODES.MIGRATION_FILE_MISSING:
      return trustedError(code, "An applied migration file is missing.");
    case PERSISTENCE_ERROR_CODES.MIGRATION_FUTURE_VERSION:
      return trustedError(
        code,
        "Database contains an unknown future migration version.",
      );
    default:
      return trustedError(
        PERSISTENCE_ERROR_CODES.MIGRATION_INVALID,
        "Migration state is invalid.",
      );
  }
}

export function resetRefusedError(): PersistenceError {
  return trustedError(
    PERSISTENCE_ERROR_CODES.RESET_REFUSED,
    "Development database reset refused: use a local host and --confirm-reset.",
  );
}
