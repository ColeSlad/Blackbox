import { mkdir, realpath, stat } from "node:fs/promises";
import { isAbsolute, relative } from "node:path";

import type { WorktreeConfiguration } from "@blackbox/config";
import { registerGitRepository, type GitRepository } from "@blackbox/git";

import {
  WORKTREE_ERROR_CODES,
  WorktreeError,
  worktreeError,
} from "./errors.js";

export interface BoundRepository {
  readonly repositoryId: string;
  readonly managedRoot: string;
  readonly repository: GitRepository;
}

interface ValidatedBinding {
  readonly repositoryId: string;
  readonly workingTreeRoot: string;
  readonly commonGitDirectory: string;
  readonly defaultBranch: string;
}

type RegisterRepository = typeof registerGitRepository;

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

function assertCanonicalIdentifier(value: string): void {
  if (!UUID_PATTERN.test(value)) {
    throw worktreeError(WORKTREE_ERROR_CODES.INVALID_INPUT);
  }
}

function isWithin(root: string, candidate: string): boolean {
  const value = relative(root, candidate);
  return value !== ".." && !value.startsWith("../") && !isAbsolute(value);
}

async function canonicalDirectory(path: string): Promise<string> {
  try {
    const canonical = await realpath(path);
    if (!(await stat(canonical)).isDirectory()) {
      throw worktreeError(WORKTREE_ERROR_CODES.BINDING_DRIFT);
    }
    return canonical;
  } catch (error) {
    if (error instanceof WorktreeError) {
      throw error;
    }
    throw worktreeError(WORKTREE_ERROR_CODES.BINDING_DRIFT);
  }
}

export class RepositoryBindingRegistry {
  private constructor(
    readonly managedRoot: string,
    private readonly bindings: ReadonlyMap<string, ValidatedBinding>,
    private readonly register: RegisterRepository,
  ) {}

  static async create(
    configuration: WorktreeConfiguration,
    register: RegisterRepository = registerGitRepository,
  ): Promise<RepositoryBindingRegistry> {
    try {
      for (const configured of configuration.repositories) {
        assertCanonicalIdentifier(configured.repository_id);
      }
      if (
        new Set(
          configuration.repositories.map(({ repository_id }) => repository_id),
        ).size !== configuration.repositories.length
      ) {
        throw worktreeError(WORKTREE_ERROR_CODES.BINDING_DRIFT);
      }
      await mkdir(configuration.managed_root, { recursive: true });
      const managedRoot = await canonicalDirectory(configuration.managed_root);
      const bindings = new Map<string, ValidatedBinding>();
      const identities = new Set<string>();
      for (const configured of configuration.repositories) {
        const repository = await register(
          configured.working_tree_root,
          configured.default_branch,
        );
        const workingTreeRoot = await canonicalDirectory(
          configured.working_tree_root,
        );
        const commonGitDirectory = await canonicalDirectory(
          configured.common_git_directory,
        );
        if (
          repository.registration.identity.workingTreeRoot !==
            workingTreeRoot ||
          repository.registration.identity.commonGitDirectory !==
            commonGitDirectory ||
          repository.registration.defaultBranch !== configured.default_branch
        ) {
          throw worktreeError(WORKTREE_ERROR_CODES.BINDING_DRIFT);
        }
        if (
          isWithin(workingTreeRoot, managedRoot) ||
          isWithin(managedRoot, workingTreeRoot) ||
          isWithin(commonGitDirectory, managedRoot) ||
          isWithin(managedRoot, commonGitDirectory)
        ) {
          throw worktreeError(WORKTREE_ERROR_CODES.BINDING_DRIFT);
        }
        const identity = `${workingTreeRoot}\0${commonGitDirectory}`;
        if (
          bindings.has(configured.repository_id) ||
          identities.has(identity)
        ) {
          throw worktreeError(WORKTREE_ERROR_CODES.BINDING_DRIFT);
        }
        identities.add(identity);
        bindings.set(
          configured.repository_id,
          Object.freeze({
            repositoryId: configured.repository_id,
            workingTreeRoot,
            commonGitDirectory,
            defaultBranch: configured.default_branch,
          }),
        );
      }
      return new RepositoryBindingRegistry(managedRoot, bindings, register);
    } catch (error) {
      if (error instanceof WorktreeError) {
        throw error;
      }
      throw worktreeError(WORKTREE_ERROR_CODES.BINDING_DRIFT);
    }
  }

  async resolve(repositoryId: string): Promise<BoundRepository> {
    assertCanonicalIdentifier(repositoryId);
    const binding = this.bindings.get(repositoryId);
    if (binding === undefined) {
      throw worktreeError(WORKTREE_ERROR_CODES.BINDING_MISSING);
    }
    try {
      const repository = await this.register(
        binding.workingTreeRoot,
        binding.defaultBranch,
      );
      if (
        repository.registration.identity.workingTreeRoot !==
          binding.workingTreeRoot ||
        repository.registration.identity.commonGitDirectory !==
          binding.commonGitDirectory ||
        repository.registration.defaultBranch !== binding.defaultBranch ||
        (await canonicalDirectory(this.managedRoot)) !== this.managedRoot
      ) {
        throw worktreeError(WORKTREE_ERROR_CODES.BINDING_DRIFT);
      }
      return Object.freeze({
        repositoryId,
        managedRoot: this.managedRoot,
        repository,
      });
    } catch (error) {
      if (error instanceof WorktreeError) {
        throw error;
      }
      throw worktreeError(WORKTREE_ERROR_CODES.BINDING_DRIFT);
    }
  }
}
