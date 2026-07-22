import type postgres from "postgres";
import type {
  AssignmentWorktreeV1,
  ProvisionReservation,
  WorktreeOutboxRecord,
  WorktreeOwnership,
  WorktreePersistence,
} from "@blackbox/worktrees";

import { queryError, queryErrorFromCaught } from "../errors.js";
import type { DatabaseSql, TransactionSql } from "./client.js";

function timestamp(value: unknown): string | null {
  return value === null
    ? null
    : value instanceof Date
      ? value.toISOString()
      : String(value);
}

function recordFromRow(row: postgres.Row): AssignmentWorktreeV1 {
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

function ownershipFromRow(row: postgres.Row): WorktreeOwnership {
  return Object.freeze({
    repository_id: String(row.repository_id),
    run_id: String(row.run_id),
    run_status: String(row.run_status),
    base_commit_sha: String(row.run_base_commit_sha),
    ticket_id: String(row.ticket_id),
    ticket_status: String(row.ticket_status),
    assignment_id: String(row.assignment_id),
    assignment_status: String(row.assignment_status),
    assignment_worktree_id:
      row.assignment_worktree_id === null
        ? null
        : String(row.assignment_worktree_id),
  });
}

async function insertOutbox(
  sql: TransactionSql,
  event: WorktreeOutboxRecord,
): Promise<void> {
  await sql`
    INSERT INTO lifecycle_outbox (
      event_id, schema_version, aggregate_type, aggregate_id, run_id,
      event_name, occurred_at, payload
    ) VALUES (
      ${event.event_id}, ${event.schema_version}, ${event.aggregate_type},
      ${event.aggregate_id}, ${event.run_id}, ${event.event_name},
      ${event.occurred_at}, ${sql.json(event.payload)}
    )
  `;
}

async function selectOwnership(
  sql: DatabaseSql | TransactionSql,
  runId: string,
  ticketId: string,
  assignmentId: string,
  lock: boolean,
): Promise<postgres.Row | undefined> {
  const rows = lock
    ? await sql`
        SELECT run.repository_id, run.id AS run_id, run.status AS run_status,
               run.base_commit_sha AS run_base_commit_sha,
               ticket.id AS ticket_id, ticket.status AS ticket_status,
               assignment.id AS assignment_id,
               assignment.status AS assignment_status,
               assignment.worktree_id AS assignment_worktree_id
        FROM runs run
        JOIN tickets ticket ON ticket.run_id = run.id
        JOIN assignments assignment
          ON assignment.run_id = run.id AND assignment.ticket_id = ticket.id
        WHERE run.id = ${runId} AND ticket.id = ${ticketId}
          AND assignment.id = ${assignmentId}
        FOR UPDATE OF run, ticket, assignment
      `
    : await sql`
        SELECT run.repository_id, run.id AS run_id, run.status AS run_status,
               run.base_commit_sha AS run_base_commit_sha,
               ticket.id AS ticket_id, ticket.status AS ticket_status,
               assignment.id AS assignment_id,
               assignment.status AS assignment_status,
               assignment.worktree_id AS assignment_worktree_id
        FROM runs run
        JOIN tickets ticket ON ticket.run_id = run.id
        JOIN assignments assignment
          ON assignment.run_id = run.id AND assignment.ticket_id = ticket.id
        WHERE run.id = ${runId} AND ticket.id = ${ticketId}
          AND assignment.id = ${assignmentId}
      `;
  return rows[0];
}

async function transaction<T>(
  sql: DatabaseSql,
  operation: (transactionSql: TransactionSql) => Promise<T>,
): Promise<T> {
  try {
    return (await sql.begin(operation)) as T;
  } catch (error) {
    throw queryErrorFromCaught(error);
  }
}

function requireSingle(rows: readonly postgres.Row[]): postgres.Row {
  if (rows.length !== 1 || rows[0] === undefined) {
    throw queryError();
  }
  return rows[0];
}

export function createPostgresWorktreePersistence(
  sql: DatabaseSql,
): WorktreePersistence {
  const persistence: WorktreePersistence = {
    readByAssignment: async (runId, ticketId, assignmentId) => {
      try {
        const ownershipRow = await selectOwnership(
          sql,
          runId,
          ticketId,
          assignmentId,
          false,
        );
        if (ownershipRow === undefined) {
          return null;
        }
        const rows = await sql`
          SELECT * FROM assignment_worktrees
          WHERE run_id = ${runId} AND ticket_id = ${ticketId}
            AND assignment_id = ${assignmentId}
        `;
        return rows[0] === undefined
          ? null
          : Object.freeze({
              ownership: ownershipFromRow(ownershipRow),
              record: recordFromRow(rows[0]),
            });
      } catch (error) {
        throw queryErrorFromCaught(error);
      }
    },
    reserveProvisioning: (input): Promise<ProvisionReservation> =>
      transaction(sql, async (tx) => {
        const ownershipRow = await selectOwnership(
          tx,
          input.run_id,
          input.ticket_id,
          input.assignment_id,
          true,
        );
        if (ownershipRow === undefined) {
          throw queryError();
        }
        const ownership = ownershipFromRow(ownershipRow);
        if (
          ownership.repository_id !== input.repository_id ||
          ownership.run_status !== "running" ||
          ownership.ticket_status !== "ready" ||
          ownership.assignment_status !== "assigned"
        ) {
          throw queryError();
        }
        const existing = await tx`
          SELECT * FROM assignment_worktrees
          WHERE assignment_id = ${input.assignment_id}
          FOR UPDATE
        `;
        if (existing[0] !== undefined) {
          return Object.freeze({
            record: recordFromRow(existing[0]),
            acquired: false,
          });
        }
        if (ownership.assignment_worktree_id !== null) {
          throw queryError();
        }
        const rows = await tx`
          INSERT INTO assignment_worktrees (
            id, schema_version, repository_id, run_id, ticket_id,
            assignment_id, working_tree_root, common_git_directory,
            default_branch, base_commit_sha, managed_path, branch_name, status,
            retention_status, operation_token, operation_stage,
            failure_disposition, created_at, updated_at, activated_at, removed_at
          ) VALUES (
            ${input.id}, 1, ${input.repository_id}, ${input.run_id},
            ${input.ticket_id}, ${input.assignment_id},
            ${input.working_tree_root}, ${input.common_git_directory},
            ${input.default_branch}, ${ownership.base_commit_sha},
            ${input.managed_path}, ${input.branch_name}, 'provisioning',
            'releasable', ${input.operation_token}, 'reserved', 'none',
            ${input.created_at}, ${input.updated_at}, NULL, NULL
          ) RETURNING *
        `;
        return Object.freeze({
          record: recordFromRow(requireSingle(rows)),
          acquired: true,
        });
      }),
    retryProvisioning: (
      worktreeId,
      expectedOperationToken,
      operationToken,
      occurredAt,
      staleBefore,
    ) =>
      transaction(sql, async (tx) => {
        const identityRows = await tx`
          SELECT run_id, ticket_id, assignment_id
          FROM assignment_worktrees WHERE id = ${worktreeId}
        `;
        const identity = requireSingle(identityRows);
        const ownershipRow = await selectOwnership(
          tx,
          String(identity.run_id),
          String(identity.ticket_id),
          String(identity.assignment_id),
          true,
        );
        if (ownershipRow === undefined) {
          throw queryError();
        }
        const ownership = ownershipFromRow(ownershipRow);
        if (
          ownership.run_status !== "running" ||
          ownership.ticket_status !== "ready" ||
          ownership.assignment_status !== "assigned" ||
          ownership.assignment_worktree_id !== null
        ) {
          throw queryError();
        }
        const current = recordFromRow(
          requireSingle(
            await tx`
              SELECT * FROM assignment_worktrees
              WHERE id = ${worktreeId} FOR UPDATE
            `,
          ),
        );
        const staleProvisioning =
          current.status === "provisioning" &&
          Date.parse(current.updated_at) <= Date.parse(staleBefore);
        const retryableFailure =
          current.status === "failed" &&
          ["none", "provision_cleanup_required"].includes(
            current.failure_disposition,
          );
        if (
          current.operation_token !== expectedOperationToken ||
          (!staleProvisioning && !retryableFailure)
        ) {
          return Object.freeze({ record: current, acquired: false });
        }
        const rows = await tx`
          UPDATE assignment_worktrees
          SET status = 'provisioning', operation_token = ${operationToken},
              updated_at = ${occurredAt}
          WHERE id = ${worktreeId} AND operation_token = ${expectedOperationToken}
          RETURNING *
        `;
        return Object.freeze({
          record: recordFromRow(requireSingle(rows)),
          acquired: true,
        });
      }),
    updateOperationStage: (
      worktreeId,
      operationToken,
      expectedStage,
      targetStage,
      occurredAt,
    ) =>
      transaction(sql, async (tx) => {
        const rows = await tx`
          UPDATE assignment_worktrees
          SET operation_stage = ${targetStage},
              failure_disposition = CASE
                WHEN ${targetStage} = 'reserved' THEN 'none'
                ELSE failure_disposition
              END,
              updated_at = ${occurredAt}
          WHERE id = ${worktreeId} AND operation_token = ${operationToken}
            AND operation_stage = ${expectedStage}
            AND status IN ('provisioning', 'removing')
          RETURNING *
        `;
        return recordFromRow(requireSingle(rows));
      }),
    activate: (worktreeId, operationToken, occurredAt, event) =>
      transaction(sql, async (tx) => {
        const identity = requireSingle(
          await tx`
            SELECT run_id, ticket_id, assignment_id
            FROM assignment_worktrees WHERE id = ${worktreeId}
          `,
        );
        const ownershipRow = await selectOwnership(
          tx,
          String(identity.run_id),
          String(identity.ticket_id),
          String(identity.assignment_id),
          true,
        );
        if (ownershipRow === undefined) {
          throw queryError();
        }
        const ownership = ownershipFromRow(ownershipRow);
        const record = recordFromRow(
          requireSingle(
            await tx`
              SELECT * FROM assignment_worktrees
              WHERE id = ${worktreeId} FOR UPDATE
            `,
          ),
        );
        if (
          record.id !== worktreeId ||
          record.repository_id !== ownership.repository_id ||
          record.run_id !== ownership.run_id ||
          record.ticket_id !== ownership.ticket_id ||
          record.assignment_id !== ownership.assignment_id ||
          record.base_commit_sha !== ownership.base_commit_sha
        ) {
          throw queryError();
        }
        if (
          record.status === "active" &&
          record.operation_token === operationToken
        ) {
          if (ownership.assignment_worktree_id !== record.id) {
            throw queryError();
          }
          return record;
        }
        if (
          record.status !== "provisioning" ||
          record.operation_token !== operationToken ||
          record.operation_stage !== "activating" ||
          ownership.run_status !== "running" ||
          ownership.ticket_status !== "ready" ||
          ownership.assignment_status !== "assigned" ||
          ownership.assignment_worktree_id !== null ||
          event.aggregate_id !== record.id ||
          event.run_id !== record.run_id ||
          event.event_name !== "worktree.created" ||
          event.occurred_at !== occurredAt ||
          event.payload.assignment_id !== record.assignment_id
        ) {
          throw queryError();
        }
        const assignments = await tx`
          UPDATE assignments SET worktree_id = ${record.id}
          WHERE id = ${record.assignment_id} AND run_id = ${record.run_id}
            AND ticket_id = ${record.ticket_id} AND status = 'assigned'
            AND worktree_id IS NULL
          RETURNING id
        `;
        requireSingle(assignments);
        const rows = await tx`
          UPDATE assignment_worktrees
          SET status = 'active', failure_disposition = 'none',
              operation_stage = 'active', updated_at = ${occurredAt},
              activated_at = ${occurredAt}
          WHERE id = ${worktreeId} AND status = 'provisioning'
            AND operation_token = ${operationToken}
            AND operation_stage = 'activating'
          RETURNING *
        `;
        await insertOutbox(tx, event);
        return recordFromRow(requireSingle(rows));
      }),
    failProvisioning: (worktreeId, operationToken, disposition, occurredAt) =>
      transaction(sql, async (tx) => {
        const rows = await tx`
          UPDATE assignment_worktrees
          SET status = 'failed', failure_disposition = ${disposition},
              updated_at = ${occurredAt}
          WHERE id = ${worktreeId} AND status = 'provisioning'
            AND operation_token = ${operationToken}
          RETURNING id
        `;
        requireSingle(rows);
      }),
    changeRetention: (worktreeId, target, occurredAt, event) =>
      transaction(sql, async (tx) => {
        const rows = await tx`
          UPDATE assignment_worktrees
          SET retention_status = ${target}, updated_at = ${occurredAt}
          WHERE id = ${worktreeId} AND status = 'active'
            AND retention_status <> ${target}
          RETURNING *
        `;
        await insertOutbox(tx, event);
        return recordFromRow(requireSingle(rows));
      }),
    reserveRemoval: (
      worktreeId,
      expectedOperationToken,
      operationToken,
      occurredAt,
      staleBefore,
    ) =>
      transaction(sql, async (tx) => {
        const row = requireSingle(
          await tx`
          SELECT worktree.*, assignment.status AS assignment_status,
                 assignment.worktree_id AS assignment_owned_worktree_id
          FROM assignment_worktrees worktree
          JOIN assignments assignment ON assignment.id = worktree.assignment_id
          WHERE worktree.id = ${worktreeId}
          FOR UPDATE OF worktree, assignment
        `,
        );
        const record = recordFromRow(row);
        if (
          !["released", "failed", "cancelled"].includes(
            String(row.assignment_status),
          ) ||
          record.retention_status !== "releasable" ||
          String(row.assignment_owned_worktree_id) !== record.id
        ) {
          throw queryError();
        }
        const staleRemoval =
          record.status === "removing" &&
          Date.parse(record.updated_at) <= Date.parse(staleBefore);
        const retryableFailure =
          record.status === "failed" &&
          record.failure_disposition === "removal_reconcile_required";
        if (
          record.operation_token !== expectedOperationToken ||
          (record.status !== "active" && !retryableFailure && !staleRemoval)
        ) {
          return Object.freeze({ record, acquired: false });
        }
        if (
          record.status === "active" &&
          record.retention_status !== "releasable"
        ) {
          throw queryError();
        }
        const rows = await tx`
          UPDATE assignment_worktrees
          SET status = 'removing', failure_disposition = 'none',
              operation_token = ${operationToken},
              operation_stage = CASE
                WHEN status = 'active' THEN 'removing_worktree'
                ELSE operation_stage
              END,
              updated_at = ${occurredAt}
          WHERE id = ${worktreeId}
            AND operation_token = ${expectedOperationToken}
          RETURNING *
        `;
        return Object.freeze({
          record: recordFromRow(requireSingle(rows)),
          acquired: true,
        });
      }),
    failRemoval: (worktreeId, operationToken, occurredAt) =>
      transaction(sql, async (tx) => {
        requireSingle(
          await tx`
          UPDATE assignment_worktrees
          SET status = 'failed',
              failure_disposition = 'removal_reconcile_required',
              updated_at = ${occurredAt}
          WHERE id = ${worktreeId} AND status = 'removing'
            AND operation_token = ${operationToken}
          RETURNING id
        `,
        );
      }),
    markRemoved: (worktreeId, operationToken, occurredAt, event) =>
      transaction(sql, async (tx) => {
        const rows = await tx`
          UPDATE assignment_worktrees
          SET status = 'removed', failure_disposition = 'none',
              operation_stage = 'removed', updated_at = ${occurredAt},
              removed_at = ${occurredAt}
          WHERE id = ${worktreeId} AND (
            status = 'removing' OR
            (status = 'failed' AND failure_disposition = 'removal_reconcile_required')
          )
            AND operation_token = ${operationToken}
            AND operation_stage = 'finalizing_removal'
          RETURNING *
        `;
        await insertOutbox(tx, event);
        return recordFromRow(requireSingle(rows));
      }),
  };
  return Object.freeze(persistence);
}
