export const GIT_ERROR_CODES = Object.freeze({
  pathInvalid: "GIT_PATH_INVALID",
  notRepository: "GIT_NOT_REPOSITORY",
  bareRepository: "GIT_BARE_REPOSITORY",
  unbornRepository: "GIT_UNBORN_REPOSITORY",
  defaultBranchInvalid: "GIT_DEFAULT_BRANCH_INVALID",
  defaultBranchMissing: "GIT_DEFAULT_BRANCH_MISSING",
  branchInvalid: "GIT_BRANCH_INVALID",
  branchExists: "GIT_BRANCH_EXISTS",
  shaInvalid: "GIT_SHA_INVALID",
  shaUnavailable: "GIT_SHA_UNAVAILABLE",
  executableMissing: "GIT_EXECUTABLE_MISSING",
  unsupportedGit: "GIT_UNSUPPORTED",
  unsupportedRepository: "GIT_UNSUPPORTED_REPOSITORY",
  unsupportedPath: "GIT_UNSUPPORTED_PATH",
  outputLimit: "GIT_OUTPUT_LIMIT",
  operationFailed: "GIT_OPERATION_FAILED",
} as const);

export type GitErrorCode =
  (typeof GIT_ERROR_CODES)[keyof typeof GIT_ERROR_CODES];

const ERROR_MESSAGES: Readonly<Record<GitErrorCode, string>> = Object.freeze({
  [GIT_ERROR_CODES.pathInvalid]: "Repository path is invalid.",
  [GIT_ERROR_CODES.notRepository]: "Path is not a Git working tree.",
  [GIT_ERROR_CODES.bareRepository]: "Bare Git repositories are unsupported.",
  [GIT_ERROR_CODES.unbornRepository]:
    "Unborn Git repositories are unsupported.",
  [GIT_ERROR_CODES.defaultBranchInvalid]: "Default branch name is invalid.",
  [GIT_ERROR_CODES.defaultBranchMissing]: "Default branch does not exist.",
  [GIT_ERROR_CODES.branchInvalid]: "Branch name is invalid.",
  [GIT_ERROR_CODES.branchExists]: "Branch already exists.",
  [GIT_ERROR_CODES.shaInvalid]: "Commit SHA is invalid.",
  [GIT_ERROR_CODES.shaUnavailable]: "Commit SHA is unavailable.",
  [GIT_ERROR_CODES.executableMissing]: "Native Git executable is unavailable.",
  [GIT_ERROR_CODES.unsupportedGit]:
    "Installed Git lacks a required capability.",
  [GIT_ERROR_CODES.unsupportedRepository]:
    "Repository configuration or state is unsupported.",
  [GIT_ERROR_CODES.unsupportedPath]: "Repository path encoding is unsupported.",
  [GIT_ERROR_CODES.outputLimit]: "Git output exceeded the configured limit.",
  [GIT_ERROR_CODES.operationFailed]: "Git operation failed.",
});

const trustedErrorToken = Symbol("trusted-git-error");
const trustedErrors = new WeakMap<object, SafeGitError>();

export interface SafeGitError {
  readonly code: GitErrorCode;
  readonly message: string;
}

export class GitError extends Error {
  readonly code: GitErrorCode;

  constructor(code: GitErrorCode, message: string, token?: symbol) {
    super(message);
    this.name = "GitError";
    this.code = code;
    if (token === trustedErrorToken) {
      trustedErrors.set(this, Object.freeze({ code, message }));
      Object.freeze(this);
    }
  }
}

export function gitError(code: GitErrorCode): GitError {
  return new GitError(code, ERROR_MESSAGES[code], trustedErrorToken);
}

export function safeGitError(value: unknown): SafeGitError | undefined {
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

export function trustedGitError(value: unknown): GitError | undefined {
  return safeGitError(value) === undefined ? undefined : (value as GitError);
}
