import type { JsonObjectV1 } from "./json.js";

export type WorktreeStatus =
  "provisioning" | "active" | "removing" | "removed" | "failed";
export type WorktreeRetentionStatus = "releasable" | "retained";
export type WorktreeFailureDisposition =
  "none" | "provision_cleanup_required" | "removal_reconcile_required";
export type WorktreeOperationStage =
  | "reserved"
  | "branch_creating"
  | "worktree_creating"
  | "verifying"
  | "activating"
  | "active"
  | "removing_worktree"
  | "deleting_branch"
  | "finalizing_removal"
  | "removed";

export interface AssignmentWorktreeV1 {
  readonly schema_version: 1;
  readonly id: string;
  readonly repository_id: string;
  readonly run_id: string;
  readonly ticket_id: string;
  readonly assignment_id: string;
  readonly working_tree_root: string;
  readonly common_git_directory: string;
  readonly default_branch: string;
  readonly base_commit_sha: string;
  readonly managed_path: string;
  readonly branch_name: string;
  readonly status: WorktreeStatus;
  readonly retention_status: WorktreeRetentionStatus;
  readonly operation_token: string;
  readonly operation_stage: WorktreeOperationStage;
  readonly failure_disposition: WorktreeFailureDisposition;
  readonly created_at: string;
  readonly updated_at: string;
  readonly activated_at: string | null;
  readonly removed_at: string | null;
}

export interface WorktreeOwnership {
  readonly repository_id: string;
  readonly run_id: string;
  readonly run_status: string;
  readonly base_commit_sha: string;
  readonly ticket_id: string;
  readonly ticket_status: string;
  readonly assignment_id: string;
  readonly assignment_status: string;
  readonly assignment_worktree_id: string | null;
}

export interface WorktreeOutboxRecord {
  readonly schema_version: 1;
  readonly event_id: string;
  readonly aggregate_type: "worktree";
  readonly aggregate_id: string;
  readonly run_id: string;
  readonly event_name:
    "worktree.created" | "worktree.removed" | "worktree.retention_changed";
  readonly occurred_at: string;
  readonly payload: JsonObjectV1;
}

export interface ProvisionReservation {
  readonly record: AssignmentWorktreeV1;
  readonly acquired: boolean;
}

export interface WorktreePersistence {
  readByAssignment(
    runId: string,
    ticketId: string,
    assignmentId: string,
  ): Promise<{
    readonly ownership: WorktreeOwnership;
    readonly record: AssignmentWorktreeV1;
  } | null>;
  reserveProvisioning(
    record: AssignmentWorktreeV1,
  ): Promise<ProvisionReservation>;
  retryProvisioning(
    worktreeId: string,
    expectedOperationToken: string,
    operationToken: string,
    occurredAt: string,
    staleBefore: string,
  ): Promise<ProvisionReservation>;
  updateOperationStage(
    worktreeId: string,
    operationToken: string,
    expectedStage: WorktreeOperationStage,
    targetStage: WorktreeOperationStage,
    occurredAt: string,
  ): Promise<AssignmentWorktreeV1>;
  activate(
    worktreeId: string,
    operationToken: string,
    occurredAt: string,
    event: WorktreeOutboxRecord,
  ): Promise<AssignmentWorktreeV1>;
  failProvisioning(
    worktreeId: string,
    operationToken: string,
    disposition: "none" | "provision_cleanup_required",
    occurredAt: string,
  ): Promise<void>;
  changeRetention(
    worktreeId: string,
    target: WorktreeRetentionStatus,
    occurredAt: string,
    event: WorktreeOutboxRecord,
  ): Promise<AssignmentWorktreeV1>;
  reserveRemoval(
    worktreeId: string,
    expectedOperationToken: string,
    operationToken: string,
    occurredAt: string,
    staleBefore: string,
  ): Promise<ProvisionReservation>;
  failRemoval(
    worktreeId: string,
    operationToken: string,
    occurredAt: string,
  ): Promise<void>;
  markRemoved(
    worktreeId: string,
    operationToken: string,
    occurredAt: string,
    event: WorktreeOutboxRecord,
  ): Promise<AssignmentWorktreeV1>;
}
