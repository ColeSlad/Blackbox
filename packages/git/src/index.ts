export type {
  ChangedPath,
  CreatedBranch,
  GitAdapterOptions,
  GitChangeKind,
  GitEntryType,
  GitObjectFormat,
  GitPatchResult,
  GitRepository,
  RepositoryHead,
  RepositoryIdentity,
  RepositoryRegistration,
  RepositorySnapshot,
  RepositoryStatus,
  RegisteredWorktree,
} from "./contracts.js";
export {
  GIT_ERROR_CODES,
  GitError,
  safeGitError,
  trustedGitError,
  type GitErrorCode,
  type SafeGitError,
} from "./errors.js";
export { registerGitRepository } from "./native-git-repository.js";
