export interface RepositoryBindingConfiguration {
  readonly repository_id: string;
  readonly working_tree_root: string;
  readonly common_git_directory: string;
  readonly default_branch: string;
}

export interface WorktreeConfiguration {
  readonly managed_root: string;
  readonly repositories: readonly RepositoryBindingConfiguration[];
}

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[]) {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return (
    actual.length === expected.length &&
    actual.every((key, index) => key === expected[index])
  );
}

function requiredString(value: unknown, name: string): string {
  if (typeof value !== "string" || !/\S/.test(value)) {
    throw new Error(`${name} must be configured.`);
  }
  return value;
}

function parseBinding(value: unknown): RepositoryBindingConfiguration {
  if (
    !isRecord(value) ||
    !exactKeys(value, [
      "common_git_directory",
      "default_branch",
      "repository_id",
      "working_tree_root",
    ])
  ) {
    throw new Error("BLACKBOX_REPOSITORY_BINDINGS is invalid.");
  }
  const repositoryId = requiredString(value.repository_id, "repository_id");
  if (!UUID_PATTERN.test(repositoryId)) {
    throw new Error("repository_id must be a canonical lowercase UUID.");
  }
  return Object.freeze({
    repository_id: repositoryId,
    working_tree_root: requiredString(
      value.working_tree_root,
      "working_tree_root",
    ),
    common_git_directory: requiredString(
      value.common_git_directory,
      "common_git_directory",
    ),
    default_branch: requiredString(value.default_branch, "default_branch"),
  });
}

export function readWorktreeConfiguration(
  environment: NodeJS.ProcessEnv = process.env,
): WorktreeConfiguration {
  const managedRoot = requiredString(
    environment.BLACKBOX_WORKTREE_ROOT,
    "BLACKBOX_WORKTREE_ROOT",
  );
  const serialized = requiredString(
    environment.BLACKBOX_REPOSITORY_BINDINGS,
    "BLACKBOX_REPOSITORY_BINDINGS",
  );
  let value: unknown;
  try {
    value = JSON.parse(serialized);
  } catch {
    throw new Error("BLACKBOX_REPOSITORY_BINDINGS must be valid JSON.");
  }
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error("BLACKBOX_REPOSITORY_BINDINGS must be a non-empty array.");
  }
  const repositories = value.map(parseBinding);
  if (
    new Set(repositories.map(({ repository_id }) => repository_id)).size !==
    repositories.length
  ) {
    throw new Error("Repository IDs must be unique.");
  }
  return Object.freeze({
    managed_root: managedRoot,
    repositories: Object.freeze(repositories),
  });
}
