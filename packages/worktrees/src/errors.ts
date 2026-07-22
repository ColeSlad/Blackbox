export const WORKTREE_ERROR_CODES = Object.freeze({
  INVALID_INPUT: "WORKTREE_INVALID_INPUT",
  NOT_FOUND: "WORKTREE_NOT_FOUND",
  BINDING_MISSING: "WORKTREE_BINDING_MISSING",
  BINDING_DRIFT: "WORKTREE_BINDING_DRIFT",
  COLLISION: "WORKTREE_COLLISION",
  INCONSISTENT_STATE: "WORKTREE_INCONSISTENT_STATE",
  CONFLICT: "WORKTREE_CONFLICT",
  DIRTY: "WORKTREE_DIRTY",
  OPERATION_FAILED: "WORKTREE_OPERATION_FAILED",
} as const);

export type WorktreeErrorCode =
  (typeof WORKTREE_ERROR_CODES)[keyof typeof WORKTREE_ERROR_CODES];

const messages: Readonly<Record<WorktreeErrorCode, string>> = Object.freeze({
  [WORKTREE_ERROR_CODES.INVALID_INPUT]: "The worktree request is invalid.",
  [WORKTREE_ERROR_CODES.NOT_FOUND]: "The assignment worktree was not found.",
  [WORKTREE_ERROR_CODES.BINDING_MISSING]:
    "The repository binding is unavailable.",
  [WORKTREE_ERROR_CODES.BINDING_DRIFT]:
    "The repository binding identity has changed.",
  [WORKTREE_ERROR_CODES.COLLISION]:
    "A managed worktree resource is already occupied.",
  [WORKTREE_ERROR_CODES.INCONSISTENT_STATE]:
    "The managed worktree state is inconsistent.",
  [WORKTREE_ERROR_CODES.CONFLICT]:
    "The worktree operation conflicts with its lifecycle state.",
  [WORKTREE_ERROR_CODES.DIRTY]: "The managed worktree contains changes.",
  [WORKTREE_ERROR_CODES.OPERATION_FAILED]: "The worktree operation failed.",
});

const trusted = new WeakSet<object>();

export class WorktreeError extends Error {
  constructor(readonly code: WorktreeErrorCode) {
    super(messages[code]);
    this.name = "WorktreeError";
    trusted.add(this);
    Object.freeze(this);
  }
}

export function worktreeError(code: WorktreeErrorCode): WorktreeError {
  return new WorktreeError(code);
}

export function safeWorktreeError(
  value: unknown,
): { readonly code: WorktreeErrorCode; readonly message: string } | undefined {
  if (
    (typeof value !== "object" && typeof value !== "function") ||
    value === null ||
    !trusted.has(value)
  ) {
    return undefined;
  }
  const error = value as WorktreeError;
  return Object.freeze({ code: error.code, message: error.message });
}
