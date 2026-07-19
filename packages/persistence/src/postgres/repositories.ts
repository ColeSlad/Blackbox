import {
  parseAgentAssignmentV1,
  parseIntentContractV1,
  parseRunV1,
  parseTicketV1,
  parseTransactionV1,
  type AgentAssignmentV1,
  type IntentContractV1,
  type RunV1,
  type TicketV1,
  type TransactionV1,
} from "@blackbox/contracts";
import type postgres from "postgres";

import { queryErrorFromCaught } from "../errors.js";
import type {
  AssignmentRepository,
  CommandRepositories,
  IntentRepository,
  RunRepository,
  TicketRepository,
  TransactionRepository,
} from "../repositories.js";
import type { DatabaseSql } from "./client.js";

function timestamp(value: unknown): string | null {
  if (value === null) {
    return null;
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  return String(value);
}

async function safely<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    throw queryErrorFromCaught(error);
  }
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

class PostgresRunRepository implements RunRepository {
  constructor(private readonly sql: DatabaseSql) {}

  create(record: RunV1): Promise<RunV1> {
    const input = parseRunV1(record);
    return safely(async () => {
      const [row] = await this.sql`
        INSERT INTO runs (
          id, schema_version, repository_id, title, base_commit_sha, status,
          configuration_version, created_at, started_at, completed_at
        ) VALUES (
          ${input.id}, ${input.schema_version}, ${input.repository_id},
          ${input.title}, ${input.base_commit_sha}, ${input.status},
          ${input.configuration_version}, ${input.created_at},
          ${input.started_at}, ${input.completed_at}
        )
        RETURNING *
      `;
      return runFromRow(row as postgres.Row);
    });
  }

  read(id: string): Promise<RunV1 | null> {
    return safely(async () => {
      const [row] = await this.sql`SELECT * FROM runs WHERE id = ${id}`;
      return row === undefined ? null : runFromRow(row);
    });
  }
}

function ticketFromRow(row: postgres.Row, dependencies: string[]): TicketV1 {
  return parseTicketV1({
    schema_version: row.schema_version,
    id: row.id,
    run_id: row.run_id,
    external_key: row.external_key,
    title: row.title,
    description: row.description,
    status: row.status,
    dependencies,
    acceptance_criteria: row.acceptance_criteria,
    manual_verification_steps: row.manual_verification_steps,
  });
}

class PostgresTicketRepository implements TicketRepository {
  constructor(private readonly sql: DatabaseSql) {}

  create(record: TicketV1): Promise<TicketV1> {
    const input = parseTicketV1(record);
    return safely(() =>
      this.sql.begin(async (transaction) => {
        const [row] = await transaction`
          INSERT INTO tickets (
            id, schema_version, run_id, external_key, title, description,
            status, acceptance_criteria, manual_verification_steps
          ) VALUES (
            ${input.id}, ${input.schema_version}, ${input.run_id},
            ${input.external_key}, ${input.title}, ${input.description},
            ${input.status}, ${transaction.array([...input.acceptance_criteria])},
            ${transaction.array([...input.manual_verification_steps])}
          )
          RETURNING *
        `;
        for (const dependencyId of input.dependencies) {
          await transaction`
            INSERT INTO ticket_dependencies (run_id, ticket_id, dependency_ticket_id)
            VALUES (${input.run_id}, ${input.id}, ${dependencyId})
          `;
        }
        return ticketFromRow(row as postgres.Row, [...input.dependencies]);
      }),
    );
  }

  read(id: string): Promise<TicketV1 | null> {
    return safely(async () => {
      const [row] = await this.sql`SELECT * FROM tickets WHERE id = ${id}`;
      if (row === undefined) {
        return null;
      }
      const dependencyRows = await this.sql`
        SELECT dependency_ticket_id
        FROM ticket_dependencies
        WHERE ticket_id = ${id}
        ORDER BY dependency_ticket_id
      `;
      return ticketFromRow(
        row,
        dependencyRows.map((dependency) =>
          String(dependency.dependency_ticket_id),
        ),
      );
    });
  }
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

class PostgresAssignmentRepository implements AssignmentRepository {
  constructor(private readonly sql: DatabaseSql) {}

  create(record: AgentAssignmentV1): Promise<AgentAssignmentV1> {
    const input = parseAgentAssignmentV1(record);
    return safely(async () => {
      const [row] = await this.sql`
        INSERT INTO assignments (
          id, schema_version, run_id, ticket_id, agent_id, worktree_id,
          status, assigned_at, released_at
        ) VALUES (
          ${input.id}, ${input.schema_version}, ${input.run_id},
          ${input.ticket_id}, ${input.agent_id}, ${input.worktree_id},
          ${input.status}, ${input.assigned_at}, ${input.released_at}
        )
        RETURNING *
      `;
      return assignmentFromRow(row as postgres.Row);
    });
  }

  read(id: string): Promise<AgentAssignmentV1 | null> {
    return safely(async () => {
      const [row] = await this.sql`SELECT * FROM assignments WHERE id = ${id}`;
      return row === undefined ? null : assignmentFromRow(row);
    });
  }
}

function intentFromRow(row: postgres.Row): IntentContractV1 {
  return parseIntentContractV1({
    schema_version: row.schema_version,
    id: row.id,
    assignment_id: row.assignment_id,
    version: row.version,
    goal: row.goal,
    reads: row.reads,
    writes: row.writes,
    assumptions: row.assumptions,
    public_contract_changes: row.public_contract_changes,
    required_validations: row.required_validations,
    declared_effects: row.declared_effects,
    created_at: timestamp(row.created_at),
  });
}

class PostgresIntentRepository implements IntentRepository {
  constructor(private readonly sql: DatabaseSql) {}

  create(record: IntentContractV1): Promise<IntentContractV1> {
    const input = parseIntentContractV1(record);
    return safely(async () => {
      const [row] = await this.sql`
        INSERT INTO intents (
          id, schema_version, assignment_id, version, goal, reads, writes,
          assumptions, public_contract_changes, required_validations,
          declared_effects, created_at
        ) VALUES (
          ${input.id}, ${input.schema_version}, ${input.assignment_id},
          ${input.version}, ${input.goal},
          ${this.sql.json(input.reads)},
          ${this.sql.json(input.writes)},
          ${this.sql.json(input.assumptions)},
          ${this.sql.json(input.public_contract_changes)},
          ${this.sql.array([...input.required_validations])},
          ${this.sql.json(input.declared_effects)},
          ${input.created_at}
        )
        RETURNING *
      `;
      return intentFromRow(row as postgres.Row);
    });
  }

  read(id: string): Promise<IntentContractV1 | null> {
    return safely(async () => {
      const [row] = await this.sql`SELECT * FROM intents WHERE id = ${id}`;
      return row === undefined ? null : intentFromRow(row);
    });
  }
}

function transactionFromRow(row: postgres.Row): TransactionV1 {
  return parseTransactionV1({
    schema_version: row.schema_version,
    id: row.id,
    run_id: row.run_id,
    ticket_id: row.ticket_id,
    assignment_id: row.assignment_id,
    intent_contract_id: row.intent_contract_id,
    intent_version: row.intent_version,
    base_commit_sha: row.base_commit_sha,
    prepared_patch_hash: row.prepared_patch_hash,
    status: row.status,
    created_at: timestamp(row.created_at),
    updated_at: timestamp(row.updated_at),
    completed_at: timestamp(row.completed_at),
  });
}

class PostgresTransactionRepository implements TransactionRepository {
  constructor(private readonly sql: DatabaseSql) {}

  create(record: TransactionV1): Promise<TransactionV1> {
    const input = parseTransactionV1(record);
    return safely(async () => {
      const [row] = await this.sql`
        INSERT INTO transactions (
          id, schema_version, run_id, ticket_id, assignment_id,
          intent_contract_id, intent_version, base_commit_sha,
          prepared_patch_hash, status, created_at, updated_at, completed_at
        ) VALUES (
          ${input.id}, ${input.schema_version}, ${input.run_id},
          ${input.ticket_id}, ${input.assignment_id},
          ${input.intent_contract_id}, ${input.intent_version},
          ${input.base_commit_sha}, ${input.prepared_patch_hash},
          ${input.status}, ${input.created_at}, ${input.updated_at},
          ${input.completed_at}
        )
        RETURNING *
      `;
      return transactionFromRow(row as postgres.Row);
    });
  }

  read(id: string): Promise<TransactionV1 | null> {
    return safely(async () => {
      const [row] = await this.sql`SELECT * FROM transactions WHERE id = ${id}`;
      return row === undefined ? null : transactionFromRow(row);
    });
  }
}

export function createPostgresRepositories(
  sql: DatabaseSql,
): CommandRepositories {
  return Object.freeze({
    runs: new PostgresRunRepository(sql),
    tickets: new PostgresTicketRepository(sql),
    assignments: new PostgresAssignmentRepository(sql),
    intents: new PostgresIntentRepository(sql),
    transactions: new PostgresTransactionRepository(sql),
  });
}
