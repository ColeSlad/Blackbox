import { spawnSync } from "node:child_process";
import { accessSync, constants, realpathSync } from "node:fs";
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, dirname, join } from "node:path";

const GIT_TEST_ENVIRONMENT = Object.freeze({
  ...process.env,
  GIT_AUTHOR_DATE: "2026-07-18T12:00:00Z",
  GIT_COMMITTER_DATE: "2026-07-18T12:00:00Z",
  GIT_CONFIG_NOSYSTEM: "1",
  GIT_TERMINAL_PROMPT: "0",
  LC_ALL: "C",
});

export interface TestRepository {
  readonly parent: string;
  readonly root: string;
  readonly initialCommit: string;
}

export function runGit(
  root: string,
  arguments_: readonly string[],
  input?: Uint8Array,
): Buffer {
  const result = spawnSync("git", ["-C", root, ...arguments_], {
    encoding: "buffer",
    env: GIT_TEST_ENVIRONMENT,
    input,
    maxBuffer: 64 * 1024 * 1024,
    shell: false,
  });
  if (result.error !== undefined || result.status !== 0) {
    throw new Error(
      `Test Git command failed with status ${String(result.status)}`,
    );
  }
  return result.stdout;
}

export function nativeGitExecutable(): string {
  for (const directory of (process.env.PATH ?? "").split(delimiter)) {
    if (directory.length === 0) {
      continue;
    }
    const candidate = join(directory, "git");
    try {
      accessSync(candidate, constants.X_OK);
      return realpathSync(candidate);
    } catch {
      continue;
    }
  }
  throw new Error("Test Git executable is unavailable");
}

export async function createTestRepository(
  name = "repository with spaces",
  objectFormat: "sha1" | "sha256" = "sha1",
): Promise<TestRepository> {
  const parent = await mkdtemp(join(tmpdir(), "blackbox-git-test-"));
  const root = join(parent, name);
  await mkdir(root, { recursive: true });
  runGit(root, [
    "init",
    "--quiet",
    "--initial-branch=main",
    `--object-format=${objectFormat}`,
  ]);
  runGit(root, ["config", "user.name", "Blackbox Test"]);
  runGit(root, ["config", "user.email", "blackbox@example.invalid"]);
  await writeFile(join(root, "tracked.txt"), "tracked\n");
  runGit(root, ["add", "--", "tracked.txt"]);
  runGit(root, ["commit", "--quiet", "-m", "initial"]);
  return Object.freeze({
    parent,
    root,
    initialCommit: gitText(root, ["rev-parse", "HEAD"]),
  });
}

export async function removeTestRepository(
  repository: Pick<TestRepository, "parent">,
): Promise<void> {
  await rm(repository.parent, { force: true, recursive: true });
}

export function gitText(root: string, arguments_: readonly string[]): string {
  return runGit(root, arguments_).toString("utf8").trim();
}

export async function writeRepositoryFile(
  root: string,
  path: string,
  content: string | Uint8Array,
): Promise<void> {
  const absolutePath = join(root, path);
  await mkdir(dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, content);
}

export async function seedPatchFixture(repository: TestRepository): Promise<{
  readonly indexBefore: Buffer;
  readonly statusBefore: Buffer;
}> {
  const { root } = repository;
  await writeRepositoryFile(root, "staged.txt", "before staged\n");
  await writeRepositoryFile(root, "unstaged.txt", "before unstaged\n");
  await writeRepositoryFile(root, "deleted.txt", "delete me\n");
  await writeRepositoryFile(root, "rename-old.txt", "rename content\n");
  await writeRepositoryFile(root, "executable.sh", "#!/bin/sh\necho before\n");
  await writeRepositoryFile(root, "binary.bin", new Uint8Array([0, 1, 2, 3]));
  await symlink("tracked.txt", join(root, "link"));
  await chmod(join(root, "executable.sh"), 0o644);
  runGit(root, ["add", "--", "."]);
  runGit(root, ["commit", "--quiet", "-m", "patch base"]);

  await writeRepositoryFile(root, "staged.txt", "after staged\n");
  runGit(root, ["add", "--", "staged.txt"]);
  await writeRepositoryFile(root, "unstaged.txt", "after unstaged\n");
  await rm(join(root, "deleted.txt"));
  await rm(join(root, "rename-old.txt"));
  await writeRepositoryFile(root, "rename-new.txt", "rename content\n");
  runGit(root, ["add", "-A", "--", "rename-old.txt", "rename-new.txt"]);
  await chmod(join(root, "executable.sh"), 0o755);
  await rm(join(root, "link"));
  await symlink("unstaged.txt", join(root, "link"));
  await writeRepositoryFile(
    root,
    "binary.bin",
    new Uint8Array([0, 255, 2, 254, 4]),
  );
  await writeRepositoryFile(root, "untracked.txt", "new file\n");

  return Object.freeze({
    indexBefore: await readFile(join(root, ".git", "index")),
    statusBefore: runGit(root, ["status", "--porcelain=v2", "-z"]),
  });
}
