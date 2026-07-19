export const APPLICATION_ERROR_CODES = Object.freeze({
  INVALID_INPUT: "INVALID_INPUT",
  NOT_FOUND: "NOT_FOUND",
  CONFLICT: "CONFLICT",
  INVALID_TRANSITION: "INVALID_TRANSITION",
  DEFERRED: "DEFERRED",
} as const);

export type ApplicationErrorCode =
  (typeof APPLICATION_ERROR_CODES)[keyof typeof APPLICATION_ERROR_CODES];

export class ApplicationError extends Error {
  constructor(
    readonly code: ApplicationErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "ApplicationError";
    Object.freeze(this);
  }
}

export function invalidInput(
  message = "The request is invalid.",
): ApplicationError {
  return new ApplicationError(APPLICATION_ERROR_CODES.INVALID_INPUT, message);
}

export function notFound(): ApplicationError {
  return new ApplicationError(
    APPLICATION_ERROR_CODES.NOT_FOUND,
    "The requested lifecycle record was not found.",
  );
}

export function conflict(message: string): ApplicationError {
  return new ApplicationError(APPLICATION_ERROR_CODES.CONFLICT, message);
}

export function invalidTransition(): ApplicationError {
  return new ApplicationError(
    APPLICATION_ERROR_CODES.INVALID_TRANSITION,
    "The requested lifecycle transition is not allowed.",
  );
}

export function deferred(): ApplicationError {
  return new ApplicationError(
    APPLICATION_ERROR_CODES.DEFERRED,
    "Execution activation is deferred until isolated worktree proof is available.",
  );
}
