import { randomUUID } from "node:crypto";
import { lstat, mkdir, realpath } from "node:fs/promises";
import { isAbsolute, join, relative, resolve } from "node:path";

import {
  registerGitRepository,
  type ChangedPath,
  type GitPatchResult,
  type GitRepository,
  type RegisteredWorktree,
} from "@blackbox/git";

import type {
  AssignmentWorktreeV1,
  WorktreeOutboxRecord,
  WorktreeOperationStage,
  WorktreePersistence,
  WorktreeRetentionStatus,
} from "./contracts.js";
import {
  WORKTREE_ERROR_CODES,
  WorktreeError,
  worktreeError,
} from "./errors.js";
import type {
  BoundRepository,
  RepositoryBindingRegistry,
} from "./repository-bindings.js";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

interface ManagedResources {
  readonly worktree: RegisteredWorktree | undefined;
  readonly branchCommit: string | null;
  readonly collision: boolean;
}

export interface WorktreeInspection {
  readonly worktree: AssignmentWorktreeV1;
  readonly head_commit_sha: string;
  readonly clean: boolean;
  readonly changed_paths: readonly ChangedPath[];
}

export interface WorktreePatchInspection extends WorktreeInspection {
  readonly patch: GitPatchResult;
}

export interface WorktreeManagerOptions {
  readonly clock?: () => string;
  readonly identifier?: () => string;
  readonly failpoint?: (point: WorktreeFailpoint) => void | Promise<void>;
  readonly wait?: (milliseconds: number) => Promise<void>;
  readonly recoveryAfterMilliseconds?: number;
}

export type WorktreeFailpoint =
  | "after_reservation"
  | "after_branch_creation"
  | "after_worktree_creation"
  | "after_verification"
  | "after_activation"
  | "after_worktree_removal"
  | "after_branch_deletion"
  | "after_removal_persistence";

function validateIdentifier(value: string): void {
  if (!UUID_PATTERN.test(value)) {
    throw worktreeError(WORKTREE_ERROR_CODES.INVALID_INPUT);
  }
}

function isWithin(root: string, candidate: string): boolean {
  const value = relative(root, candidate);
  return value !== ".." && !value.startsWith("../") && !isAbsolute(value);
}

function sameIdentity(record: AssignmentWorktreeV1, bound: BoundRepository) {
  return (
    record.repository_id === bound.repositoryId &&
    record.working_tree_root ===
      bound.repository.registration.identity.workingTreeRoot &&
    record.common_git_directory ===
      bound.repository.registration.identity.commonGitDirectory &&
    record.default_branch === bound.repository.registration.defaultBranch
  );
}

function worktreeEvent(
  eventId: string,
  record: AssignmentWorktreeV1,
  eventName: WorktreeOutboxRecord["event_name"],
  occurredAt: string,
  payload: WorktreeOutboxRecord["payload"],
): WorktreeOutboxRecord {
  return Object.freeze({
    schema_version: 1,
    event_id: eventId,
    aggregate_type: "worktree",
    aggregate_id: record.id,
    run_id: record.run_id,
    event_name: eventName,
    occurred_at: occurredAt,
    payload,
  });
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await lstat(path);
    return true;
  } catch (error) {
    if (
      typeof error === "object" &&
      error !== null &&
      Reflect.get(error, "code") === "ENOENT"
    ) {
      return false;
    }
    throw worktreeError(WORKTREE_ERROR_CODES.OPERATION_FAILED);
  }
}

async function assertCanonicalManagedPath(
  root: string,
  path: string,
  mustExist: boolean,
): Promise<void> {
  const expected = resolve(path);
  if (!isWithin(root, expected) || expected === root) {
    throw worktreeError(WORKTREE_ERROR_CODES.INCONSISTENT_STATE);
  }
  if (!(await pathExists(expected))) {
    if (mustExist) {
      throw worktreeError(WORKTREE_ERROR_CODES.INCONSISTENT_STATE);
    }
    const parent = await realpath(resolve(expected, ".."));
    if (!isWithin(root, parent)) {
      throw worktreeError(WORKTREE_ERROR_CODES.INCONSISTENT_STATE);
    }
    return;
  }
  const metadata = await lstat(expected);
  if (metadata.isSymbolicLink() || !metadata.isDirectory()) {
    throw worktreeError(WORKTREE_ERROR_CODES.COLLISION);
  }
  const canonical = await realpath(expected);
  if (canonical !== expected || !isWithin(root, canonical)) {
    throw worktreeError(WORKTREE_ERROR_CODES.INCONSISTENT_STATE);
  }
}

async function prepareManagedParents(
  root: string,
  segments: readonly string[],
): Promise<string> {
  let parent = root;
  for (const segment of segments.slice(0, -1)) {
    const next = join(parent, segment);
    try {
      await mkdir(next);
    } catch (error) {
      if (
        typeof error !== "object" ||
        error === null ||
        Reflect.get(error, "code") !== "EEXIST"
      ) {
        throw worktreeError(WORKTREE_ERROR_CODES.OPERATION_FAILED);
      }
    }
    const metadata = await lstat(next);
    const canonical = await realpath(next);
    if (
      metadata.isSymbolicLink() ||
      !metadata.isDirectory() ||
      canonical !== next ||
      !isWithin(root, canonical)
    ) {
      throw worktreeError(WORKTREE_ERROR_CODES.COLLISION);
    }
    parent = next;
  }
  return join(parent, segments.at(-1) ?? "");
}

export class WorktreeManager {
  private readonly clock: () => string;
  private readonly identifier: () => string;
  private readonly failpoint: (point: WorktreeFailpoint) => Promise<void>;
  private readonly wait: (milliseconds: number) => Promise<void>;
  private readonly recoveryAfterMilliseconds: number;
  private readonly provisions = new Map<
    string,
    Promise<AssignmentWorktreeV1>
  >();

  constructor(
    private readonly bindings: RepositoryBindingRegistry,
    private readonly persistence: WorktreePersistence,
    options: WorktreeManagerOptions = {},
  ) {
    this.clock = options.clock ?? (() => new Date().toISOString());
    this.identifier = options.identifier ?? randomUUID;
    this.failpoint = async (point) => options.failpoint?.(point);
    this.wait =
      options.wait ??
      ((milliseconds) =>
        new Promise((resolvePromise) =>
          setTimeout(resolvePromise, milliseconds),
        ));
    this.recoveryAfterMilliseconds =
      options.recoveryAfterMilliseconds ?? 30_000;
  }

  private nextIdentifier(): string {
    const identifier = this.identifier();
    validateIdentifier(identifier);
    return identifier;
  }

  private assertCanonicalRecordIdentifiers(record: AssignmentWorktreeV1): void {
    for (const value of [
      record.id,
      record.repository_id,
      record.run_id,
      record.ticket_id,
      record.assignment_id,
      record.operation_token,
    ]) {
      validateIdentifier(value);
    }
  }

  deterministicPath(
    repositoryId: string,
    runId: string,
    ticketId: string,
    assignmentId: string,
  ): string {
    for (const value of [repositoryId, runId, ticketId, assignmentId]) {
      validateIdentifier(value);
    }
    return join(
      this.bindings.managedRoot,
      repositoryId,
      runId,
      ticketId,
      assignmentId,
    );
  }

  deterministicBranch(
    runId: string,
    ticketId: string,
    assignmentId: string,
  ): string {
    for (const value of [runId, ticketId, assignmentId]) {
      validateIdentifier(value);
    }
    return `blackbox/worktree/${runId}/${ticketId}/${assignmentId}`;
  }

  async provision(
    repositoryId: string,
    runId: string,
    ticketId: string,
    assignmentId: string,
  ): Promise<AssignmentWorktreeV1> {
    for (const value of [repositoryId, runId, ticketId, assignmentId]) {
      validateIdentifier(value);
    }
    const key = `${repositoryId}\0${runId}\0${ticketId}\0${assignmentId}`;
    const pending = this.provisions.get(key);
    if (pending !== undefined) {
      return pending;
    }
    const operation = this.provisionOnce(
      repositoryId,
      runId,
      ticketId,
      assignmentId,
    );
    this.provisions.set(key, operation);
    try {
      return await operation;
    } finally {
      if (this.provisions.get(key) === operation) {
        this.provisions.delete(key);
      }
    }
  }

  private async provisionOnce(
    repositoryId: string,
    runId: string,
    ticketId: string,
    assignmentId: string,
  ): Promise<AssignmentWorktreeV1> {
    const managedPath = this.deterministicPath(
      repositoryId,
      runId,
      ticketId,
      assignmentId,
    );
    const branchName = this.deterministicBranch(runId, ticketId, assignmentId);
    const bound = await this.bindings.resolve(repositoryId);
    const sourceStatus = await bound.repository.getStatus();
    if (!sourceStatus.clean) {
      throw worktreeError(WORKTREE_ERROR_CODES.DIRTY);
    }

    const existing = await this.persistence.readByAssignment(
      runId,
      ticketId,
      assignmentId,
    );
    const baseCommitSha = existing?.record.base_commit_sha;
    if (existing !== null) {
      if (
        existing.record.status === "provisioning" ||
        (existing.record.status === "failed" &&
          existing.record.failure_disposition !== "removal_reconcile_required")
      ) {
        this.assertProvisioningOwnership(
          existing.record,
          existing.ownership,
          runId,
          ticketId,
          assignmentId,
        );
      } else {
        this.assertOwnership(
          existing.record,
          existing.ownership,
          runId,
          ticketId,
          assignmentId,
        );
      }
    }
    if (existing?.record.status === "active") {
      this.assertProvisioningEligibility(existing.ownership);
      if (
        existing.record.base_commit_sha !== existing.ownership.base_commit_sha
      ) {
        throw worktreeError(WORKTREE_ERROR_CODES.INCONSISTENT_STATE);
      }
      await this.verifyRecord(existing.record, bound, true, true);
      return existing.record;
    }
    if (
      existing?.record.status === "removed" ||
      existing?.record.status === "removing" ||
      (existing?.record.status === "failed" &&
        existing.record.failure_disposition === "removal_reconcile_required")
    ) {
      throw worktreeError(WORKTREE_ERROR_CODES.CONFLICT);
    }

    let reservation;
    if (existing?.record.status === "failed") {
      if (
        !["none", "provision_cleanup_required"].includes(
          existing.record.failure_disposition,
        )
      ) {
        throw worktreeError(WORKTREE_ERROR_CODES.INCONSISTENT_STATE);
      }
      reservation = await this.persistence.retryProvisioning(
        existing.record.id,
        existing.record.operation_token,
        this.nextIdentifier(),
        this.clock(),
        this.clock(),
      );
    } else if (existing !== null) {
      const now = this.clock();
      const staleBefore = new Date(
        Date.parse(now) - this.recoveryAfterMilliseconds,
      ).toISOString();
      reservation =
        Date.parse(existing.record.updated_at) <= Date.parse(staleBefore)
          ? await this.persistence.retryProvisioning(
              existing.record.id,
              existing.record.operation_token,
              this.nextIdentifier(),
              now,
              staleBefore,
            )
          : { record: existing.record, acquired: false };
    } else {
      const occurredAt = this.clock();
      const ownershipBase = await this.readBaseFromReservationInputs(
        bound.repository,
        repositoryId,
        runId,
        ticketId,
        assignmentId,
        managedPath,
        branchName,
        occurredAt,
      );
      reservation = await this.persistence.reserveProvisioning(ownershipBase);
    }

    if (!reservation.acquired) {
      this.assertProvisioningIdentity(
        reservation.record,
        bound,
        repositoryId,
        runId,
        ticketId,
        assignmentId,
        managedPath,
        branchName,
        baseCommitSha,
      );
      return this.awaitProvisioningOwner(
        reservation.record,
        runId,
        ticketId,
        assignmentId,
      );
    }

    let record = reservation.record;
    let createdBranch = false;
    let createdWorktree = false;
    let finalizing = false;
    try {
      this.assertProvisioningIdentity(
        record,
        bound,
        repositoryId,
        runId,
        ticketId,
        assignmentId,
        managedPath,
        branchName,
        baseCommitSha,
      );
      await this.failpoint("after_reservation");
      await bound.repository.assertCommitExists(record.base_commit_sha);
      const preparedPath = await prepareManagedParents(bound.managedRoot, [
        repositoryId,
        runId,
        ticketId,
        assignmentId,
      ]);
      if (preparedPath !== record.managed_path) {
        throw worktreeError(WORKTREE_ERROR_CODES.INCONSISTENT_STATE);
      }

      if (
        existing === null &&
        !(await this.resourcesAbsent(record, bound.repository))
      ) {
        throw worktreeError(WORKTREE_ERROR_CODES.COLLISION);
      }
      if (record.failure_disposition === "provision_cleanup_required") {
        const retryOwnership = this.retryOwnership(record);
        if (
          !(await this.compensateProvisioning(record, bound, retryOwnership))
        ) {
          throw worktreeError(WORKTREE_ERROR_CODES.INCONSISTENT_STATE);
        }
        record = await this.resetProvisioningStage(record);
      }

      if (record.operation_stage === "reserved") {
        if (!(await this.resourcesAbsent(record, bound.repository))) {
          throw worktreeError(WORKTREE_ERROR_CODES.COLLISION);
        }
        record = await this.advanceStage(record, "reserved", "branch_creating");
      }

      let reconciled = await this.resources(bound.repository, record);
      if (record.operation_stage === "branch_creating") {
        if (
          reconciled.collision ||
          reconciled.worktree !== undefined ||
          (await pathExists(record.managed_path)) ||
          reconciled.branchCommit !== null
        ) {
          throw worktreeError(WORKTREE_ERROR_CODES.COLLISION);
        }
        await bound.repository.createBranch(
          record.branch_name,
          record.base_commit_sha,
        );
        createdBranch = true;
        await this.failpoint("after_branch_creation");
        record = await this.advanceStage(
          record,
          "branch_creating",
          "worktree_creating",
        );
        reconciled = await this.resources(bound.repository, record);
      }

      if (record.operation_stage === "worktree_creating") {
        if (
          reconciled.collision ||
          reconciled.branchCommit !== record.base_commit_sha ||
          reconciled.worktree !== undefined ||
          (await pathExists(record.managed_path))
        ) {
          throw worktreeError(WORKTREE_ERROR_CODES.COLLISION);
        }
        await bound.repository.addWorktree(
          record.managed_path,
          record.branch_name,
        );
        createdWorktree = true;
        await this.failpoint("after_worktree_creation");
        record = await this.advanceStage(
          record,
          "worktree_creating",
          "verifying",
        );
      }

      if (
        record.operation_stage !== "verifying" &&
        record.operation_stage !== "activating"
      ) {
        throw worktreeError(WORKTREE_ERROR_CODES.INCONSISTENT_STATE);
      }
      reconciled = await this.resources(bound.repository, record);
      if (
        reconciled.collision ||
        reconciled.branchCommit !== record.base_commit_sha ||
        !this.matchesRegistered(record, reconciled.worktree)
      ) {
        throw worktreeError(WORKTREE_ERROR_CODES.COLLISION);
      }
      await this.verifyRecord(record, bound, true, true);
      if (record.operation_stage === "verifying") {
        await this.failpoint("after_verification");
        record = await this.advanceStage(record, "verifying", "activating");
      }
      const occurredAt = this.clock();
      finalizing = true;
      const activated = await this.persistence.activate(
        record.id,
        record.operation_token,
        occurredAt,
        worktreeEvent(
          this.nextIdentifier(),
          record,
          "worktree.created",
          occurredAt,
          Object.freeze({
            assignment_id: record.assignment_id,
            base_commit_sha: record.base_commit_sha,
            branch_name: record.branch_name,
            managed_path: record.managed_path,
          }),
        ),
      );
      await this.failpoint("after_activation");
      return activated;
    } catch (error) {
      if (finalizing) {
        await this.reconcileAmbiguousActivation(record, bound);
      } else {
        const persistedOwnership = this.retryOwnership(record);
        const ownedResources = {
          createdBranch: createdBranch || persistedOwnership.createdBranch,
          createdWorktree:
            createdWorktree || persistedOwnership.createdWorktree,
        };
        const compensated = await this.compensateProvisioning(
          record,
          bound,
          ownedResources,
        );
        if (compensated) {
          record = await this.resetProvisioningStage(record).catch(
            () => record,
          );
        }
        const ownsPartialResources =
          ownedResources.createdBranch ||
          ownedResources.createdWorktree ||
          record.failure_disposition === "provision_cleanup_required";
        await this.persistence
          .failProvisioning(
            record.id,
            record.operation_token,
            ownsPartialResources && !compensated
              ? "provision_cleanup_required"
              : "none",
            this.clock(),
          )
          .catch(() => undefined);
      }
      if (error instanceof WorktreeError) {
        throw error;
      }
      throw worktreeError(WORKTREE_ERROR_CODES.OPERATION_FAILED);
    }
  }

  async inspect(
    runId: string,
    ticketId: string,
    assignmentId: string,
  ): Promise<WorktreeInspection> {
    const { record, repository } = await this.requireActive(
      runId,
      ticketId,
      assignmentId,
    );
    const head = await repository.getHead();
    const status = await repository.getStatus();
    return Object.freeze({
      worktree: record,
      head_commit_sha: head.commitSha,
      clean: status.clean,
      changed_paths: status.changedPaths,
    });
  }

  async patch(
    runId: string,
    ticketId: string,
    assignmentId: string,
  ): Promise<WorktreePatchInspection> {
    const { record, repository } = await this.requireActive(
      runId,
      ticketId,
      assignmentId,
    );
    const head = await repository.getHead();
    const status = await repository.getStatus();
    const patch = await repository.createPatch(record.base_commit_sha);
    return Object.freeze({
      worktree: record,
      head_commit_sha: head.commitSha,
      clean: status.clean,
      changed_paths: status.changedPaths,
      patch,
    });
  }

  retain(runId: string, ticketId: string, assignmentId: string) {
    return this.setRetention(runId, ticketId, assignmentId, "retained");
  }

  releaseRetention(runId: string, ticketId: string, assignmentId: string) {
    return this.setRetention(runId, ticketId, assignmentId, "releasable");
  }

  async cleanup(
    runId: string,
    ticketId: string,
    assignmentId: string,
  ): Promise<AssignmentWorktreeV1> {
    for (const value of [runId, ticketId, assignmentId]) {
      validateIdentifier(value);
    }
    const owned = await this.persistence.readByAssignment(
      runId,
      ticketId,
      assignmentId,
    );
    if (owned === null) {
      throw worktreeError(WORKTREE_ERROR_CODES.NOT_FOUND);
    }
    this.assertOwnership(
      owned.record,
      owned.ownership,
      runId,
      ticketId,
      assignmentId,
    );
    if (owned.record.status === "removed") {
      return owned.record;
    }
    if (
      !["released", "failed", "cancelled"].includes(
        owned.ownership.assignment_status,
      )
    ) {
      throw worktreeError(WORKTREE_ERROR_CODES.CONFLICT);
    }
    const bound = await this.bindings.resolve(owned.record.repository_id);
    if (!sameIdentity(owned.record, bound)) {
      throw worktreeError(WORKTREE_ERROR_CODES.BINDING_DRIFT);
    }
    this.assertDeterministicResourceIdentity(owned.record);
    if (owned.record.status === "active") {
      if (owned.record.retention_status === "retained") {
        throw worktreeError(WORKTREE_ERROR_CODES.CONFLICT);
      }
      try {
        const repository = await this.verifyRecord(
          owned.record,
          bound,
          false,
          true,
        );
        await this.assertNoUnknownContent(repository);
      } catch (error) {
        const raced = await this.persistence.readByAssignment(
          runId,
          ticketId,
          assignmentId,
        );
        if (
          raced !== null &&
          raced.record.id === owned.record.id &&
          ["removing", "removed"].includes(raced.record.status)
        ) {
          if (raced.record.status === "removed") {
            this.assertOwnership(
              raced.record,
              raced.ownership,
              runId,
              ticketId,
              assignmentId,
            );
            return raced.record;
          }
          return this.awaitRemovalOwner(
            raced.record,
            runId,
            ticketId,
            assignmentId,
          );
        }
        throw error;
      }
    } else if (
      owned.record.status !== "removing" &&
      !(
        owned.record.status === "failed" &&
        owned.record.failure_disposition === "removal_reconcile_required"
      )
    ) {
      throw worktreeError(WORKTREE_ERROR_CODES.CONFLICT);
    }

    const now = this.clock();
    const staleBefore = new Date(
      Date.parse(now) - this.recoveryAfterMilliseconds,
    ).toISOString();
    const reservation = await this.persistence.reserveRemoval(
      owned.record.id,
      owned.record.operation_token,
      this.nextIdentifier(),
      now,
      staleBefore,
    );
    if (!reservation.acquired) {
      return this.awaitRemovalOwner(
        reservation.record,
        runId,
        ticketId,
        assignmentId,
      );
    }
    let removing = reservation.record;

    try {
      removing = await this.reconcileRemoval(removing, bound);
      const occurredAt = this.clock();
      const removed = await this.persistence.markRemoved(
        removing.id,
        removing.operation_token,
        occurredAt,
        worktreeEvent(
          this.nextIdentifier(),
          removing,
          "worktree.removed",
          occurredAt,
          Object.freeze({ assignment_id: removing.assignment_id }),
        ),
      );
      await this.failpoint("after_removal_persistence");
      return removed;
    } catch (error) {
      await this.persistence
        .failRemoval(removing.id, removing.operation_token, this.clock())
        .catch(() => undefined);
      if (error instanceof WorktreeError) {
        throw error;
      }
      throw worktreeError(WORKTREE_ERROR_CODES.OPERATION_FAILED);
    }
  }

  async verifyActiveRecord(record: AssignmentWorktreeV1): Promise<void> {
    this.assertCanonicalRecordIdentifiers(record);
    if (record.status !== "active") {
      throw worktreeError(WORKTREE_ERROR_CODES.CONFLICT);
    }
    const bound = await this.bindings.resolve(record.repository_id);
    await this.verifyRecord(record, bound, true, true);
  }

  private async readBaseFromReservationInputs(
    repository: GitRepository,
    repositoryId: string,
    runId: string,
    ticketId: string,
    assignmentId: string,
    managedPath: string,
    branchName: string,
    occurredAt: string,
  ): Promise<AssignmentWorktreeV1> {
    const operationToken = this.nextIdentifier();
    const record: AssignmentWorktreeV1 = Object.freeze({
      schema_version: 1,
      id: this.nextIdentifier(),
      repository_id: repositoryId,
      run_id: runId,
      ticket_id: ticketId,
      assignment_id: assignmentId,
      working_tree_root: repository.registration.identity.workingTreeRoot,
      common_git_directory: repository.registration.identity.commonGitDirectory,
      default_branch: repository.registration.defaultBranch,
      base_commit_sha: "",
      managed_path: managedPath,
      branch_name: branchName,
      status: "provisioning",
      retention_status: "releasable",
      operation_token: operationToken,
      operation_stage: "reserved",
      failure_disposition: "none",
      created_at: occurredAt,
      updated_at: occurredAt,
      activated_at: null,
      removed_at: null,
    });
    return record;
  }

  private async requireActive(
    runId: string,
    ticketId: string,
    assignmentId: string,
  ): Promise<{ record: AssignmentWorktreeV1; repository: GitRepository }> {
    for (const value of [runId, ticketId, assignmentId]) {
      validateIdentifier(value);
    }
    const owned = await this.persistence.readByAssignment(
      runId,
      ticketId,
      assignmentId,
    );
    if (owned === null) {
      throw worktreeError(WORKTREE_ERROR_CODES.NOT_FOUND);
    }
    this.assertOwnership(
      owned.record,
      owned.ownership,
      runId,
      ticketId,
      assignmentId,
    );
    if (owned.record.status !== "active") {
      throw worktreeError(WORKTREE_ERROR_CODES.CONFLICT);
    }
    const bound = await this.bindings.resolve(owned.record.repository_id);
    const repository = await this.verifyRecord(
      owned.record,
      bound,
      false,
      false,
    );
    return { record: owned.record, repository };
  }

  private async awaitProvisioningOwner(
    reservation: AssignmentWorktreeV1,
    runId: string,
    ticketId: string,
    assignmentId: string,
  ): Promise<AssignmentWorktreeV1> {
    for (let attempt = 0; attempt < 250; attempt += 1) {
      const current = await this.persistence.readByAssignment(
        runId,
        ticketId,
        assignmentId,
      );
      if (current === null || current.record.id !== reservation.id) {
        throw worktreeError(WORKTREE_ERROR_CODES.INCONSISTENT_STATE);
      }
      if (current.record.status === "active") {
        this.assertOwnership(
          current.record,
          current.ownership,
          runId,
          ticketId,
          assignmentId,
        );
        this.assertProvisioningEligibility(current.ownership);
        await this.verifyActiveRecord(current.record);
        return current.record;
      }
      this.assertProvisioningOwnership(
        current.record,
        current.ownership,
        runId,
        ticketId,
        assignmentId,
      );
      if (current.record.status === "failed") {
        throw worktreeError(
          current.record.failure_disposition === "provision_cleanup_required"
            ? WORKTREE_ERROR_CODES.INCONSISTENT_STATE
            : WORKTREE_ERROR_CODES.CONFLICT,
        );
      }
      if (current.record.status !== "provisioning") {
        throw worktreeError(WORKTREE_ERROR_CODES.CONFLICT);
      }
      await this.wait(20);
    }
    throw worktreeError(WORKTREE_ERROR_CODES.CONFLICT);
  }

  private async reconcileAmbiguousActivation(
    record: AssignmentWorktreeV1,
    bound: BoundRepository,
  ): Promise<void> {
    try {
      const current = await this.persistence.readByAssignment(
        record.run_id,
        record.ticket_id,
        record.assignment_id,
      );
      if (current?.record.status === "active") {
        return;
      }
      if (
        current?.record.status !== "provisioning" ||
        current.record.operation_token !== record.operation_token
      ) {
        return;
      }
      const compensated = await this.compensateProvisioning(
        record,
        bound,
        this.retryOwnership(record),
      );
      const failedRecord = compensated
        ? await this.resetProvisioningStage(record).catch(() => record)
        : record;
      await this.persistence.failProvisioning(
        failedRecord.id,
        failedRecord.operation_token,
        compensated ? "none" : "provision_cleanup_required",
        this.clock(),
      );
    } catch {
      return;
    }
  }

  private async awaitRemovalOwner(
    reservation: AssignmentWorktreeV1,
    runId: string,
    ticketId: string,
    assignmentId: string,
  ): Promise<AssignmentWorktreeV1> {
    for (let attempt = 0; attempt < 250; attempt += 1) {
      const current = await this.persistence.readByAssignment(
        runId,
        ticketId,
        assignmentId,
      );
      if (current === null || current.record.id !== reservation.id) {
        throw worktreeError(WORKTREE_ERROR_CODES.INCONSISTENT_STATE);
      }
      this.assertOwnership(
        current.record,
        current.ownership,
        runId,
        ticketId,
        assignmentId,
      );
      if (current.record.status === "removed") {
        return current.record;
      }
      if (
        current.record.status === "failed" &&
        current.record.failure_disposition === "removal_reconcile_required"
      ) {
        throw worktreeError(WORKTREE_ERROR_CODES.INCONSISTENT_STATE);
      }
      if (current.record.status !== "removing") {
        throw worktreeError(WORKTREE_ERROR_CODES.CONFLICT);
      }
      await this.wait(20);
    }
    throw worktreeError(WORKTREE_ERROR_CODES.CONFLICT);
  }

  private assertOwnership(
    record: AssignmentWorktreeV1,
    ownership: {
      repository_id: string;
      run_id: string;
      ticket_id: string;
      assignment_id: string;
      assignment_worktree_id: string | null;
    },
    runId: string,
    ticketId: string,
    assignmentId: string,
  ): void {
    this.assertCanonicalRecordIdentifiers(record);
    if (
      ownership.run_id !== runId ||
      ownership.ticket_id !== ticketId ||
      ownership.assignment_id !== assignmentId ||
      ownership.repository_id !== record.repository_id ||
      ownership.assignment_worktree_id !== record.id ||
      record.run_id !== runId ||
      record.ticket_id !== ticketId ||
      record.assignment_id !== assignmentId
    ) {
      throw worktreeError(WORKTREE_ERROR_CODES.NOT_FOUND);
    }
  }

  private assertProvisioningOwnership(
    record: AssignmentWorktreeV1,
    ownership: {
      repository_id: string;
      run_id: string;
      run_status: string;
      ticket_id: string;
      ticket_status: string;
      assignment_id: string;
      assignment_status: string;
      assignment_worktree_id: string | null;
    },
    runId: string,
    ticketId: string,
    assignmentId: string,
  ): void {
    this.assertCanonicalRecordIdentifiers(record);
    if (
      ownership.run_id !== runId ||
      ownership.ticket_id !== ticketId ||
      ownership.assignment_id !== assignmentId ||
      ownership.repository_id !== record.repository_id ||
      ownership.assignment_worktree_id !== null ||
      record.run_id !== runId ||
      record.ticket_id !== ticketId ||
      record.assignment_id !== assignmentId
    ) {
      throw worktreeError(WORKTREE_ERROR_CODES.NOT_FOUND);
    }
    this.assertProvisioningEligibility(ownership);
  }

  private assertProvisioningEligibility(ownership: {
    run_status: string;
    ticket_status: string;
    assignment_status: string;
  }): void {
    if (
      ownership.run_status !== "running" ||
      ownership.ticket_status !== "ready" ||
      ownership.assignment_status !== "assigned"
    ) {
      throw worktreeError(WORKTREE_ERROR_CODES.CONFLICT);
    }
  }

  private assertProvisioningIdentity(
    record: AssignmentWorktreeV1,
    bound: BoundRepository,
    repositoryId: string,
    runId: string,
    ticketId: string,
    assignmentId: string,
    managedPath: string,
    branchName: string,
    baseCommitSha: string | undefined,
  ): void {
    this.assertCanonicalRecordIdentifiers(record);
    if (
      record.repository_id !== repositoryId ||
      record.run_id !== runId ||
      record.ticket_id !== ticketId ||
      record.assignment_id !== assignmentId ||
      record.managed_path !== managedPath ||
      record.branch_name !== branchName ||
      (baseCommitSha !== undefined &&
        record.base_commit_sha !== baseCommitSha) ||
      !sameIdentity(record, bound)
    ) {
      throw worktreeError(WORKTREE_ERROR_CODES.INCONSISTENT_STATE);
    }
  }

  private assertDeterministicResourceIdentity(
    record: AssignmentWorktreeV1,
  ): void {
    if (
      record.managed_path !==
        this.deterministicPath(
          record.repository_id,
          record.run_id,
          record.ticket_id,
          record.assignment_id,
        ) ||
      record.branch_name !==
        this.deterministicBranch(
          record.run_id,
          record.ticket_id,
          record.assignment_id,
        )
    ) {
      throw worktreeError(WORKTREE_ERROR_CODES.INCONSISTENT_STATE);
    }
  }

  private advanceStage(
    record: AssignmentWorktreeV1,
    expectedStage: WorktreeOperationStage,
    targetStage: WorktreeOperationStage,
  ): Promise<AssignmentWorktreeV1> {
    if (record.operation_stage !== expectedStage) {
      throw worktreeError(WORKTREE_ERROR_CODES.INCONSISTENT_STATE);
    }
    return this.persistence.updateOperationStage(
      record.id,
      record.operation_token,
      expectedStage,
      targetStage,
      this.clock(),
    );
  }

  private resetProvisioningStage(
    record: AssignmentWorktreeV1,
  ): Promise<AssignmentWorktreeV1> {
    if (record.operation_stage === "reserved") {
      return Promise.resolve(record);
    }
    if (
      ![
        "branch_creating",
        "worktree_creating",
        "verifying",
        "activating",
      ].includes(record.operation_stage)
    ) {
      throw worktreeError(WORKTREE_ERROR_CODES.INCONSISTENT_STATE);
    }
    return this.advanceStage(record, record.operation_stage, "reserved");
  }

  private async setRetention(
    runId: string,
    ticketId: string,
    assignmentId: string,
    target: WorktreeRetentionStatus,
  ): Promise<AssignmentWorktreeV1> {
    const { record } = await this.requireActive(runId, ticketId, assignmentId);
    if (record.retention_status === target) {
      return record;
    }
    const occurredAt = this.clock();
    return this.persistence.changeRetention(
      record.id,
      target,
      occurredAt,
      worktreeEvent(
        this.nextIdentifier(),
        record,
        "worktree.retention_changed",
        occurredAt,
        Object.freeze({ from: record.retention_status, to: target }),
      ),
    );
  }

  private async verifyRecord(
    record: AssignmentWorktreeV1,
    bound: BoundRepository,
    requireBaseHead: boolean,
    requireClean: boolean,
  ): Promise<GitRepository> {
    this.assertCanonicalRecordIdentifiers(record);
    this.assertDeterministicResourceIdentity(record);
    if (!sameIdentity(record, bound)) {
      throw worktreeError(WORKTREE_ERROR_CODES.BINDING_DRIFT);
    }
    const resources = await this.resources(bound.repository, record);
    if (
      resources.collision ||
      resources.branchCommit !== record.base_commit_sha ||
      !this.matchesRegistered(record, resources.worktree)
    ) {
      throw worktreeError(WORKTREE_ERROR_CODES.COLLISION);
    }
    await assertCanonicalManagedPath(
      bound.managedRoot,
      record.managed_path,
      true,
    );
    const repository = await registerGitRepository(
      record.managed_path,
      record.default_branch,
    );
    if (
      repository.registration.identity.workingTreeRoot !==
        record.managed_path ||
      repository.registration.identity.commonGitDirectory !==
        record.common_git_directory
    ) {
      throw worktreeError(WORKTREE_ERROR_CODES.BINDING_DRIFT);
    }
    const head = await repository.getHead();
    if (
      !head.attached ||
      head.currentBranch !== record.branch_name ||
      (requireBaseHead && head.commitSha !== record.base_commit_sha)
    ) {
      throw worktreeError(WORKTREE_ERROR_CODES.INCONSISTENT_STATE);
    }
    if (requireClean && !(await repository.getStatus()).clean) {
      throw worktreeError(WORKTREE_ERROR_CODES.DIRTY);
    }
    return repository;
  }

  private matchesRegistered(
    record: AssignmentWorktreeV1,
    registered: RegisteredWorktree | undefined,
  ): boolean {
    return (
      registered !== undefined &&
      registered.path === record.managed_path &&
      registered.branch === record.branch_name &&
      registered.headCommitSha === record.base_commit_sha
    );
  }

  private async resources(
    repository: GitRepository,
    record: AssignmentWorktreeV1,
  ): Promise<ManagedResources> {
    this.assertDeterministicResourceIdentity(record);
    const [worktrees, branchCommit] = await Promise.all([
      repository.listWorktrees(),
      repository.getBranchCommit(record.branch_name),
    ]);
    const pathRegistrations = worktrees.filter(
      (candidate) => candidate.path === record.managed_path,
    );
    const branchRegistrations = worktrees.filter(
      (candidate) => candidate.branch === record.branch_name,
    );
    const exactRegistrations = pathRegistrations.filter(
      (candidate) => candidate.branch === record.branch_name,
    );
    const collision =
      pathRegistrations.length !== exactRegistrations.length ||
      branchRegistrations.length !== exactRegistrations.length ||
      exactRegistrations.length > 1 ||
      (exactRegistrations[0] !== undefined &&
        exactRegistrations[0].headCommitSha !== record.base_commit_sha);
    return Object.freeze({
      worktree: collision ? undefined : exactRegistrations[0],
      branchCommit,
      collision,
    });
  }

  private async resourcesAbsent(
    record: AssignmentWorktreeV1,
    repository: GitRepository,
  ): Promise<boolean> {
    const resources = await this.resources(repository, record);
    return (
      !resources.collision &&
      resources.worktree === undefined &&
      resources.branchCommit === null &&
      !(await pathExists(record.managed_path))
    );
  }

  private retryOwnership(record: AssignmentWorktreeV1): {
    createdBranch: boolean;
    createdWorktree: boolean;
  } {
    switch (record.operation_stage) {
      case "branch_creating":
        return { createdBranch: false, createdWorktree: false };
      case "worktree_creating":
        return { createdBranch: true, createdWorktree: false };
      case "verifying":
      case "activating":
        return { createdBranch: true, createdWorktree: true };
      default:
        return { createdBranch: false, createdWorktree: false };
    }
  }

  private async compensateProvisioning(
    record: AssignmentWorktreeV1,
    bound: BoundRepository,
    created: { createdBranch: boolean; createdWorktree: boolean },
  ): Promise<boolean> {
    try {
      const resources = await this.resources(bound.repository, record);
      if (resources.collision) {
        return false;
      }
      if (resources.worktree !== undefined) {
        if (
          !created.createdWorktree ||
          !this.matchesRegistered(record, resources.worktree)
        ) {
          return false;
        }
        const repository = await this.verifyRecord(record, bound, true, true);
        if (await repository.hasUnknownContent()) {
          return false;
        }
        await bound.repository.removeWorktree(
          record.managed_path,
          record.branch_name,
          record.base_commit_sha,
        );
      } else if (await pathExists(record.managed_path)) {
        return false;
      }
      const branchCommit = await bound.repository.getBranchCommit(
        record.branch_name,
      );
      if (branchCommit !== null) {
        if (!created.createdBranch || branchCommit !== record.base_commit_sha) {
          return false;
        }
        await bound.repository.deleteBranch(record.branch_name, branchCommit);
      }
      return true;
    } catch {
      return false;
    }
  }

  private async reconcileRemoval(
    record: AssignmentWorktreeV1,
    bound: BoundRepository,
  ): Promise<AssignmentWorktreeV1> {
    let current = record;
    if (current.operation_stage === "removing_worktree") {
      const resources = await this.resources(bound.repository, current);
      if (resources.collision) {
        throw worktreeError(WORKTREE_ERROR_CODES.COLLISION);
      }
      if (resources.worktree !== undefined) {
        if (
          !this.matchesRegistered(current, resources.worktree) ||
          resources.branchCommit !== current.base_commit_sha
        ) {
          throw worktreeError(WORKTREE_ERROR_CODES.COLLISION);
        }
        const repository = await this.verifyRecord(current, bound, true, true);
        await this.assertNoUnknownContent(repository);
        await bound.repository.removeWorktree(
          current.managed_path,
          current.branch_name,
          current.base_commit_sha,
        );
        await this.failpoint("after_worktree_removal");
      } else if (await pathExists(current.managed_path)) {
        throw worktreeError(WORKTREE_ERROR_CODES.COLLISION);
      }
      current = await this.advanceStage(
        current,
        "removing_worktree",
        "deleting_branch",
      );
    }

    if (current.operation_stage === "deleting_branch") {
      const resources = await this.resources(bound.repository, current);
      if (
        resources.collision ||
        resources.worktree !== undefined ||
        (await pathExists(current.managed_path))
      ) {
        throw worktreeError(WORKTREE_ERROR_CODES.COLLISION);
      }
      if (resources.branchCommit !== null) {
        if (resources.branchCommit !== current.base_commit_sha) {
          throw worktreeError(WORKTREE_ERROR_CODES.COLLISION);
        }
        await bound.repository.deleteBranch(
          current.branch_name,
          current.base_commit_sha,
        );
        await this.failpoint("after_branch_deletion");
      }
      current = await this.advanceStage(
        current,
        "deleting_branch",
        "finalizing_removal",
      );
    }

    if (current.operation_stage !== "finalizing_removal") {
      throw worktreeError(WORKTREE_ERROR_CODES.INCONSISTENT_STATE);
    }
    const finalResources = await this.resources(bound.repository, current);
    if (finalResources.collision) {
      throw worktreeError(WORKTREE_ERROR_CODES.COLLISION);
    }
    if (
      finalResources.worktree !== undefined ||
      finalResources.branchCommit !== null ||
      (await pathExists(current.managed_path))
    ) {
      throw worktreeError(WORKTREE_ERROR_CODES.INCONSISTENT_STATE);
    }
    return current;
  }

  private async assertNoUnknownContent(
    repository: GitRepository,
  ): Promise<void> {
    if (await repository.hasUnknownContent()) {
      throw worktreeError(WORKTREE_ERROR_CODES.DIRTY);
    }
  }
}
