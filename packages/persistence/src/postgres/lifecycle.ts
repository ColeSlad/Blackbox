import {
  parseAgentAssignmentV1,
  parseRunV1,
  parseTicketV1,
  type AgentAssignmentV1,
  type RunV1,
  type TicketV1,
} from "@blackbox/contracts";
import type postgres from "postgres";
import type { AssignmentWorktreeV1 } from "@blackbox/worktrees";

import { queryError, queryErrorFromCaught } from "../errors.js";
import type {
  LifecycleOutboxRecord,
  LifecyclePersistence,
  LifecycleRunGraph,
  LifecycleUnitOfWork,
} from "../lifecycle.js";
import type { DatabaseSql, TransactionSql } from "./client.js";

type QuerySql = DatabaseSql | TransactionSql;

function worktreeFromRow(row: postgres.Row): AssignmentWorktreeV1 {
  return Object.freeze({
    schema_version: 1,
    id: String(row.id),
    repository_id: String(row.repository_id),
    run_id: String(row.run_id),
    ticket_id: String(row.ticket_id),
    assignment_id: String(row.assignment_id),
    working_tree_root: String(row.working_tree_root),
    common_git_directory: String(row.common_git_directory),
    default_branch: String(row.default_branch),
    base_commit_sha: String(row.base_commit_sha),
    managed_path: String(row.managed_path),
    branch_name: String(row.branch_name),
    status: row.status as AssignmentWorktreeV1["status"],
    retention_status:
      row.retention_status as AssignmentWorktreeV1["retention_status"],
    operation_token: String(row.operation_token),
    operation_stage:
      row.operation_stage as AssignmentWorktreeV1["operation_stage"],
    failure_disposition:
      row.failure_disposition as AssignmentWorktreeV1["failure_disposition"],
    created_at: timestamp(row.created_at) ?? "",
    updated_at: timestamp(row.updated_at) ?? "",
    activated_at: timestamp(row.activated_at),
    removed_at: timestamp(row.removed_at),
  });
}

function timestamp(value: unknown): string | null {
  if (value === null) {
    return null;
  }
  return value instanceof Date ? value.toISOString() : String(value);
}

function runFromRow(row: postgres.Row): RunV1 {
  return parseRunV1({
    schema_version: row.schema_version,
    id: row.id,
    repository_id: row.repository_id,
    title: row.title,
    base_commit_sha: row.base_commit_sha,
    status: row.status,
    configuration_version: row.configuration_version,
    created_at: timestamp(row.created_at),
    started_at: timestamp(row.started_at),
    completed_at: timestamp(row.completed_at),
  });
}

function ticketFromRow(
  row: postgres.Row,
  dependencies: readonly string[],
): TicketV1 {
  return parseTicketV1({
    schema_version: row.schema_version,
    id: row.id,
    run_id: row.run_id,
    external_key: row.external_key,
    title: row.title,
    description: row.description,
    status: row.status,
    dependencies: [...dependencies],
    acceptance_criteria: row.acceptance_criteria,
    manual_verification_steps: row.manual_verification_steps,
  });
}

function assignmentFromRow(row: postgres.Row): AgentAssignmentV1 {
  return parseAgentAssignmentV1({
    schema_version: row.schema_version,
    id: row.id,
    run_id: row.run_id,
    ticket_id: row.ticket_id,
    agent_id: row.agent_id,
    worktree_id: row.worktree_id,
    status: row.status,
    assigned_at: timestamp(row.assigned_at),
    released_at: timestamp(row.released_at),
  });
}

function caughtCode(value: unknown): string | undefined {
  try {
    if (
      (typeof value === "object" || typeof value === "function") &&
      value !== null
    ) {
      const code = Reflect.get(value, "code") as unknown;
      return typeof code === "string" ? code : undefined;
    }
  } catch {
    return undefined;
  }
  return undefined;
}

async function databaseOperation<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    throw queryErrorFromCaught(error);
  }
}

async function readGraph(
  sql: QuerySql,
  runId: string,
  lock: "none" | "share" | "update",
): Promise<LifecycleRunGraph | null> {
  const runRows =
    lock === "update"
      ? await sql`SELECT * FROM runs WHERE id = ${runId} FOR UPDATE`
      : lock === "share"
        ? await sql`SELECT * FROM runs WHERE id = ${runId} FOR SHARE`
        : await sql`SELECT * FROM runs WHERE id = ${runId}`;
  const runRow = runRows[0];
  if (runRow === undefined) {
    return null;
  }
  const ticketRows =
    lock === "update"
      ? await sql`
        SELECT * FROM tickets
        WHERE run_id = ${runId}
        ORDER BY external_key, id
        FOR UPDATE
      `
      : await sql`
        SELECT * FROM tickets
        WHERE run_id = ${runId}
        ORDER BY external_key, id
      `;
  const assignmentRows =
    lock === "update"
      ? await sql`
        SELECT * FROM assignments
        WHERE run_id = ${runId}
        ORDER BY id
        FOR UPDATE
      `
      : await sql`
        SELECT * FROM assignments
        WHERE run_id = ${runId}
        ORDER BY id
      `;
  const dependencyRows = await sql`
    SELECT ticket_id, dependency_ticket_id
    FROM ticket_dependencies
    WHERE run_id = ${runId}
    ORDER BY ticket_id, dependency_ticket_id
  `;
  const dependencies = new Map<string, string[]>();
  for (const row of dependencyRows) {
    const ticketId = String(row.ticket_id);
    const values = dependencies.get(ticketId) ?? [];
    values.push(String(row.dependency_ticket_id));
    dependencies.set(ticketId, values);
  }
  return Object.freeze({
    run: runFromRow(runRow),
    tickets: Object.freeze(
      ticketRows.map((row) =>
        ticketFromRow(row, dependencies.get(String(row.id)) ?? []),
      ),
    ),
    assignments: Object.freeze(assignmentRows.map(assignmentFromRow)),
  });
}

class PostgresLifecycleUnitOfWork implements LifecycleUnitOfWork {
  constructor(private readonly sql: TransactionSql) {}

  readRunGraph(runId: string): Promise<LifecycleRunGraph | null> {
    return databaseOperation(() => readGraph(this.sql, runId, "update"));
  }

  async readAssignmentWorktree(
    worktreeId: string,
  ): Promise<AssignmentWorktreeV1 | null> {
    return databaseOperation(async () => {
      const rows = await this.sql`
        SELECT * FROM assignment_worktrees WHERE id = ${worktreeId} FOR UPDATE
      `;
      return rows[0] === undefined ? null : worktreeFromRow(rows[0]);
    });
  }

  async insertRun(record: RunV1): Promise<void> {
    const input = parseRunV1(record);
    await databaseOperation(async () => {
      await this.sql`
        INSERT INTO runs (
          id, schema_version, repository_id, title, base_commit_sha, status,
          configuration_version, created_at, started_at, completed_at
        ) VALUES (
          ${input.id}, ${input.schema_version}, ${input.repository_id},
          ${input.title}, ${input.base_commit_sha}, ${input.status},
          ${input.configuration_version}, ${input.created_at},
          ${input.started_at}, ${input.completed_at}
        )
      `;
    });
  }

  async insertTicket(record: TicketV1): Promise<void> {
    const input = parseTicketV1(record);
    await databaseOperation(async () => {
      await this.sql`
        INSERT INTO tickets (
          id, schema_version, run_id, external_key, title, description,
          status, acceptance_criteria, manual_verification_steps
        ) VALUES (
          ${input.id}, ${input.schema_version}, ${input.run_id},
          ${input.external_key}, ${input.title}, ${input.description},
          ${input.status}, ${this.sql.array([...input.acceptance_criteria])},
          ${this.sql.array([...input.manual_verification_steps])}
        )
      `;
    });
  }

  async insertDependency(
    runId: string,
    ticketId: string,
    dependencyTicketId: string,
  ): Promise<void> {
    await databaseOperation(async () => {
      await this.sql`
        INSERT INTO ticket_dependencies (
          run_id, ticket_id, dependency_ticket_id
        ) VALUES (${runId}, ${ticketId}, ${dependencyTicketId})
      `;
    });
  }

  async insertAssignment(record: AgentAssignmentV1): Promise<void> {
    const input = parseAgentAssignmentV1(record);
    await databaseOperation(async () => {
      await this.sql`
        INSERT INTO assignments (
          id, schema_version, run_id, ticket_id, agent_id, worktree_id,
          status, assigned_at, released_at
        ) VALUES (
          ${input.id}, ${input.schema_version}, ${input.run_id},
          ${input.ticket_id}, ${input.agent_id}, ${input.worktree_id},
          ${input.status}, ${input.assigned_at}, ${input.released_at}
        )
      `;
    });
  }

  async updateRun(
    record: RunV1,
    expectedStatus: RunV1["status"],
  ): Promise<void> {
    const input = parseRunV1(record);
    await databaseOperation(async () => {
      const rows = await this.sql`
        UPDATE runs
        SET status = ${input.status}, started_at = ${input.started_at},
            completed_at = ${input.completed_at}
        WHERE id = ${input.id} AND status = ${expectedStatus}
        RETURNING id
      `;
      if (rows.length !== 1) {
        throw queryError();
      }
    });
  }

  async updateTicket(
    record: TicketV1,
    expectedStatus: TicketV1["status"],
  ): Promise<void> {
    const input = parseTicketV1(record);
    await databaseOperation(async () => {
      const rows = await this.sql`
        UPDATE tickets SET status = ${input.status}
        WHERE id = ${input.id} AND run_id = ${input.run_id}
          AND status = ${expectedStatus}
        RETURNING id
      `;
      if (rows.length !== 1) {
        throw queryError();
      }
    });
  }

  async updateAssignment(
    record: AgentAssignmentV1,
    expectedStatus: AgentAssignmentV1["status"],
  ): Promise<void> {
    const input = parseAgentAssignmentV1(record);
    await databaseOperation(async () => {
      const rows = await this.sql`
        UPDATE assignments
        SET status = ${input.status}, released_at = ${input.released_at}
        WHERE id = ${input.id} AND run_id = ${input.run_id}
          AND status = ${expectedStatus}
        RETURNING id
      `;
      if (rows.length !== 1) {
        throw queryError();
      }
    });
  }

  async insertOutbox(record: LifecycleOutboxRecord): Promise<void> {
    await databaseOperation(async () => {
      await this.sql`
        INSERT INTO lifecycle_outbox (
          event_id, schema_version, aggregate_type, aggregate_id, run_id,
          event_name, occurred_at, payload
        ) VALUES (
          ${record.event_id}, ${record.schema_version},
          ${record.aggregate_type}, ${record.aggregate_id}, ${record.run_id},
          ${record.event_name}, ${record.occurred_at},
          ${this.sql.json(record.payload)}
        )
      `;
    });
  }
}

export function createPostgresLifecyclePersistence(
  sql: DatabaseSql,
): LifecyclePersistence {
  return Object.freeze({
    readRunGraph: async (runId: string) =>
      databaseOperation(
        async () =>
          (await sql.begin((transaction) =>
            readGraph(transaction, runId, "share"),
          )) as LifecycleRunGraph | null,
      ),
    transaction: async <T>(
      operation: (unitOfWork: LifecycleUnitOfWork) => Promise<T>,
    ): Promise<T> => {
      try {
        return (await sql.begin((transaction) =>
          operation(new PostgresLifecycleUnitOfWork(transaction)),
        )) as T;
      } catch (error) {
        const code = caughtCode(error);
        if (code !== undefined && /^[0-9A-Z]{5}$/.test(code)) {
          throw queryErrorFromCaught(error);
        }
        throw error;
      }
    },
  });
}
