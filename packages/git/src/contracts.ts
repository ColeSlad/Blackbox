export type GitObjectFormat = "sha1" | "sha256";
export type GitEntryType =
  "regular" | "executable" | "symlink" | "gitlink" | "absent" | "unknown";
export type GitChangeKind =
  | "added"
  | "copied"
  | "deleted"
  | "modified"
  | "renamed"
  | "type_changed"
  | "unmerged";

export interface RepositoryIdentity {
  readonly workingTreeRoot: string;
  readonly commonGitDirectory: string;
}

export interface RepositoryHead {
  readonly commitSha: string;
  readonly attached: boolean;
  readonly currentBranch: string | null;
}

export interface ChangedPath {
  readonly path: string;
  readonly staged: boolean;
  readonly unstaged: boolean;
  readonly stagedChange: GitChangeKind | null;
  readonly unstagedChange: GitChangeKind | null;
  readonly deleted: boolean;
  readonly renamed: boolean;
  readonly renamedFrom: string | null;
  readonly typeChanged: boolean;
  readonly untracked: boolean;
  readonly entryType: GitEntryType;
}

export interface RepositoryStatus {
  readonly clean: boolean;
  readonly changedPaths: readonly ChangedPath[];
}

export interface RepositorySnapshot {
  readonly head: RepositoryHead;
  readonly status: RepositoryStatus;
}

export interface RepositoryRegistration extends RepositorySnapshot {
  readonly identity: RepositoryIdentity;
  readonly objectFormat: GitObjectFormat;
  readonly defaultBranch: string;
  readonly defaultBranchCommitSha: string;
}

export interface GitPatchResult {
  readonly baseCommitSha: string;
  readonly bytes: Uint8Array;
  readonly sha256: string;
}

export interface CreatedBranch {
  readonly name: string;
  readonly commitSha: string;
}

export interface GitAdapterOptions {
  readonly maxOutputBytes?: number;
}

export interface GitRepository {
  readonly registration: RepositoryRegistration;
  getHead(): Promise<RepositoryHead>;
  getStatus(): Promise<RepositoryStatus>;
  getDiff(baseCommitSha: string): Promise<Uint8Array>;
  createPatch(baseCommitSha: string): Promise<GitPatchResult>;
  createBranch(
    branchName: string,
    startCommitSha: string,
  ): Promise<CreatedBranch>;
}
