import { spawnSync } from "node:child_process";
import {
  lstat,
  mkdir,
  mkdtemp,
  rename,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import type { WorktreeConfiguration } from "@blackbox/config";
import { registerGitRepository } from "@blackbox/git";
import { afterEach, describe, expect, it } from "vitest";

import type {
  AssignmentWorktreeV1,
  ProvisionReservation,
  WorktreeOutboxRecord,
  WorktreeOwnership,
  WorktreePersistence,
  WorktreeRetentionStatus,
} from "./contracts.js";
import { WORKTREE_ERROR_CODES } from "./errors.js";
import { RepositoryBindingRegistry } from "./repository-bindings.js";
import {
  WorktreeManager,
  type WorktreeFailpoint,
  type WorktreeManagerOptions,
} from "./worktree-manager.js";

const repositoryId = "10000000-0000-4000-8000-000000000001";
const runId = "20000000-0000-4000-8000-000000000001";
const ticketId = "30000000-0000-4000-8000-000000000001";
const assignmentId = "40000000-0000-4000-8000-000000000001";
const repositories: TestRepository[] = [];

interface TestRepository {
  readonly parent: string;
  readonly root: string;
  readonly initialCommit: string;
}

function gitText(root: string, arguments_: readonly string[]): string {
  const result = spawnSync("git", ["-C", root, ...arguments_], {
    encoding: "utf8",
    env: {
      ...process.env,
      GIT_CONFIG_NOSYSTEM: "1",
      GIT_TERMINAL_PROMPT: "0",
      LC_ALL: "C",
    },
    shell: false,
  });
  if (result.status !== 0) {
    throw new Error("Test Git operation failed.");
  }
  return result.stdout.trim();
}

async function createTestRepository(): Promise<TestRepository> {
  const parent = await mkdtemp(join(tmpdir(), "blackbox-worktree-test-"));
  const root = join(parent, "repository with spaces");
  await mkdir(root);
  gitText(root, ["init", "--quiet", "--initial-branch=main"]);
  gitText(root, ["config", "user.name", "Blackbox Test"]);
  gitText(root, ["config", "user.email", "blackbox@example.invalid"]);
  await writeFile(join(root, "tracked.txt"), "tracked\n");
  gitText(root, ["add", "--", "tracked.txt"]);
  gitText(root, ["commit", "--quiet", "-m", "initial"]);
  return {
    parent,
    root,
    initialCommit: gitText(root, ["rev-parse", "HEAD"]),
  };
}

async function removeTestRepository(repository: TestRepository): Promise<void> {
  await rm(repository.parent, { force: true, recursive: true });
}

class FakePersistence implements WorktreePersistence {
  record: AssignmentWorktreeV1 | null = null;
  ownership: WorktreeOwnership;
  readonly events: WorktreeOutboxRecord[] = [];
  readCount = 0;

  constructor(
    baseCommitSha: string,
    ownedTicketId = ticketId,
    ownedAssignmentId = assignmentId,
  ) {
    this.ownership = {
      repository_id: repositoryId,
      run_id: runId,
      run_status: "running",
      base_commit_sha: baseCommitSha,
      ticket_id: ownedTicketId,
      ticket_status: "ready",
      assignment_id: ownedAssignmentId,
      assignment_status: "assigned",
      assignment_worktree_id: null,
    };
  }

  async readByAssignment(
    requestedRunId: string,
    requestedTicketId: string,
    requestedAssignmentId: string,
  ) {
    this.readCount += 1;
    if (
      requestedRunId !== this.ownership.run_id ||
      requestedTicketId !== this.ownership.ticket_id ||
      requestedAssignmentId !== this.ownership.assignment_id
    ) {
      return null;
    }
    return this.record === null
      ? null
      : { ownership: this.ownership, record: this.record };
  }

  async reserveProvisioning(
    input: AssignmentWorktreeV1,
  ): Promise<ProvisionReservation> {
    if (this.record !== null) {
      return { record: this.record, acquired: false };
    }
    this.record = Object.freeze({
      ...input,
      base_commit_sha: this.ownership.base_commit_sha,
    });
    return { record: this.record, acquired: true };
  }

  async retryProvisioning(
    _worktreeId: string,
    expectedOperationToken: string,
    operationToken: string,
    occurredAt: string,
    staleBefore: string,
  ): Promise<ProvisionReservation> {
    const current = this.requireRecord();
    const retryable =
      current.status === "failed" ||
      (current.status === "provisioning" &&
        Date.parse(current.updated_at) <= Date.parse(staleBefore));
    if (current.operation_token !== expectedOperationToken || !retryable) {
      return { record: current, acquired: false };
    }
    this.record = Object.freeze({
      ...current,
      status: "provisioning",
      operation_token: operationToken,
      updated_at: occurredAt,
    });
    return { record: this.record, acquired: true };
  }

  async updateOperationStage(
    _worktreeId: string,
    _operationToken: string,
    expectedStage: AssignmentWorktreeV1["operation_stage"],
    targetStage: AssignmentWorktreeV1["operation_stage"],
    occurredAt: string,
  ) {
    const current = this.requireRecord();
    if (current.operation_stage !== expectedStage) {
      throw new Error("unexpected operation stage");
    }
    this.record = Object.freeze({
      ...current,
      operation_stage: targetStage,
      failure_disposition:
        targetStage === "reserved" ? "none" : current.failure_disposition,
      updated_at: occurredAt,
    });
    return this.record;
  }

  async activate(
    _worktreeId: string,
    _operationToken: string,
    occurredAt: string,
    event: WorktreeOutboxRecord,
  ) {
    if (this.record?.status === "active") {
      return this.record;
    }
    if (this.record?.operation_stage !== "activating") {
      throw new Error("worktree is not ready to activate");
    }
    this.record = Object.freeze({
      ...this.requireRecord(),
      status: "active",
      operation_stage: "active",
      activated_at: occurredAt,
      updated_at: occurredAt,
    });
    this.ownership = {
      ...this.ownership,
      assignment_worktree_id: this.record.id,
    };
    this.events.push(event);
    return this.record;
  }

  async failProvisioning(
    _worktreeId: string,
    _operationToken: string,
    disposition: "none" | "provision_cleanup_required",
    occurredAt: string,
  ) {
    this.record = Object.freeze({
      ...this.requireRecord(),
      status: "failed",
      failure_disposition: disposition,
      updated_at: occurredAt,
    });
  }

  async changeRetention(
    _worktreeId: string,
    target: WorktreeRetentionStatus,
    occurredAt: string,
    event: WorktreeOutboxRecord,
  ) {
    this.record = Object.freeze({
      ...this.requireRecord(),
      retention_status: target,
      updated_at: occurredAt,
    });
    this.events.push(event);
    return this.record;
  }

  async reserveRemoval(
    _worktreeId: string,
    expectedOperationToken: string,
    operationToken: string,
    occurredAt: string,
    staleBefore: string,
  ): Promise<ProvisionReservation> {
    if (
      !["released", "failed", "cancelled"].includes(
        this.ownership.assignment_status,
      )
    ) {
      throw new Error("assignment is active");
    }
    const current = this.requireRecord();
    const retryable =
      current.status === "active" ||
      (current.status === "failed" &&
        current.failure_disposition === "removal_reconcile_required") ||
      (current.status === "removing" &&
        Date.parse(current.updated_at) <= Date.parse(staleBefore));
    if (current.operation_token !== expectedOperationToken || !retryable) {
      return { record: current, acquired: false };
    }
    this.record = Object.freeze({
      ...current,
      status: "removing",
      operation_token: operationToken,
      failure_disposition: "none",
      operation_stage:
        current.status === "active"
          ? "removing_worktree"
          : current.operation_stage,
      updated_at: occurredAt,
    });
    return { record: this.record, acquired: true };
  }

  async failRemoval(
    _worktreeId: string,
    operationToken: string,
    occurredAt: string,
  ) {
    if (
      this.record?.status !== "removing" ||
      this.record.operation_token !== operationToken
    ) {
      throw new Error("worktree is not being removed");
    }
    this.record = Object.freeze({
      ...this.requireRecord(),
      status: "failed",
      failure_disposition: "removal_reconcile_required",
      updated_at: occurredAt,
    });
  }

  async markRemoved(
    _worktreeId: string,
    operationToken: string,
    occurredAt: string,
    event: WorktreeOutboxRecord,
  ) {
    if (
      this.record?.operation_stage !== "finalizing_removal" ||
      this.record.operation_token !== operationToken
    ) {
      throw new Error("worktree is not ready to remove");
    }
    this.record = Object.freeze({
      ...this.requireRecord(),
      status: "removed",
      operation_stage: "removed",
      failure_disposition: "none",
      updated_at: occurredAt,
      removed_at: occurredAt,
    });
    this.events.push(event);
    return this.record;
  }

  private requireRecord(): AssignmentWorktreeV1 {
    if (this.record === null) {
      throw new Error("missing worktree");
    }
    return this.record;
  }
}

function identifiers(initialValue = 0) {
  let value = initialValue;
  return () =>
    `50000000-0000-4000-8000-${(++value).toString().padStart(12, "0")}`;
}

async function harness(options: WorktreeManagerOptions = {}) {
  const fixture = await createTestRepository();
  repositories.push(fixture);
  const managedRoot = join(fixture.parent, "managed root");
  const configuration: WorktreeConfiguration = {
    managed_root: managedRoot,
    repositories: [
      {
        repository_id: repositoryId,
        working_tree_root: fixture.root,
        common_git_directory: join(fixture.root, ".git"),
        default_branch: "main",
      },
    ],
  };
  const persistence = new FakePersistence(fixture.initialCommit);
  const bindings = await RepositoryBindingRegistry.create(configuration);
  const identifier = identifiers();
  const createManager = (overrides: WorktreeManagerOptions = {}) =>
    new WorktreeManager(bindings, persistence, {
      clock: () => "2026-07-19T20:00:00.000Z",
      identifier,
      ...options,
      ...overrides,
    });
  const manager = createManager();
  return {
    fixture,
    managedRoot,
    persistence,
    bindings,
    manager,
    createManager,
  };
}

afterEach(async () => {
  await Promise.all(repositories.splice(0).map(removeTestRepository));
});

describe("WorktreeManager", () => {
  it("provisions one deterministic exact-base worktree idempotently", async () => {
    const { fixture, persistence, manager, createManager } = await harness();
    const canonicalHead = gitText(fixture.root, ["rev-parse", "HEAD"]);
    const competingManager = createManager();

    const [first, second] = await Promise.all([
      manager.provision(repositoryId, runId, ticketId, assignmentId),
      competingManager.provision(repositoryId, runId, ticketId, assignmentId),
    ]);

    expect(first.id).toBe(second.id);
    expect(first.managed_path).toBe(
      manager.deterministicPath(repositoryId, runId, ticketId, assignmentId),
    );
    expect(first.branch_name).toContain(`${runId}/${ticketId}/${assignmentId}`);
    expect(gitText(first.managed_path, ["rev-parse", "HEAD"])).toBe(
      fixture.initialCommit,
    );
    expect(gitText(first.managed_path, ["status", "--porcelain"])).toBe("");
    expect(gitText(fixture.root, ["rev-parse", "HEAD"])).toBe(canonicalHead);
    expect(persistence.events.map(({ event_name }) => event_name)).toEqual([
      "worktree.created",
    ]);
  });

  it("does not coalesce a concurrent repository substitution request", async () => {
    const environment = await harness();
    const substitutedRepositoryId = "10000000-0000-4000-8000-000000000099";

    const [owned, substituted] = await Promise.allSettled([
      environment.manager.provision(
        repositoryId,
        runId,
        ticketId,
        assignmentId,
      ),
      environment.manager.provision(
        substitutedRepositoryId,
        runId,
        ticketId,
        assignmentId,
      ),
    ]);

    expect(owned.status).toBe("fulfilled");
    expect(substituted).toMatchObject({
      status: "rejected",
      reason: { code: WORKTREE_ERROR_CODES.BINDING_MISSING },
    });
    expect(environment.persistence.record).toMatchObject({
      repository_id: repositoryId,
      status: "active",
    });
    expect(environment.persistence.events).toHaveLength(1);
  }, 20_000);

  it("rejects active idempotency when the ownership base drifts", async () => {
    const environment = await harness();
    const record = await environment.manager.provision(
      repositoryId,
      runId,
      ticketId,
      assignmentId,
    );
    const eventCount = environment.persistence.events.length;
    environment.persistence.ownership = {
      ...environment.persistence.ownership,
      base_commit_sha: "b".repeat(40),
    };

    await expect(
      environment.manager.provision(
        repositoryId,
        runId,
        ticketId,
        assignmentId,
      ),
    ).rejects.toMatchObject({
      code: WORKTREE_ERROR_CODES.INCONSISTENT_STATE,
    });
    expect(environment.persistence.record).toEqual(record);
    expect(environment.persistence.events).toHaveLength(eventCount);
    expect(gitText(record.managed_path, ["rev-parse", "HEAD"])).toBe(
      environment.fixture.initialCommit,
    );
  }, 20_000);

  it("concurrently provisions distinct exact-base worktrees for two assignments", async () => {
    const environment = await harness();
    const secondTicketId = "30000000-0000-4000-8000-000000000002";
    const secondAssignmentId = "40000000-0000-4000-8000-000000000002";
    const secondPersistence = new FakePersistence(
      environment.fixture.initialCommit,
      secondTicketId,
      secondAssignmentId,
    );
    const secondManager = new WorktreeManager(
      environment.bindings,
      secondPersistence,
      {
        clock: () => "2026-07-19T20:00:00.000Z",
        identifier: identifiers(100),
      },
    );
    const canonicalHead = gitText(environment.fixture.root, [
      "rev-parse",
      "HEAD",
    ]);

    const [first, second] = await Promise.all([
      environment.manager.provision(
        repositoryId,
        runId,
        ticketId,
        assignmentId,
      ),
      secondManager.provision(
        repositoryId,
        runId,
        secondTicketId,
        secondAssignmentId,
      ),
    ]);

    expect(first.managed_path).not.toBe(second.managed_path);
    expect(first.branch_name).not.toBe(second.branch_name);
    expect(first.base_commit_sha).toBe(environment.fixture.initialCommit);
    expect(second.base_commit_sha).toBe(environment.fixture.initialCommit);
    expect(gitText(first.managed_path, ["rev-parse", "HEAD"])).toBe(
      environment.fixture.initialCommit,
    );
    expect(gitText(second.managed_path, ["rev-parse", "HEAD"])).toBe(
      environment.fixture.initialCommit,
    );
    expect(gitText(first.managed_path, ["status", "--porcelain"])).toBe("");
    expect(gitText(second.managed_path, ["status", "--porcelain"])).toBe("");
    expect(gitText(environment.fixture.root, ["rev-parse", "HEAD"])).toBe(
      canonicalHead,
    );
  }, 20_000);

  it("inspects deterministic assignment-bound changes and a binary patch", async () => {
    const { manager } = await harness();
    const record = await manager.provision(
      repositoryId,
      runId,
      ticketId,
      assignmentId,
    );
    await writeFile(join(record.managed_path, "tracked.txt"), "changed\n");
    await writeFile(
      join(record.managed_path, "binary.bin"),
      Uint8Array.from([0, 255, 1]),
    );

    const inspected = await manager.inspect(runId, ticketId, assignmentId);
    const patch = await manager.patch(runId, ticketId, assignmentId);

    expect(inspected.changed_paths.map(({ path }) => path)).toEqual([
      "binary.bin",
      "tracked.txt",
    ]);
    expect(Buffer.from(patch.patch.bytes).toString("utf8")).toContain(
      "GIT binary patch",
    );
    await expect(
      manager.inspect(runId, ticketId, "40000000-0000-4000-8000-000000000002"),
    ).rejects.toMatchObject({ code: WORKTREE_ERROR_CODES.NOT_FOUND });
  }, 20_000);

  it("enforces retention, dirty, terminal, and clean non-forced cleanup", async () => {
    const { persistence, manager } = await harness();
    const record = await manager.provision(
      repositoryId,
      runId,
      ticketId,
      assignmentId,
    );
    await manager.retain(runId, ticketId, assignmentId);
    persistence.ownership = {
      ...persistence.ownership,
      assignment_status: "released",
    };
    await expect(
      manager.cleanup(runId, ticketId, assignmentId),
    ).rejects.toMatchObject({ code: WORKTREE_ERROR_CODES.CONFLICT });
    await manager.releaseRetention(runId, ticketId, assignmentId);
    await writeFile(join(record.managed_path, "tracked.txt"), "dirty\n");
    await expect(
      manager.cleanup(runId, ticketId, assignmentId),
    ).rejects.toMatchObject({ code: WORKTREE_ERROR_CODES.DIRTY });
    expect(persistence.record).toMatchObject({ status: "active" });
    expect(
      persistence.events.filter(
        ({ event_name }) => event_name === "worktree.removed",
      ),
    ).toHaveLength(0);
    await writeFile(join(record.managed_path, "tracked.txt"), "tracked\n");

    const removed = await manager.cleanup(runId, ticketId, assignmentId);
    expect(removed.status).toBe("removed");
    expect(removed.id).toBe(record.id);
    expect(persistence.ownership.assignment_worktree_id).toBe(record.id);
    expect(persistence.events.map(({ event_name }) => event_name)).toEqual([
      "worktree.created",
      "worktree.retention_changed",
      "worktree.retention_changed",
      "worktree.removed",
    ]);
    await expect(
      manager.provision(repositoryId, runId, ticketId, assignmentId),
    ).rejects.toMatchObject({ code: WORKTREE_ERROR_CODES.CONFLICT });
  }, 20_000);

  it("refuses assigned and active assignment cleanup without mutation", async () => {
    const environment = await harness();
    const record = await environment.manager.provision(
      repositoryId,
      runId,
      ticketId,
      assignmentId,
    );
    const before = environment.persistence.record;
    const eventCount = environment.persistence.events.length;

    for (const assignmentStatus of ["assigned", "active"]) {
      environment.persistence.ownership = {
        ...environment.persistence.ownership,
        assignment_status: assignmentStatus,
      };
      await expect(
        environment.manager.cleanup(runId, ticketId, assignmentId),
      ).rejects.toMatchObject({ code: WORKTREE_ERROR_CODES.CONFLICT });
      expect(environment.persistence.record).toEqual(before);
      expect(environment.persistence.events).toHaveLength(eventCount);
      expect(gitText(record.managed_path, ["rev-parse", "HEAD"])).toBe(
        environment.fixture.initialCommit,
      );
      expect(
        gitText(environment.fixture.root, ["rev-parse", record.branch_name]),
      ).toBe(environment.fixture.initialCommit);
    }
  }, 20_000);

  it("refuses untracked and ignored content before removal reservation", async () => {
    const environment = await harness();
    const record = await environment.manager.provision(
      repositoryId,
      runId,
      ticketId,
      assignmentId,
    );
    environment.persistence.ownership = {
      ...environment.persistence.ownership,
      assignment_status: "released",
    };
    const eventCount = environment.persistence.events.length;

    await writeFile(join(record.managed_path, "untracked.txt"), "unknown\n");
    const beforeUntracked = environment.persistence.record;
    await expect(
      environment.manager.cleanup(runId, ticketId, assignmentId),
    ).rejects.toMatchObject({ code: WORKTREE_ERROR_CODES.DIRTY });
    expect(environment.persistence.record).toEqual(beforeUntracked);
    expect(environment.persistence.events).toHaveLength(eventCount);
    await rm(join(record.managed_path, "untracked.txt"));

    await writeFile(
      join(environment.fixture.root, ".git", "info", "exclude"),
      "ignored.txt\n",
    );
    await writeFile(join(record.managed_path, "ignored.txt"), "unknown\n");
    const beforeIgnored = environment.persistence.record;
    await expect(
      environment.manager.cleanup(runId, ticketId, assignmentId),
    ).rejects.toMatchObject({ code: WORKTREE_ERROR_CODES.DIRTY });
    expect(environment.persistence.record).toEqual(beforeIgnored);
    expect(environment.persistence.events).toHaveLength(eventCount);
    expect(gitText(record.managed_path, ["status", "--porcelain"])).toBe("");
    expect(gitText(record.managed_path, ["rev-parse", "HEAD"])).toBe(
      environment.fixture.initialCommit,
    );
    expect(
      gitText(environment.fixture.root, ["rev-parse", record.branch_name]),
    ).toBe(environment.fixture.initialCommit);
  }, 20_000);

  it.each(["escaped", "unregistered", "branch-mismatched", "moved"] as const)(
    "refuses %s worktree cleanup and preserves the dedicated branch",
    async (scenario) => {
      const environment = await harness();
      const record = await environment.manager.provision(
        repositoryId,
        runId,
        ticketId,
        assignmentId,
      );
      environment.persistence.ownership = {
        ...environment.persistence.ownership,
        assignment_status: "released",
      };
      if (scenario === "escaped") {
        await rename(record.managed_path, `${record.managed_path}-moved`);
        await symlink(environment.fixture.root, record.managed_path);
      } else if (scenario === "unregistered") {
        gitText(environment.fixture.root, [
          "worktree",
          "remove",
          "--",
          record.managed_path,
        ]);
      } else if (scenario === "branch-mismatched") {
        gitText(record.managed_path, ["checkout", "--quiet", "--detach"]);
      } else {
        gitText(environment.fixture.root, [
          "worktree",
          "move",
          record.managed_path,
          `${record.managed_path}-moved`,
        ]);
      }
      const before = environment.persistence.record;
      const eventCount = environment.persistence.events.length;

      await expect(
        environment.manager.cleanup(runId, ticketId, assignmentId),
      ).rejects.toMatchObject({
        code: WORKTREE_ERROR_CODES.COLLISION,
      });
      expect(environment.persistence.record).toEqual(before);
      expect(environment.persistence.events).toHaveLength(eventCount);
      expect(
        environment.persistence.events.filter(
          ({ event_name }) => event_name === "worktree.removed",
        ),
      ).toHaveLength(0);
      expect(
        gitText(environment.fixture.root, ["rev-parse", record.branch_name]),
      ).toBe(environment.fixture.initialCommit);
    },
    20_000,
  );

  it("treats duplicate exact path-and-branch registrations as a collision", async () => {
    const fixture = await createTestRepository();
    repositories.push(fixture);
    const managedRoot = join(fixture.parent, "duplicate managed root");
    let duplicate = false;
    const bindings = await RepositoryBindingRegistry.create(
      {
        managed_root: managedRoot,
        repositories: [
          {
            repository_id: repositoryId,
            working_tree_root: fixture.root,
            common_git_directory: join(fixture.root, ".git"),
            default_branch: "main",
          },
        ],
      },
      async (path, defaultBranch, options) => {
        const repository = await registerGitRepository(
          path,
          defaultBranch,
          options,
        );
        if (!duplicate) {
          return repository;
        }
        return new Proxy(repository, {
          get(target, property) {
            if (property === "listWorktrees") {
              return async () => {
                const registrations = await target.listWorktrees();
                const managed = registrations.find(
                  ({ branch }) =>
                    branch?.startsWith("blackbox/worktree/") ?? false,
                );
                return managed === undefined
                  ? registrations
                  : Object.freeze([
                      ...registrations,
                      Object.freeze({ ...managed }),
                    ]);
              };
            }
            const value = Reflect.get(target, property);
            return typeof value === "function" ? value.bind(target) : value;
          },
        });
      },
    );
    const persistence = new FakePersistence(fixture.initialCommit);
    const manager = new WorktreeManager(bindings, persistence, {
      clock: () => "2026-07-19T20:00:00.000Z",
      identifier: identifiers(),
    });
    const record = await manager.provision(
      repositoryId,
      runId,
      ticketId,
      assignmentId,
    );
    persistence.ownership = {
      ...persistence.ownership,
      assignment_status: "released",
    };
    duplicate = true;
    const before = persistence.record;
    const eventCount = persistence.events.length;

    await expect(
      manager.cleanup(runId, ticketId, assignmentId),
    ).rejects.toMatchObject({ code: WORKTREE_ERROR_CODES.COLLISION });
    expect(persistence.record).toEqual(before);
    expect(persistence.events).toHaveLength(eventCount);
    expect(gitText(record.managed_path, ["rev-parse", "HEAD"])).toBe(
      fixture.initialCommit,
    );
    expect(gitText(fixture.root, ["rev-parse", record.branch_name])).toBe(
      fixture.initialCommit,
    );
  }, 20_000);

  it("rechecks unknown content immediately before non-forced removal", async () => {
    const environment = await harness();
    const record = await environment.manager.provision(
      repositoryId,
      runId,
      ticketId,
      assignmentId,
    );
    environment.persistence.ownership = {
      ...environment.persistence.ownership,
      assignment_status: "released",
    };
    await writeFile(
      join(environment.fixture.root, ".git", "info", "exclude"),
      "late-ignored.txt\n",
    );
    const reserveRemoval = environment.persistence.reserveRemoval.bind(
      environment.persistence,
    );
    environment.persistence.reserveRemoval = async (...arguments_) => {
      const reservation = await reserveRemoval(...arguments_);
      await writeFile(
        join(record.managed_path, "late-ignored.txt"),
        "arrived after reservation\n",
      );
      return reservation;
    };

    await expect(
      environment.manager.cleanup(runId, ticketId, assignmentId),
    ).rejects.toMatchObject({ code: WORKTREE_ERROR_CODES.DIRTY });
    expect(environment.persistence.record).toMatchObject({
      status: "failed",
      failure_disposition: "removal_reconcile_required",
      operation_stage: "removing_worktree",
    });
    expect(
      environment.persistence.events.filter(
        ({ event_name }) => event_name === "worktree.removed",
      ),
    ).toHaveLength(0);
    expect(gitText(record.managed_path, ["rev-parse", "HEAD"])).toBe(
      environment.fixture.initialCommit,
    );
    expect(
      gitText(environment.fixture.root, ["rev-parse", record.branch_name]),
    ).toBe(environment.fixture.initialCommit);
  }, 20_000);

  it("preserves a clean path substitution raced at the Git removal primitive", async () => {
    const fixture = await createTestRepository();
    repositories.push(fixture);
    const managedRoot = join(fixture.parent, "removal race managed root");
    let armed = false;
    let originalPath = "";
    const bindings = await RepositoryBindingRegistry.create(
      {
        managed_root: managedRoot,
        repositories: [
          {
            repository_id: repositoryId,
            working_tree_root: fixture.root,
            common_git_directory: join(fixture.root, ".git"),
            default_branch: "main",
          },
        ],
      },
      async (path, defaultBranch, options) => {
        const repository = await registerGitRepository(
          path,
          defaultBranch,
          options,
        );
        return new Proxy(repository, {
          get(target, property) {
            if (property === "removeWorktree") {
              return async (
                worktreePath: string,
                branchName: string,
                headCommitSha: string,
              ) => {
                if (armed) {
                  armed = false;
                  originalPath = `${worktreePath}-original`;
                  await rename(worktreePath, originalPath);
                  await mkdir(worktreePath);
                  gitText(worktreePath, [
                    "init",
                    "--quiet",
                    "--initial-branch=main",
                  ]);
                  gitText(worktreePath, [
                    "config",
                    "user.name",
                    "Blackbox Test",
                  ]);
                  gitText(worktreePath, [
                    "config",
                    "user.email",
                    "blackbox@example.invalid",
                  ]);
                  await writeFile(
                    join(worktreePath, "substitute.txt"),
                    "substitute\n",
                  );
                  gitText(worktreePath, ["add", "--", "substitute.txt"]);
                  gitText(worktreePath, [
                    "commit",
                    "--quiet",
                    "-m",
                    "substitute",
                  ]);
                }
                return target.removeWorktree(
                  worktreePath,
                  branchName,
                  headCommitSha,
                );
              };
            }
            const value = Reflect.get(target, property);
            return typeof value === "function" ? value.bind(target) : value;
          },
        });
      },
    );
    const persistence = new FakePersistence(fixture.initialCommit);
    const manager = new WorktreeManager(bindings, persistence, {
      clock: () => "2026-07-19T20:00:00.000Z",
      identifier: identifiers(),
    });
    const record = await manager.provision(
      repositoryId,
      runId,
      ticketId,
      assignmentId,
    );
    persistence.ownership = {
      ...persistence.ownership,
      assignment_status: "released",
    };
    armed = true;

    await expect(
      manager.cleanup(runId, ticketId, assignmentId),
    ).rejects.toMatchObject({ code: WORKTREE_ERROR_CODES.OPERATION_FAILED });
    expect(persistence.record).toMatchObject({
      status: "failed",
      failure_disposition: "removal_reconcile_required",
      operation_stage: "removing_worktree",
    });
    expect(
      persistence.events.filter(
        ({ event_name }) => event_name === "worktree.removed",
      ),
    ).toHaveLength(0);
    expect(gitText(record.managed_path, ["status", "--porcelain"])).toBe("");
    expect(gitText(record.managed_path, ["rev-parse", "HEAD"])).not.toBe(
      fixture.initialCommit,
    );
    expect(gitText(originalPath, ["rev-parse", "HEAD"])).toBe(
      fixture.initialCommit,
    );
    expect(gitText(fixture.root, ["rev-parse", record.branch_name])).toBe(
      fixture.initialCommit,
    );
  }, 20_000);

  it("refuses persisted path or branch drift before removal reservation", async () => {
    for (const drift of [
      { managed_path: "/tmp/not-the-derived-worktree" },
      { branch_name: "blackbox/worktree/not-derived" },
    ]) {
      const environment = await harness();
      const record = await environment.manager.provision(
        repositoryId,
        runId,
        ticketId,
        assignmentId,
      );
      environment.persistence.ownership = {
        ...environment.persistence.ownership,
        assignment_status: "released",
      };
      environment.persistence.record = Object.freeze({
        ...environment.persistence.record!,
        ...drift,
      });
      const before = environment.persistence.record;
      const eventCount = environment.persistence.events.length;

      await expect(
        environment.manager.cleanup(runId, ticketId, assignmentId),
      ).rejects.toMatchObject({
        code: WORKTREE_ERROR_CODES.INCONSISTENT_STATE,
      });
      expect(environment.persistence.record).toEqual(before);
      expect(environment.persistence.events).toHaveLength(eventCount);
      expect(gitText(record.managed_path, ["rev-parse", "HEAD"])).toBe(
        environment.fixture.initialCommit,
      );
      expect(
        gitText(environment.fixture.root, ["rev-parse", record.branch_name]),
      ).toBe(environment.fixture.initialCommit);
    }
  }, 20_000);

  it("serializes cleanup across manager instances", async () => {
    const environment = await harness();
    const record = await environment.manager.provision(
      repositoryId,
      runId,
      ticketId,
      assignmentId,
    );
    environment.persistence.ownership = {
      ...environment.persistence.ownership,
      assignment_status: "released",
    };

    const [first, second] = await Promise.all([
      environment.manager.cleanup(runId, ticketId, assignmentId),
      environment.createManager().cleanup(runId, ticketId, assignmentId),
    ]);

    expect(first.id).toBe(record.id);
    expect(second.id).toBe(record.id);
    expect(first.status).toBe("removed");
    expect(second.status).toBe("removed");
    expect(
      environment.persistence.events.filter(
        ({ event_name }) => event_name === "worktree.removed",
      ),
    ).toHaveLength(1);
  }, 20_000);

  it("refuses source dirt, occupied paths, and symlink escapes", async () => {
    const dirty = await harness();
    await writeFile(join(dirty.fixture.root, "tracked.txt"), "dirty\n");
    await expect(
      dirty.manager.provision(repositoryId, runId, ticketId, assignmentId),
    ).rejects.toMatchObject({ code: WORKTREE_ERROR_CODES.DIRTY });

    const occupied = await harness();
    const path = occupied.manager.deterministicPath(
      repositoryId,
      runId,
      ticketId,
      assignmentId,
    );
    await mkdir(join(occupied.managedRoot, repositoryId, runId, ticketId), {
      recursive: true,
    });
    await mkdir(path);
    await expect(
      occupied.manager.provision(repositoryId, runId, ticketId, assignmentId),
    ).rejects.toMatchObject({ code: WORKTREE_ERROR_CODES.COLLISION });

    const escaped = await harness();
    await mkdir(join(escaped.managedRoot, repositoryId));
    await symlink(
      escaped.fixture.parent,
      join(escaped.managedRoot, repositoryId, runId),
    );
    await expect(
      escaped.manager.provision(repositoryId, runId, ticketId, assignmentId),
    ).rejects.toMatchObject({ code: WORKTREE_ERROR_CODES.COLLISION });
  });

  it.each<WorktreeFailpoint>([
    "after_reservation",
    "after_branch_creation",
    "after_worktree_creation",
    "after_verification",
    "after_activation",
  ])(
    "recovers deterministically from %s",
    async (target) => {
      let armed = true;
      const environment = await harness({
        failpoint: (point) => {
          if (armed && point === target) {
            armed = false;
            throw new Error(`injected ${point}`);
          }
        },
      });

      await expect(
        environment.manager.provision(
          repositoryId,
          runId,
          ticketId,
          assignmentId,
        ),
      ).rejects.toMatchObject({ code: WORKTREE_ERROR_CODES.OPERATION_FAILED });
      expect(environment.persistence.record?.status).toBe(
        target === "after_activation" ? "active" : "failed",
      );

      const recovered = await environment
        .createManager({ failpoint: () => undefined })
        .provision(repositoryId, runId, ticketId, assignmentId);
      expect(recovered.status).toBe("active");
      expect(recovered.operation_stage).toBe("active");
      expect(
        environment.persistence.events.filter(
          ({ event_name }) => event_name === "worktree.created",
        ),
      ).toHaveLength(1);
    },
    20_000,
  );

  it.each<WorktreeFailpoint>([
    "after_worktree_removal",
    "after_branch_deletion",
    "after_removal_persistence",
  ])(
    "recovers cleanup deterministically from %s",
    async (target) => {
      const environment = await harness();
      await environment.manager.provision(
        repositoryId,
        runId,
        ticketId,
        assignmentId,
      );
      environment.persistence.ownership = {
        ...environment.persistence.ownership,
        assignment_status: "released",
      };
      let armed = true;
      const failing = environment.createManager({
        failpoint: (point) => {
          if (armed && point === target) {
            armed = false;
            throw new Error(`injected ${point}`);
          }
        },
      });

      await expect(
        failing.cleanup(runId, ticketId, assignmentId),
      ).rejects.toMatchObject({ code: WORKTREE_ERROR_CODES.OPERATION_FAILED });
      const removed = await environment
        .createManager({ failpoint: () => undefined })
        .cleanup(runId, ticketId, assignmentId);

      expect(removed.status).toBe("removed");
      expect(removed.operation_stage).toBe("removed");
      expect(
        environment.persistence.events.filter(
          ({ event_name }) => event_name === "worktree.removed",
        ),
      ).toHaveLength(1);
    },
    20_000,
  );

  it("never adopts or deletes exact resources on a fresh reservation", async () => {
    const { fixture, persistence, manager } = await harness();
    const managedPath = manager.deterministicPath(
      repositoryId,
      runId,
      ticketId,
      assignmentId,
    );
    const branchName = manager.deterministicBranch(
      runId,
      ticketId,
      assignmentId,
    );
    await mkdir(dirname(managedPath), { recursive: true });
    gitText(fixture.root, ["branch", branchName, fixture.initialCommit]);
    gitText(fixture.root, [
      "worktree",
      "add",
      "--quiet",
      managedPath,
      branchName,
    ]);

    await expect(
      manager.provision(repositoryId, runId, ticketId, assignmentId),
    ).rejects.toMatchObject({ code: WORKTREE_ERROR_CODES.COLLISION });
    expect(persistence.record).toMatchObject({
      status: "failed",
      operation_stage: "reserved",
      failure_disposition: "none",
    });
    expect(gitText(managedPath, ["rev-parse", "HEAD"])).toBe(
      fixture.initialCommit,
    );
    expect(gitText(fixture.root, ["rev-parse", branchName])).toBe(
      fixture.initialCommit,
    );
  });

  it("never adopts or deletes a worktree merely observed after an add error", async () => {
    const fixture = await createTestRepository();
    repositories.push(fixture);
    const managedRoot = join(fixture.parent, "add error managed root");
    const bindings = await RepositoryBindingRegistry.create(
      {
        managed_root: managedRoot,
        repositories: [
          {
            repository_id: repositoryId,
            working_tree_root: fixture.root,
            common_git_directory: join(fixture.root, ".git"),
            default_branch: "main",
          },
        ],
      },
      async (path, defaultBranch, options) => {
        const repository = await registerGitRepository(
          path,
          defaultBranch,
          options,
        );
        return new Proxy(repository, {
          get(target, property) {
            if (property === "addWorktree") {
              return async (worktreePath: string, branchName: string) => {
                await target.addWorktree(worktreePath, branchName);
                throw new Error("injected add error after Git mutation");
              };
            }
            const value = Reflect.get(target, property);
            return typeof value === "function" ? value.bind(target) : value;
          },
        });
      },
    );
    const persistence = new FakePersistence(fixture.initialCommit);
    const manager = new WorktreeManager(bindings, persistence, {
      clock: () => "2026-07-19T20:00:00.000Z",
      identifier: identifiers(),
    });
    const managedPath = manager.deterministicPath(
      repositoryId,
      runId,
      ticketId,
      assignmentId,
    );
    const branchName = manager.deterministicBranch(
      runId,
      ticketId,
      assignmentId,
    );

    await expect(
      manager.provision(repositoryId, runId, ticketId, assignmentId),
    ).rejects.toMatchObject({ code: WORKTREE_ERROR_CODES.OPERATION_FAILED });
    expect(persistence.record).toMatchObject({
      status: "failed",
      operation_stage: "worktree_creating",
      failure_disposition: "provision_cleanup_required",
    });
    expect(persistence.events).toHaveLength(0);
    expect(gitText(managedPath, ["rev-parse", "HEAD"])).toBe(
      fixture.initialCommit,
    );
    expect(gitText(fixture.root, ["rev-parse", branchName])).toBe(
      fixture.initialCommit,
    );

    await expect(
      manager.provision(repositoryId, runId, ticketId, assignmentId),
    ).rejects.toMatchObject({ code: WORKTREE_ERROR_CODES.INCONSISTENT_STATE });
    expect(gitText(managedPath, ["rev-parse", "HEAD"])).toBe(
      fixture.initialCommit,
    );
    expect(gitText(fixture.root, ["rev-parse", branchName])).toBe(
      fixture.initialCommit,
    );
  }, 20_000);

  it("persists missing-base failure and safely resumes a stale owned operation", async () => {
    const missing = await harness();
    missing.persistence.ownership = {
      ...missing.persistence.ownership,
      base_commit_sha: "f".repeat(40),
    };
    await expect(
      missing.manager.provision(repositoryId, runId, ticketId, assignmentId),
    ).rejects.toMatchObject({ code: WORKTREE_ERROR_CODES.OPERATION_FAILED });
    expect(missing.persistence.record).toMatchObject({
      status: "failed",
      operation_stage: "reserved",
      failure_disposition: "none",
    });

    const invalid = await harness();
    invalid.persistence.ownership = {
      ...invalid.persistence.ownership,
      base_commit_sha: "not-a-commit",
    };
    await expect(
      invalid.manager.provision(repositoryId, runId, ticketId, assignmentId),
    ).rejects.toMatchObject({ code: WORKTREE_ERROR_CODES.OPERATION_FAILED });
    expect(invalid.persistence.record).toMatchObject({
      status: "failed",
      operation_stage: "reserved",
      failure_disposition: "none",
    });

    const stale = await harness({
      clock: () => "2026-07-19T21:00:00.000Z",
      recoveryAfterMilliseconds: 1,
    });
    const managedPath = stale.manager.deterministicPath(
      repositoryId,
      runId,
      ticketId,
      assignmentId,
    );
    const branchName = stale.manager.deterministicBranch(
      runId,
      ticketId,
      assignmentId,
    );
    const bound = await stale.bindings.resolve(repositoryId);
    stale.persistence.record = Object.freeze({
      schema_version: 1,
      id: "50000000-0000-4000-8000-000000000099",
      repository_id: repositoryId,
      run_id: runId,
      ticket_id: ticketId,
      assignment_id: assignmentId,
      working_tree_root: bound.repository.registration.identity.workingTreeRoot,
      common_git_directory:
        bound.repository.registration.identity.commonGitDirectory,
      default_branch: "main",
      base_commit_sha: stale.fixture.initialCommit,
      managed_path: managedPath,
      branch_name: branchName,
      status: "provisioning",
      retention_status: "releasable",
      operation_token: "50000000-0000-4000-8000-000000000098",
      operation_stage: "worktree_creating",
      failure_disposition: "none",
      created_at: "2026-07-19T20:00:00.000Z",
      updated_at: "2026-07-19T20:00:00.000Z",
      activated_at: null,
      removed_at: null,
    });
    gitText(stale.fixture.root, [
      "branch",
      branchName,
      stale.fixture.initialCommit,
    ]);

    const recovered = await stale.manager.provision(
      repositoryId,
      runId,
      ticketId,
      assignmentId,
    );
    expect(recovered.status).toBe("active");
    expect(gitText(managedPath, ["rev-parse", "HEAD"])).toBe(
      stale.fixture.initialCommit,
    );
  }, 20_000);

  it("never adopts or deletes a branch created in the branch-creation crash window", async () => {
    const environment = await harness({
      clock: () => "2026-07-19T21:00:00.000Z",
      recoveryAfterMilliseconds: 1,
    });
    const managedPath = environment.manager.deterministicPath(
      repositoryId,
      runId,
      ticketId,
      assignmentId,
    );
    const branchName = environment.manager.deterministicBranch(
      runId,
      ticketId,
      assignmentId,
    );
    const bound = await environment.bindings.resolve(repositoryId);
    environment.persistence.record = Object.freeze({
      schema_version: 1,
      id: "50000000-0000-4000-8000-000000000099",
      repository_id: repositoryId,
      run_id: runId,
      ticket_id: ticketId,
      assignment_id: assignmentId,
      working_tree_root: bound.repository.registration.identity.workingTreeRoot,
      common_git_directory:
        bound.repository.registration.identity.commonGitDirectory,
      default_branch: "main",
      base_commit_sha: environment.fixture.initialCommit,
      managed_path: managedPath,
      branch_name: branchName,
      status: "provisioning",
      retention_status: "releasable",
      operation_token: "50000000-0000-4000-8000-000000000098",
      operation_stage: "branch_creating",
      failure_disposition: "none",
      created_at: "2026-07-19T20:00:00.000Z",
      updated_at: "2026-07-19T20:00:00.000Z",
      activated_at: null,
      removed_at: null,
    });
    gitText(environment.fixture.root, [
      "branch",
      branchName,
      environment.fixture.initialCommit,
    ]);

    await expect(
      environment.manager.provision(
        repositoryId,
        runId,
        ticketId,
        assignmentId,
      ),
    ).rejects.toMatchObject({ code: WORKTREE_ERROR_CODES.COLLISION });
    expect(environment.persistence.record).toMatchObject({
      status: "failed",
      operation_stage: "branch_creating",
      failure_disposition: "none",
    });
    expect(environment.persistence.events).toHaveLength(0);
    expect(gitText(environment.fixture.root, ["rev-parse", branchName])).toBe(
      environment.fixture.initialCommit,
    );
    await expect(lstat(managedPath)).rejects.toMatchObject({ code: "ENOENT" });
  }, 20_000);

  it("refuses pre-proof worktree recovery and recovers only after durable proof", async () => {
    let managedPath = "";
    const environment = await harness({
      failpoint: async (point) => {
        if (point === "after_worktree_creation") {
          await writeFile(join(managedPath, "tracked.txt"), "dirty\n");
          throw new Error("interrupted with a dirty partial worktree");
        }
      },
    });
    managedPath = environment.manager.deterministicPath(
      repositoryId,
      runId,
      ticketId,
      assignmentId,
    );
    await expect(
      environment.manager.provision(
        repositoryId,
        runId,
        ticketId,
        assignmentId,
      ),
    ).rejects.toMatchObject({ code: WORKTREE_ERROR_CODES.OPERATION_FAILED });
    expect(environment.persistence.record).toMatchObject({
      status: "failed",
      operation_stage: "worktree_creating",
      failure_disposition: "provision_cleanup_required",
    });
    expect(environment.persistence.events).toHaveLength(0);

    await writeFile(join(managedPath, "tracked.txt"), "tracked\n");
    await expect(
      environment
        .createManager({ failpoint: () => undefined })
        .provision(repositoryId, runId, ticketId, assignmentId),
    ).rejects.toMatchObject({ code: WORKTREE_ERROR_CODES.INCONSISTENT_STATE });
    expect(gitText(managedPath, ["rev-parse", "HEAD"])).toBe(
      environment.fixture.initialCommit,
    );
    expect(environment.persistence.record).toMatchObject({
      status: "failed",
      operation_stage: "worktree_creating",
      failure_disposition: "provision_cleanup_required",
    });
    expect(environment.persistence.events).toHaveLength(0);

    environment.persistence.record = Object.freeze({
      ...environment.persistence.record!,
      operation_stage: "verifying",
    });
    const recovered = await environment
      .createManager({ failpoint: () => undefined })
      .provision(repositoryId, runId, ticketId, assignmentId);
    expect(recovered.status).toBe("active");
    expect(gitText(managedPath, ["status", "--porcelain"])).toBe("");
    expect(
      environment.persistence.events.filter(
        ({ event_name }) => event_name === "worktree.created",
      ),
    ).toHaveLength(1);
  }, 20_000);

  it("rejects inconsistent provisioning recovery without deleting the ref", async () => {
    const environment = await harness({
      clock: () => "2026-07-19T21:00:00.000Z",
      recoveryAfterMilliseconds: 1,
    });
    const managedPath = environment.manager.deterministicPath(
      repositoryId,
      runId,
      ticketId,
      assignmentId,
    );
    const branchName = environment.manager.deterministicBranch(
      runId,
      ticketId,
      assignmentId,
    );
    const bound = await environment.bindings.resolve(repositoryId);
    await writeFile(join(environment.fixture.root, "replacement.txt"), "new\n");
    gitText(environment.fixture.root, ["add", "--", "replacement.txt"]);
    gitText(environment.fixture.root, ["commit", "--quiet", "-m", "new"]);
    const replacement = gitText(environment.fixture.root, [
      "rev-parse",
      "HEAD",
    ]);
    environment.persistence.record = Object.freeze({
      schema_version: 1,
      id: "50000000-0000-4000-8000-000000000099",
      repository_id: repositoryId,
      run_id: runId,
      ticket_id: ticketId,
      assignment_id: assignmentId,
      working_tree_root: bound.repository.registration.identity.workingTreeRoot,
      common_git_directory:
        bound.repository.registration.identity.commonGitDirectory,
      default_branch: "main",
      base_commit_sha: environment.fixture.initialCommit,
      managed_path: managedPath,
      branch_name: branchName,
      status: "provisioning",
      retention_status: "releasable",
      operation_token: "50000000-0000-4000-8000-000000000098",
      operation_stage: "branch_creating",
      failure_disposition: "none",
      created_at: "2026-07-19T20:00:00.000Z",
      updated_at: "2026-07-19T20:00:00.000Z",
      activated_at: null,
      removed_at: null,
    });
    gitText(environment.fixture.root, ["branch", branchName, replacement]);

    await expect(
      environment.manager.provision(
        repositoryId,
        runId,
        ticketId,
        assignmentId,
      ),
    ).rejects.toMatchObject({ code: WORKTREE_ERROR_CODES.COLLISION });
    expect(gitText(environment.fixture.root, ["rev-parse", branchName])).toBe(
      replacement,
    );
    expect(environment.persistence.record).toMatchObject({
      status: "failed",
      operation_stage: "branch_creating",
      failure_disposition: "none",
    });
  }, 20_000);

  it("rechecks eligibility and ownership before every provisioning retry", async () => {
    const environment = await harness();
    await environment.manager.provision(
      repositoryId,
      runId,
      ticketId,
      assignmentId,
    );
    environment.persistence.ownership = {
      ...environment.persistence.ownership,
      assignment_status: "released",
    };
    await expect(
      environment.manager.provision(
        repositoryId,
        runId,
        ticketId,
        assignmentId,
      ),
    ).rejects.toMatchObject({ code: WORKTREE_ERROR_CODES.CONFLICT });

    environment.persistence.ownership = {
      ...environment.persistence.ownership,
      assignment_status: "assigned",
      assignment_worktree_id: "50000000-0000-4000-8000-000000000099",
    };
    const beforeOwnershipRefusals = environment.persistence.record;
    const eventCount = environment.persistence.events.length;
    for (const operation of [
      () => environment.manager.inspect(runId, ticketId, assignmentId),
      () => environment.manager.patch(runId, ticketId, assignmentId),
      () => environment.manager.retain(runId, ticketId, assignmentId),
      () => environment.manager.releaseRetention(runId, ticketId, assignmentId),
      () => environment.manager.cleanup(runId, ticketId, assignmentId),
      () =>
        environment.manager.provision(
          repositoryId,
          runId,
          ticketId,
          assignmentId,
        ),
    ]) {
      await expect(operation()).rejects.toMatchObject({
        code: WORKTREE_ERROR_CODES.NOT_FOUND,
      });
    }
    expect(environment.persistence.record).toEqual(beforeOwnershipRefusals);
    expect(environment.persistence.events).toHaveLength(eventCount);

    environment.persistence.ownership = {
      ...environment.persistence.ownership,
      assignment_worktree_id: environment.persistence.record!.id,
    };
    environment.persistence.record = Object.freeze({
      ...environment.persistence.record!,
      common_git_directory: environment.fixture.parent,
    });
    await expect(
      environment.manager.inspect(runId, ticketId, assignmentId),
    ).rejects.toMatchObject({ code: WORKTREE_ERROR_CODES.BINDING_DRIFT });
  }, 20_000);

  it("leaves a substituted branch untouched during removal recovery", async () => {
    const environment = await harness();
    const record = await environment.manager.provision(
      repositoryId,
      runId,
      ticketId,
      assignmentId,
    );
    environment.persistence.ownership = {
      ...environment.persistence.ownership,
      assignment_status: "released",
    };
    let armed = true;
    const interrupted = environment.createManager({
      failpoint: (point) => {
        if (armed && point === "after_worktree_removal") {
          armed = false;
          throw new Error("interrupted removal");
        }
      },
    });
    await expect(
      interrupted.cleanup(runId, ticketId, assignmentId),
    ).rejects.toMatchObject({ code: WORKTREE_ERROR_CODES.OPERATION_FAILED });

    await writeFile(join(environment.fixture.root, "replacement.txt"), "new\n");
    gitText(environment.fixture.root, ["add", "--", "replacement.txt"]);
    gitText(environment.fixture.root, ["commit", "--quiet", "-m", "new"]);
    const replacement = gitText(environment.fixture.root, [
      "rev-parse",
      "HEAD",
    ]);
    gitText(environment.fixture.root, [
      "branch",
      "--force",
      record.branch_name,
      replacement,
    ]);

    await expect(
      environment
        .createManager({ failpoint: () => undefined })
        .cleanup(runId, ticketId, assignmentId),
    ).rejects.toMatchObject({ code: WORKTREE_ERROR_CODES.COLLISION });
    expect(environment.persistence.record).toMatchObject({
      status: "failed",
      failure_disposition: "removal_reconcile_required",
      operation_stage: "deleting_branch",
    });
    expect(
      environment.persistence.events.filter(
        ({ event_name }) => event_name === "worktree.removed",
      ),
    ).toHaveLength(0);
    expect(
      gitText(environment.fixture.root, ["rev-parse", record.branch_name]),
    ).toBe(replacement);
  }, 20_000);

  it("supports a detached clean source and rejects identifier injection", async () => {
    const environment = await harness();
    gitText(environment.fixture.root, ["checkout", "--quiet", "--detach"]);
    const record = await environment.manager.provision(
      repositoryId,
      runId,
      ticketId,
      assignmentId,
    );
    expect(record.status).toBe("active");
    expect(() =>
      environment.manager.deterministicBranch(
        runId,
        ticketId,
        "../../refs/heads/main",
      ),
    ).toThrow(
      expect.objectContaining({ code: WORKTREE_ERROR_CODES.INVALID_INPUT }),
    );
    expect(() =>
      environment.manager.deterministicPath(
        repositoryId,
        runId,
        ticketId,
        "not-a-uuid",
      ),
    ).toThrow(
      expect.objectContaining({ code: WORKTREE_ERROR_CODES.INVALID_INPUT }),
    );
  });

  it("rejects uppercase public and generated identifiers before state access", async () => {
    const environment = await harness();
    const uppercase = "AAAAAAAA-0000-4000-8000-000000000001";
    const readsBeforeCleanup = environment.persistence.readCount;

    await expect(
      environment.manager.cleanup(uppercase, ticketId, assignmentId),
    ).rejects.toMatchObject({ code: WORKTREE_ERROR_CODES.INVALID_INPUT });
    expect(environment.persistence.readCount).toBe(readsBeforeCleanup);
    await expect(
      environment.manager.provision(uppercase, runId, ticketId, assignmentId),
    ).rejects.toMatchObject({ code: WORKTREE_ERROR_CODES.INVALID_INPUT });
    expect(environment.persistence.record).toBeNull();

    const invalidGenerated = await harness({ identifier: () => uppercase });
    await expect(
      invalidGenerated.manager.provision(
        repositoryId,
        runId,
        ticketId,
        assignmentId,
      ),
    ).rejects.toMatchObject({ code: WORKTREE_ERROR_CODES.INVALID_INPUT });
    expect(invalidGenerated.persistence.record).toBeNull();
    expect(
      gitText(invalidGenerated.fixture.root, [
        "branch",
        "--list",
        invalidGenerated.manager.deterministicBranch(
          runId,
          ticketId,
          assignmentId,
        ),
      ]),
    ).toBe("");
  });

  it("refuses missing, duplicate-identity, and drifted repository bindings", async () => {
    const fixture = await createTestRepository();
    repositories.push(fixture);
    const managedRoot = join(fixture.parent, "managed bindings");
    const binding = {
      repository_id: repositoryId,
      working_tree_root: fixture.root,
      common_git_directory: join(fixture.root, ".git"),
      default_branch: "main",
    };
    await expect(
      RepositoryBindingRegistry.create({
        managed_root: managedRoot,
        repositories: [
          binding,
          {
            ...binding,
            repository_id: "10000000-0000-4000-8000-000000000002",
          },
        ],
      }),
    ).rejects.toMatchObject({ code: WORKTREE_ERROR_CODES.BINDING_DRIFT });
    await expect(
      RepositoryBindingRegistry.create({
        managed_root: managedRoot,
        repositories: [{ ...binding, common_git_directory: fixture.parent }],
      }),
    ).rejects.toMatchObject({ code: WORKTREE_ERROR_CODES.BINDING_DRIFT });
    const registry = await RepositoryBindingRegistry.create({
      managed_root: managedRoot,
      repositories: [binding],
    });
    await expect(
      registry.resolve("10000000-0000-4000-8000-000000000099"),
    ).rejects.toMatchObject({ code: WORKTREE_ERROR_CODES.BINDING_MISSING });

    const substitute = await createTestRepository();
    repositories.push(substitute);
    const originalGitDirectory = join(fixture.root, ".git");
    await rename(originalGitDirectory, join(fixture.root, ".git-original"));
    await symlink(join(substitute.root, ".git"), originalGitDirectory);
    await expect(registry.resolve(repositoryId)).rejects.toMatchObject({
      code: WORKTREE_ERROR_CODES.BINDING_DRIFT,
    });

    await expect(
      RepositoryBindingRegistry.create({
        managed_root: `${managedRoot}-uppercase`,
        repositories: [
          {
            ...binding,
            repository_id: "AAAAAAAA-0000-4000-8000-000000000001",
          },
        ],
      }),
    ).rejects.toMatchObject({ code: WORKTREE_ERROR_CODES.INVALID_INPUT });
    await expect(lstat(`${managedRoot}-uppercase`)).rejects.toMatchObject({
      code: "ENOENT",
    });
  }, 20_000);
});
