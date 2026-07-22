import type {
  AgentAssignmentV1,
  JsonObjectV1,
  RunV1,
  TicketV1,
} from "@blackbox/contracts";
import type { AssignmentWorktreeV1 } from "@blackbox/worktrees";

export type LifecycleAggregateType =
  "assignment" | "run" | "ticket" | "worktree";

export interface LifecycleOutboxRecord {
  readonly schema_version: 1;
  readonly event_id: string;
  readonly aggregate_type: LifecycleAggregateType;
  readonly aggregate_id: string;
  readonly run_id: string;
  readonly event_name:
    | "assignment.created"
    | "assignment.status_changed"
    | "run.created"
    | "run.status_changed"
    | "ticket.created"
    | "ticket.status_changed"
    | "worktree.created"
    | "worktree.removed"
    | "worktree.retention_changed";
  readonly occurred_at: string;
  readonly payload: JsonObjectV1;
}

export interface LifecycleRunGraph {
  readonly run: RunV1;
  readonly tickets: readonly TicketV1[];
  readonly assignments: readonly AgentAssignmentV1[];
}

export interface LifecycleUnitOfWork {
  readRunGraph(runId: string): Promise<LifecycleRunGraph | null>;
  readAssignmentWorktree?(
    worktreeId: string,
  ): Promise<AssignmentWorktreeV1 | null>;
  insertRun(record: RunV1): Promise<void>;
  insertTicket(record: TicketV1): Promise<void>;
  insertDependency(
    runId: string,
    ticketId: string,
    dependencyTicketId: string,
  ): Promise<void>;
  insertAssignment(record: AgentAssignmentV1): Promise<void>;
  updateRun(record: RunV1, expectedStatus: RunV1["status"]): Promise<void>;
  updateTicket(
    record: TicketV1,
    expectedStatus: TicketV1["status"],
  ): Promise<void>;
  updateAssignment(
    record: AgentAssignmentV1,
    expectedStatus: AgentAssignmentV1["status"],
  ): Promise<void>;
  insertOutbox(record: LifecycleOutboxRecord): Promise<void>;
}

export interface LifecyclePersistence {
  readRunGraph(runId: string): Promise<LifecycleRunGraph | null>;
  transaction<T>(
    operation: (unitOfWork: LifecycleUnitOfWork) => Promise<T>,
  ): Promise<T>;
}
