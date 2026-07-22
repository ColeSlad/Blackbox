import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

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
import type {
  AssignmentWorktreeV1,
  WorktreeOutboxRecord,
} from "@blackbox/worktrees";
import postgres from "postgres";
import { describe, expect, it } from "vitest";

import { assertLocalDatabaseUrl, readDatabaseConfig } from "./config.js";
import { PERSISTENCE_ERROR_CODES, PersistenceError } from "./errors.js";
import {
  getMigrationStatus,
  migrateDatabase,
  readMigrationFiles,
} from "./migrator.js";
import { connectPostgres } from "./postgres/client.js";
import { createPostgresPersistence } from "./postgres/index.js";

interface DatabaseFixture {
  run: RunV1;
  prerequisite_ticket: TicketV1;
  ticket: TicketV1;
  assignment: AgentAssignmentV1;
  intent: IntentContractV1;
  transaction: TransactionV1;
}

const repositoryRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
);

async function loadFixture(): Promise<DatabaseFixture> {
  const value = JSON.parse(
    await readFile(
      path.join(repositoryRoot, "fixtures/database/command-records-v1.json"),
      "utf8",
    ),
  ) as Record<string, unknown>;
  return {
    run: parseRunV1(value.run),
    prerequisite_ticket: parseTicketV1(value.prerequisite_ticket),
    ticket: parseTicketV1(value.ticket),
    assignment: parseAgentAssignmentV1(value.assignment),
    intent: parseIntentContractV1(value.intent),
    transaction: parseTransactionV1(value.transaction),
  };
}

async function withTestDatabase<T>(
  operation: (url: string) => Promise<T>,
): Promise<T> {
  const configured = assertLocalDatabaseUrl(readDatabaseConfig().url);
  const databaseName = `blackbox_test_${randomUUID().replaceAll("-", "")}`;
  const administrationUrl = new URL(configured);
  administrationUrl.pathname = "/postgres";
  const administrationSql = postgres(administrationUrl.toString(), {
    connect_timeout: 5,
    max: 1,
    onnotice: () => undefined,
  });
  const testUrl = new URL(configured);
  testUrl.pathname = `/${databaseName}`;

  try {
    await administrationSql`CREATE DATABASE ${administrationSql(databaseName)}`;
    return await operation(testUrl.toString());
  } finally {
    await administrationSql`
      SELECT pg_terminate_backend(pid)
      FROM pg_stat_activity
      WHERE datname = ${databaseName} AND pid <> pg_backend_pid()
    `.catch(() => undefined);
    await administrationSql`DROP DATABASE IF EXISTS ${administrationSql(databaseName)}`.catch(
      () => undefined,
    );
    await administrationSql.end({ timeout: 5 }).catch(() => undefined);
  }
}

type TestPersistence = Awaited<ReturnType<typeof createPostgresPersistence>>;

interface WorktreeDatabaseFixture {
  readonly repositoryId: string;
  readonly runId: string;
  readonly baseCommitSha: string;
  readonly occurredAt: string;
  readonly assignments: readonly {
    readonly ticketId: string;
    readonly assignmentId: string;
  }[];
}

async function seedWorktreeAssignments(
  persistence: TestPersistence,
  count: number,
): Promise<WorktreeDatabaseFixture> {
  const repositoryId = randomUUID();
  const runId = randomUUID();
  const baseCommitSha = "a".repeat(40);
  const occurredAt = "2026-07-19T20:00:00.000Z";
  await persistence.sql`
    INSERT INTO runs (
      id, schema_version, repository_id, title, base_commit_sha, status,
      configuration_version, created_at, started_at
    ) VALUES (
      ${runId}, 1, ${repositoryId}, 'Run', ${baseCommitSha}, 'running',
      1, ${occurredAt}, ${occurredAt}
    )
  `;
  const assignments: { ticketId: string; assignmentId: string }[] = [];
  for (let index = 0; index < count; index += 1) {
    const ticketId = randomUUID();
    const assignmentId = randomUUID();
    await persistence.sql`
      INSERT INTO tickets (
        id, schema_version, run_id, external_key, title, description,
        status, acceptance_criteria, manual_verification_steps
      ) VALUES (
        ${ticketId}, 1, ${runId}, ${`T${index + 1}`}, 'Ticket',
        'Description', 'ready', ARRAY['pass'], ARRAY['inspect']
      )
    `;
    await persistence.sql`
      INSERT INTO assignments (
        id, schema_version, run_id, ticket_id, agent_id, status, assigned_at
      ) VALUES (
        ${assignmentId}, 1, ${runId}, ${ticketId}, ${randomUUID()},
        'assigned', ${occurredAt}
      )
    `;
    assignments.push({ ticketId, assignmentId });
  }
  return {
    repositoryId,
    runId,
    baseCommitSha,
    occurredAt,
    assignments,
  };
}

function worktreeInput(
  fixture: WorktreeDatabaseFixture,
  assignmentIndex: number,
  overrides: Partial<AssignmentWorktreeV1> = {},
): AssignmentWorktreeV1 {
  const assignment = fixture.assignments[assignmentIndex];
  if (assignment === undefined) {
    throw new Error("Missing assignment fixture.");
  }
  return {
    schema_version: 1,
    id: randomUUID(),
    repository_id: fixture.repositoryId,
    run_id: fixture.runId,
    ticket_id: assignment.ticketId,
    assignment_id: assignment.assignmentId,
    working_tree_root: "/repository",
    common_git_directory: "/repository/.git",
    default_branch: "main",
    base_commit_sha: "",
    managed_path: `/managed/${assignment.assignmentId}`,
    branch_name: `blackbox/worktree/${fixture.runId}/${assignment.ticketId}/${assignment.assignmentId}`,
    status: "provisioning",
    retention_status: "releasable",
    operation_token: randomUUID(),
    operation_stage: "reserved",
    failure_disposition: "none",
    created_at: fixture.occurredAt,
    updated_at: fixture.occurredAt,
    activated_at: null,
    removed_at: null,
    ...overrides,
  };
}

describe("required PostgreSQL migration integration", () => {
  it("fails rather than skipping when the configured PostgreSQL service is unavailable", async () => {
    const unavailableUrl =
      "postgres://do-not-expose:do-not-expose@127.0.0.1:1/unavailable";
    await expect(connectPostgres(unavailableUrl)).rejects.toMatchObject({
      code: PERSISTENCE_ERROR_CODES.CONNECTION_FAILED,
    });
  });

  it("migrates an empty database to the latest version", async () => {
    await withTestDatabase(async (url) => {
      const persistence = await createPostgresPersistence(url);
      try {
        await expect(migrateDatabase(persistence.sql)).resolves.toEqual([
          "0001",
          "0002",
          "0003",
          "0004",
        ]);
        const tables = await persistence.sql`
          SELECT table_name
          FROM information_schema.tables
          WHERE table_schema = 'public'
          ORDER BY table_name
        `;
        expect(tables.map(({ table_name }) => table_name)).toEqual([
          "assignment_worktrees",
          "assignments",
          "intents",
          "lifecycle_outbox",
          "runs",
          "schema_migrations",
          "ticket_dependencies",
          "tickets",
          "transactions",
        ]);
      } finally {
        await persistence.close();
      }
    });
  });

  it("upgrades a database at migration 0001 to latest", async () => {
    await withTestDatabase(async (url) => {
      const persistence = await createPostgresPersistence(url);
      try {
        const [migration] = await readMigrationFiles();
        expect(migration?.identifier).toBe("0001");
        if (migration === undefined) {
          throw new Error("Expected migration 0001.");
        }
        await persistence.sql.begin(async (transaction) => {
          await transaction.unsafe(migration.sql);
          await transaction`
            INSERT INTO schema_migrations (identifier, file_name, checksum)
            VALUES (
              ${migration.identifier}, ${migration.fileName},
              ${migration.checksum}
            )
          `;
        });
        await expect(migrateDatabase(persistence.sql)).resolves.toEqual([
          "0002",
          "0003",
          "0004",
        ]);
      } finally {
        await persistence.close();
      }
    });
  });

  it("upgrades a database at migration 0002 to latest", async () => {
    await withTestDatabase(async (url) => {
      const persistence = await createPostgresPersistence(url);
      try {
        const migrations = (await readMigrationFiles()).slice(0, 2);
        expect(migrations.map((migration) => migration.identifier)).toEqual([
          "0001",
          "0002",
        ]);
        for (const migration of migrations) {
          await persistence.sql.begin(async (transaction) => {
            await transaction.unsafe(migration.sql);
            await transaction`
              INSERT INTO schema_migrations (identifier, file_name, checksum)
              VALUES (
                ${migration.identifier}, ${migration.fileName},
                ${migration.checksum}
              )
            `;
          });
        }
        await expect(migrateDatabase(persistence.sql)).resolves.toEqual([
          "0003",
          "0004",
        ]);
        const tables = await persistence.sql`
          SELECT table_name
          FROM information_schema.tables
          WHERE table_schema = 'public' AND table_name = 'lifecycle_outbox'
        `;
        expect(tables).toHaveLength(1);
      } finally {
        await persistence.close();
      }
    });
  });

  it("reports repeated migration execution as a no-op without metadata changes", async () => {
    await withTestDatabase(async (url) => {
      const persistence = await createPostgresPersistence(url);
      try {
        await migrateDatabase(persistence.sql);
        const before = await getMigrationStatus(persistence.sql);
        await expect(migrateDatabase(persistence.sql)).resolves.toEqual([]);
        const after = await getMigrationStatus(persistence.sql);
        expect(after).toEqual(before);
        expect(after.current).toBe(true);
      } finally {
        await persistence.close();
      }
    });
  });

  it("refuses a changed checksum", async () => {
    await withTestDatabase(async (url) => {
      const persistence = await createPostgresPersistence(url);
      try {
        await migrateDatabase(persistence.sql);
        await persistence.sql`
          UPDATE schema_migrations
          SET checksum = ${"0".repeat(64)}
          WHERE identifier = ${"0002"}
        `;
        await expect(getMigrationStatus(persistence.sql)).rejects.toMatchObject(
          {
            code: PERSISTENCE_ERROR_CODES.MIGRATION_CHECKSUM_CHANGED,
          },
        );
      } finally {
        await persistence.close();
      }
    });
  });

  it("refuses a missing previously applied file", async () => {
    await withTestDatabase(async (url) => {
      const persistence = await createPostgresPersistence(url);
      try {
        await migrateDatabase(persistence.sql);
        await persistence.sql`
          INSERT INTO schema_migrations (identifier, file_name, checksum)
          VALUES (${"0000"}, ${"0000_missing.sql"}, ${"e".repeat(64)})
        `;
        await expect(getMigrationStatus(persistence.sql)).rejects.toMatchObject(
          {
            code: PERSISTENCE_ERROR_CODES.MIGRATION_FILE_MISSING,
          },
        );
      } finally {
        await persistence.close();
      }
    });
  });

  it("refuses an unknown future database version", async () => {
    await withTestDatabase(async (url) => {
      const persistence = await createPostgresPersistence(url);
      try {
        await migrateDatabase(persistence.sql);
        await persistence.sql`
          INSERT INTO schema_migrations (identifier, file_name, checksum)
          VALUES (${"9999"}, ${"9999_future.sql"}, ${"f".repeat(64)})
        `;
        await expect(getMigrationStatus(persistence.sql)).rejects.toMatchObject(
          {
            code: PERSISTENCE_ERROR_CODES.MIGRATION_FUTURE_VERSION,
          },
        );
      } finally {
        await persistence.close();
      }
    });
  });

  it("refuses applied migration metadata that is not a contiguous prefix", async () => {
    await withTestDatabase(async (url) => {
      const persistence = await createPostgresPersistence(url);
      try {
        await migrateDatabase(persistence.sql);
        await persistence.sql`
          DELETE FROM schema_migrations WHERE identifier = ${"0001"}
        `;
        await expect(getMigrationStatus(persistence.sql)).rejects.toMatchObject(
          {
            code: PERSISTENCE_ERROR_CODES.MIGRATION_INVALID,
          },
        );
        await expect(migrateDatabase(persistence.sql)).rejects.toMatchObject({
          code: PERSISTENCE_ERROR_CODES.MIGRATION_INVALID,
        });
        const records = await persistence.sql`
          SELECT identifier FROM schema_migrations ORDER BY identifier
        `;
        expect(records.map(({ identifier }) => identifier)).toEqual([
          "0002",
          "0003",
          "0004",
        ]);
      } finally {
        await persistence.close();
      }
    });
  });
});

describe("required PostgreSQL repository integration", () => {
  it("creates and reads every initial aggregate through public interfaces", async () => {
    await withTestDatabase(async (url) => {
      const persistence = await createPostgresPersistence(url);
      const fixture = await loadFixture();
      try {
        await migrateDatabase(persistence.sql);
        await persistence.repositories.runs.create(fixture.run);
        await persistence.repositories.tickets.create(
          fixture.prerequisite_ticket,
        );
        await persistence.repositories.tickets.create(fixture.ticket);
        await persistence.repositories.assignments.create(fixture.assignment);
        await persistence.repositories.intents.create(fixture.intent);
        await persistence.repositories.transactions.create(fixture.transaction);

        await expect(
          persistence.repositories.runs.read(fixture.run.id),
        ).resolves.toEqual(fixture.run);
        await expect(
          persistence.repositories.tickets.read(fixture.ticket.id),
        ).resolves.toEqual(fixture.ticket);
        await expect(
          persistence.repositories.assignments.read(fixture.assignment.id),
        ).resolves.toEqual(fixture.assignment);
        await expect(
          persistence.repositories.intents.read(fixture.intent.id),
        ).resolves.toEqual(fixture.intent);
        await expect(
          persistence.repositories.transactions.read(fixture.transaction.id),
        ).resolves.toEqual(fixture.transaction);
      } finally {
        await persistence.close();
      }
    });
  });

  it("enforces foreign keys, same-run dependencies, uniqueness, and self-dependency", async () => {
    await withTestDatabase(async (url) => {
      const persistence = await createPostgresPersistence(url);
      const fixture = await loadFixture();
      try {
        await migrateDatabase(persistence.sql);
        await persistence.repositories.runs.create(fixture.run);
        await persistence.repositories.tickets.create(
          fixture.prerequisite_ticket,
        );

        await expect(
          persistence.repositories.assignments.create(fixture.assignment),
        ).rejects.toMatchObject({
          code: PERSISTENCE_ERROR_CODES.CONSTRAINT_VIOLATION,
        });

        const selfDependent = parseTicketV1({
          ...fixture.ticket,
          dependencies: [fixture.ticket.id],
        });
        await expect(
          persistence.repositories.tickets.create(selfDependent),
        ).rejects.toMatchObject({
          code: PERSISTENCE_ERROR_CODES.CONSTRAINT_VIOLATION,
        });
        await expect(
          persistence.repositories.tickets.read(selfDependent.id),
        ).resolves.toBeNull();

        await persistence.repositories.tickets.create(fixture.ticket);
        await persistence.repositories.assignments.create(fixture.assignment);
        await persistence.repositories.intents.create(fixture.intent);
        await expect(
          persistence.repositories.intents.create(
            parseIntentContractV1({ ...fixture.intent, id: randomUUID() }),
          ),
        ).rejects.toMatchObject({
          code: PERSISTENCE_ERROR_CODES.CONSTRAINT_VIOLATION,
        });

        const secondRun = parseRunV1({
          ...fixture.run,
          id: randomUUID(),
          repository_id: randomUUID(),
        });
        await persistence.repositories.runs.create(secondRun);
        const crossRunDependency = parseTicketV1({
          ...fixture.ticket,
          id: randomUUID(),
          external_key: "cross-run",
          dependencies: [fixture.prerequisite_ticket.id],
          run_id: secondRun.id,
        });
        await expect(
          persistence.repositories.tickets.create(crossRunDependency),
        ).rejects.toMatchObject({
          code: PERSISTENCE_ERROR_CODES.CONSTRAINT_VIOLATION,
        });
      } finally {
        await persistence.close();
      }
    });
  });

  it("enforces schema versions in PostgreSQL", async () => {
    await withTestDatabase(async (url) => {
      const persistence = await createPostgresPersistence(url);
      try {
        await migrateDatabase(persistence.sql);
        await expect(
          persistence.sql`
            INSERT INTO runs (
              id, schema_version, repository_id, title, base_commit_sha,
              status, configuration_version, created_at
            ) VALUES (
              ${randomUUID()}, ${2}, ${randomUUID()}, ${"invalid version"},
              ${"a".repeat(40)}, ${"created"}, ${1}, ${new Date().toISOString()}
            )
          `,
        ).rejects.toMatchObject({ code: "23514" });
      } finally {
        await persistence.close();
      }
    });
  });

  it("sanitizes connection and query failures", async () => {
    const secretUrl =
      "postgres://visible-user:visible-password@127.0.0.1:1/visible-database";
    let connectionFailure: unknown;
    try {
      await connectPostgres(secretUrl);
    } catch (error) {
      connectionFailure = error;
    }
    expect(connectionFailure).toBeInstanceOf(PersistenceError);
    expect(String(connectionFailure)).not.toContain("visible-user");
    expect(String(connectionFailure)).not.toContain("visible-password");

    await withTestDatabase(async (url) => {
      const persistence = await createPostgresPersistence(url);
      try {
        await migrateDatabase(persistence.sql);
        const unsafeValue = "not-a-uuid-visible-value";
        let queryFailure: unknown;
        try {
          await persistence.repositories.runs.read(unsafeValue);
        } catch (error) {
          queryFailure = error;
        }
        expect(queryFailure).toMatchObject({
          code: PERSISTENCE_ERROR_CODES.QUERY_FAILED,
        });
        expect(String(queryFailure)).not.toContain(unsafeValue);
      } finally {
        await persistence.close();
      }
    });
  });

  it("serializes same-assignment reservations while allowing different assignments", async () => {
    await withTestDatabase(async (url) => {
      const persistence = await createPostgresPersistence(url);
      try {
        await migrateDatabase(persistence.sql);
        const fixture = await seedWorktreeAssignments(persistence, 3);
        const first = worktreeInput(fixture, 0);
        const competing = worktreeInput(fixture, 0);
        const sameAssignment = await Promise.all([
          persistence.worktrees.reserveProvisioning(first),
          persistence.worktrees.reserveProvisioning(competing),
        ]);
        expect(sameAssignment.filter(({ acquired }) => acquired)).toHaveLength(
          1,
        );
        expect(new Set(sameAssignment.map(({ record }) => record.id))).toEqual(
          new Set([first.id]),
        );

        const differentAssignments = await Promise.all([
          persistence.worktrees.reserveProvisioning(worktreeInput(fixture, 1)),
          persistence.worktrees.reserveProvisioning(worktreeInput(fixture, 2)),
        ]);
        expect(differentAssignments.every(({ acquired }) => acquired)).toBe(
          true,
        );
        expect(
          new Set(
            differentAssignments.map(({ record }) => record.assignment_id),
          ).size,
        ).toBe(2);
      } finally {
        await persistence.close();
      }
    });
  });

  it("enforces resource uniqueness, guarded stages, and retry ownership", async () => {
    await withTestDatabase(async (url) => {
      const persistence = await createPostgresPersistence(url);
      try {
        await migrateDatabase(persistence.sql);
        const fixture = await seedWorktreeAssignments(persistence, 8);
        const original = worktreeInput(fixture, 0);
        await persistence.worktrees.reserveProvisioning(original);

        for (const duplicate of [
          worktreeInput(fixture, 1, { managed_path: original.managed_path }),
          worktreeInput(fixture, 2, { branch_name: original.branch_name }),
          worktreeInput(fixture, 3, {
            operation_token: original.operation_token,
          }),
        ]) {
          await expect(
            persistence.worktrees.reserveProvisioning(duplicate),
          ).rejects.toMatchObject({
            code: PERSISTENCE_ERROR_CODES.CONSTRAINT_VIOLATION,
          });
        }
        const idempotent = await persistence.worktrees.reserveProvisioning({
          ...original,
          id: randomUUID(),
          operation_token: randomUUID(),
        });
        expect(idempotent).toMatchObject({
          acquired: false,
          record: { id: original.id },
        });

        await expect(
          persistence.worktrees.updateOperationStage(
            original.id,
            original.operation_token,
            "reserved",
            "active",
            fixture.occurredAt,
          ),
        ).rejects.toMatchObject({
          code: PERSISTENCE_ERROR_CODES.CONSTRAINT_VIOLATION,
        });
        expect(
          await persistence.worktrees.readByAssignment(
            fixture.runId,
            original.ticket_id,
            original.assignment_id,
          ),
        ).toMatchObject({ record: { operation_stage: "reserved" } });

        await persistence.worktrees.failProvisioning(
          original.id,
          original.operation_token,
          "none",
          fixture.occurredAt,
        );
        await persistence.sql`
          UPDATE assignments SET status = 'released', released_at = ${fixture.occurredAt}
          WHERE id = ${original.assignment_id}
        `;
        await expect(
          persistence.worktrees.retryProvisioning(
            original.id,
            original.operation_token,
            randomUUID(),
            fixture.occurredAt,
            fixture.occurredAt,
          ),
        ).rejects.toMatchObject({
          code: PERSISTENCE_ERROR_CODES.QUERY_FAILED,
        });
        expect(
          await persistence.worktrees.readByAssignment(
            fixture.runId,
            original.ticket_id,
            original.assignment_id,
          ),
        ).toMatchObject({
          record: {
            status: "failed",
            operation_token: original.operation_token,
          },
        });

        const retryable = worktreeInput(fixture, 4);
        await persistence.worktrees.reserveProvisioning(retryable);
        await persistence.worktrees.failProvisioning(
          retryable.id,
          retryable.operation_token,
          "none",
          fixture.occurredAt,
        );
        const retryTokens = [randomUUID(), randomUUID()];
        const retried = await Promise.all([
          persistence.worktrees.retryProvisioning(
            retryable.id,
            retryable.operation_token,
            retryTokens[0]!,
            fixture.occurredAt,
            fixture.occurredAt,
          ),
          persistence.worktrees.retryProvisioning(
            retryable.id,
            retryable.operation_token,
            retryTokens[1]!,
            fixture.occurredAt,
            fixture.occurredAt,
          ),
        ]);
        expect(retried.filter(({ acquired }) => acquired)).toHaveLength(1);
        expect(retryTokens).toContain(
          retried.find(({ acquired }) => acquired)?.record.operation_token,
        );

        const cleanupRequired = worktreeInput(fixture, 6);
        let cleanupStage = (
          await persistence.worktrees.reserveProvisioning(cleanupRequired)
        ).record;
        for (const target of [
          "branch_creating",
          "worktree_creating",
          "verifying",
        ] as const) {
          cleanupStage = await persistence.worktrees.updateOperationStage(
            cleanupRequired.id,
            cleanupRequired.operation_token,
            cleanupStage.operation_stage,
            target,
            fixture.occurredAt,
          );
        }
        await persistence.worktrees.failProvisioning(
          cleanupRequired.id,
          cleanupRequired.operation_token,
          "provision_cleanup_required",
          fixture.occurredAt,
        );
        const cleanupToken = randomUUID();
        const cleanupRetry = await persistence.worktrees.retryProvisioning(
          cleanupRequired.id,
          cleanupRequired.operation_token,
          cleanupToken,
          fixture.occurredAt,
          fixture.occurredAt,
        );
        expect(cleanupRetry).toMatchObject({
          acquired: true,
          record: {
            status: "provisioning",
            operation_token: cleanupToken,
            operation_stage: "verifying",
            failure_disposition: "provision_cleanup_required",
          },
        });
        await expect(
          persistence.worktrees.updateOperationStage(
            cleanupRequired.id,
            cleanupToken,
            "verifying",
            "reserved",
            fixture.occurredAt,
          ),
        ).resolves.toMatchObject({
          operation_stage: "reserved",
          failure_disposition: "none",
        });

        const wrongOwnership = worktreeInput(fixture, 5, {
          repository_id: randomUUID(),
        });
        await expect(
          persistence.worktrees.reserveProvisioning(wrongOwnership),
        ).rejects.toMatchObject({
          code: PERSISTENCE_ERROR_CODES.QUERY_FAILED,
        });

        const foreignAssignment = fixture.assignments[7]!;
        await expect(
          persistence.sql`
            INSERT INTO assignment_worktrees (
              id, schema_version, repository_id, run_id, ticket_id,
              assignment_id, working_tree_root, common_git_directory,
              default_branch, base_commit_sha, managed_path, branch_name,
              status, retention_status, operation_token, operation_stage,
              failure_disposition, created_at, updated_at
            ) VALUES (
              ${randomUUID()}, 1, ${fixture.repositoryId}, ${fixture.runId},
              ${original.ticket_id}, ${foreignAssignment.assignmentId},
              '/repository', '/repository/.git', 'main',
              ${fixture.baseCommitSha}, ${`/managed/fk-${randomUUID()}`},
              ${`blackbox/worktree/fk/${randomUUID()}`}, 'provisioning',
              'releasable', ${randomUUID()}, 'reserved', 'none',
              ${fixture.occurredAt}, ${fixture.occurredAt}
            )
          `,
        ).rejects.toMatchObject({ code: "23503" });
        await expect(
          persistence.sql`
            INSERT INTO assignment_worktrees (
              id, schema_version, repository_id, run_id, ticket_id,
              assignment_id, working_tree_root, common_git_directory,
              default_branch, base_commit_sha, managed_path, branch_name,
              status, retention_status, operation_token, operation_stage,
              failure_disposition, created_at, updated_at
            ) VALUES (
              ${randomUUID()}, 1, ${randomUUID()}, ${fixture.runId},
              ${foreignAssignment.ticketId}, ${foreignAssignment.assignmentId},
              '/repository', '/repository/.git', 'main',
              ${fixture.baseCommitSha}, ${`/managed/fk-${randomUUID()}`},
              ${`blackbox/worktree/fk/${randomUUID()}`}, 'provisioning',
              'releasable', ${randomUUID()}, 'reserved', 'none',
              ${fixture.occurredAt}, ${fixture.occurredAt}
            )
          `,
        ).rejects.toMatchObject({ code: "23503" });
      } finally {
        await persistence.close();
      }
    });
  });

  it("rejects ownership drift introduced after activation reservation", async () => {
    await withTestDatabase(async (url) => {
      const persistence = await createPostgresPersistence(url);
      try {
        await migrateDatabase(persistence.sql);
        const fixture = await seedWorktreeAssignments(persistence, 1);
        const input = worktreeInput(fixture, 0);
        let staged = (await persistence.worktrees.reserveProvisioning(input))
          .record;
        for (const target of [
          "branch_creating",
          "worktree_creating",
          "verifying",
          "activating",
        ] as const) {
          staged = await persistence.worktrees.updateOperationStage(
            input.id,
            input.operation_token,
            staged.operation_stage,
            target,
            fixture.occurredAt,
          );
        }
        await persistence.sql`
          UPDATE runs SET base_commit_sha = ${"b".repeat(40)}
          WHERE id = ${fixture.runId}
        `;

        await expect(
          persistence.worktrees.activate(
            input.id,
            input.operation_token,
            fixture.occurredAt,
            {
              schema_version: 1,
              event_id: randomUUID(),
              aggregate_type: "worktree",
              aggregate_id: input.id,
              run_id: fixture.runId,
              event_name: "worktree.created",
              occurred_at: fixture.occurredAt,
              payload: { assignment_id: input.assignment_id },
            },
          ),
        ).rejects.toMatchObject({ code: PERSISTENCE_ERROR_CODES.QUERY_FAILED });
        expect(
          await persistence.worktrees.readByAssignment(
            fixture.runId,
            input.ticket_id,
            input.assignment_id,
          ),
        ).toMatchObject({
          ownership: { assignment_worktree_id: null },
          record: { status: "provisioning", operation_stage: "activating" },
        });
        const events = await persistence.sql`
          SELECT event_id FROM lifecycle_outbox
          WHERE aggregate_type = 'worktree' AND aggregate_id = ${input.id}
        `;
        expect(events).toHaveLength(0);
      } finally {
        await persistence.close();
      }
    });
  });

  it("rolls back worktree state when outbox persistence fails", async () => {
    await withTestDatabase(async (url) => {
      const persistence = await createPostgresPersistence(url);
      try {
        await migrateDatabase(persistence.sql);
        const fixture = await seedWorktreeAssignments(persistence, 1);
        const input = worktreeInput(fixture, 0);
        let staged = (await persistence.worktrees.reserveProvisioning(input))
          .record;
        for (const target of [
          "branch_creating",
          "worktree_creating",
          "verifying",
          "activating",
        ] as const) {
          staged = await persistence.worktrees.updateOperationStage(
            input.id,
            input.operation_token,
            staged.operation_stage,
            target,
            fixture.occurredAt,
          );
        }
        const duplicateEventId = randomUUID();
        await persistence.sql`
          INSERT INTO lifecycle_outbox (
            event_id, schema_version, aggregate_type, aggregate_id, run_id,
            event_name, occurred_at, payload
          ) VALUES (
            ${duplicateEventId}, 1, 'run', ${fixture.runId}, ${fixture.runId},
            'run.created', ${fixture.occurredAt},
            ${persistence.sql.json({ source: "test" })}
          )
        `;
        const event = (
          eventId: string,
          eventName: WorktreeOutboxRecord["event_name"],
        ): WorktreeOutboxRecord => ({
          schema_version: 1,
          event_id: eventId,
          aggregate_type: "worktree",
          aggregate_id: input.id,
          run_id: fixture.runId,
          event_name: eventName,
          occurred_at: fixture.occurredAt,
          payload: { assignment_id: input.assignment_id },
        });

        await expect(
          persistence.worktrees.activate(
            input.id,
            input.operation_token,
            fixture.occurredAt,
            event(duplicateEventId, "worktree.created"),
          ),
        ).rejects.toMatchObject({
          code: PERSISTENCE_ERROR_CODES.CONSTRAINT_VIOLATION,
        });
        expect(
          await persistence.worktrees.readByAssignment(
            fixture.runId,
            input.ticket_id,
            input.assignment_id,
          ),
        ).toMatchObject({
          ownership: { assignment_worktree_id: null },
          record: { status: "provisioning", operation_stage: "activating" },
        });

        const createdEventId = randomUUID();
        await persistence.worktrees.activate(
          input.id,
          input.operation_token,
          fixture.occurredAt,
          event(createdEventId, "worktree.created"),
        );
        await persistence.sql`
          UPDATE assignments SET status = 'released', released_at = ${fixture.occurredAt}
          WHERE id = ${input.assignment_id}
        `;
        const removalReservations = await Promise.all([
          persistence.worktrees.reserveRemoval(
            input.id,
            input.operation_token,
            randomUUID(),
            fixture.occurredAt,
            fixture.occurredAt,
          ),
          persistence.worktrees.reserveRemoval(
            input.id,
            input.operation_token,
            randomUUID(),
            fixture.occurredAt,
            fixture.occurredAt,
          ),
        ]);
        expect(
          removalReservations.filter(({ acquired }) => acquired),
        ).toHaveLength(1);
        let removing = removalReservations.find(
          ({ acquired }) => acquired,
        )!.record;
        for (const target of [
          "deleting_branch",
          "finalizing_removal",
        ] as const) {
          removing = await persistence.worktrees.updateOperationStage(
            input.id,
            removing.operation_token,
            removing.operation_stage,
            target,
            fixture.occurredAt,
          );
        }
        await expect(
          persistence.worktrees.markRemoved(
            input.id,
            removing.operation_token,
            fixture.occurredAt,
            event(createdEventId, "worktree.removed"),
          ),
        ).rejects.toMatchObject({
          code: PERSISTENCE_ERROR_CODES.CONSTRAINT_VIOLATION,
        });
        expect(
          await persistence.worktrees.readByAssignment(
            fixture.runId,
            input.ticket_id,
            input.assignment_id,
          ),
        ).toMatchObject({
          record: {
            status: "removing",
            operation_stage: "finalizing_removal",
          },
        });

        const removed = await persistence.worktrees.markRemoved(
          input.id,
          removing.operation_token,
          fixture.occurredAt,
          event(randomUUID(), "worktree.removed"),
        );
        expect(removed.status).toBe("removed");
        const worktreeEvents = await persistence.sql`
          SELECT event_name FROM lifecycle_outbox
          WHERE aggregate_type = 'worktree' AND aggregate_id = ${input.id}
          ORDER BY event_name
        `;
        expect(worktreeEvents.map(({ event_name }) => event_name)).toEqual([
          "worktree.created",
          "worktree.removed",
        ]);
      } finally {
        await persistence.close();
      }
    });
  });

  it("persists worktree ownership, transitions, historical binding, and exact outbox cardinality", async () => {
    await withTestDatabase(async (url) => {
      const persistence = await createPostgresPersistence(url);
      try {
        await migrateDatabase(persistence.sql);
        const repositoryId = randomUUID();
        const runId = randomUUID();
        const ticketId = randomUUID();
        const assignmentId = randomUUID();
        const worktreeId = randomUUID();
        const operationToken = randomUUID();
        const baseCommitSha = "a".repeat(40);
        const occurredAt = "2026-07-19T20:00:00.000Z";
        await persistence.sql`
          INSERT INTO runs (
            id, schema_version, repository_id, title, base_commit_sha, status,
            configuration_version, created_at, started_at
          ) VALUES (
            ${runId}, 1, ${repositoryId}, 'Run', ${baseCommitSha}, 'running',
            1, ${occurredAt}, ${occurredAt}
          )
        `;
        await persistence.sql`
          INSERT INTO tickets (
            id, schema_version, run_id, external_key, title, description,
            status, acceptance_criteria, manual_verification_steps
          ) VALUES (
            ${ticketId}, 1, ${runId}, 'T1', 'Ticket', 'Description', 'ready',
            ARRAY['pass'], ARRAY['inspect']
          )
        `;
        await persistence.sql`
          INSERT INTO assignments (
            id, schema_version, run_id, ticket_id, agent_id, status, assigned_at
          ) VALUES (
            ${assignmentId}, 1, ${runId}, ${ticketId}, ${randomUUID()},
            'assigned', ${occurredAt}
          )
        `;
        const input: AssignmentWorktreeV1 = {
          schema_version: 1,
          id: worktreeId,
          repository_id: repositoryId,
          run_id: runId,
          ticket_id: ticketId,
          assignment_id: assignmentId,
          working_tree_root: "/repository",
          common_git_directory: "/repository/.git",
          default_branch: "main",
          base_commit_sha: "",
          managed_path: `/managed/${assignmentId}`,
          branch_name: `blackbox/worktree/${runId}/${ticketId}/${assignmentId}`,
          status: "provisioning",
          retention_status: "releasable",
          operation_token: operationToken,
          operation_stage: "reserved",
          failure_disposition: "none",
          created_at: occurredAt,
          updated_at: occurredAt,
          activated_at: null,
          removed_at: null,
        };
        const reserved = await persistence.worktrees.reserveProvisioning(input);
        expect(reserved).toMatchObject({
          acquired: true,
          record: { base_commit_sha: baseCommitSha, status: "provisioning" },
        });
        let staged = reserved.record;
        for (const target of [
          "branch_creating",
          "worktree_creating",
          "verifying",
          "activating",
        ] as const) {
          staged = await persistence.worktrees.updateOperationStage(
            worktreeId,
            operationToken,
            staged.operation_stage,
            target,
            occurredAt,
          );
        }
        const event = (
          eventName: WorktreeOutboxRecord["event_name"],
          payload: WorktreeOutboxRecord["payload"],
        ): WorktreeOutboxRecord => ({
          schema_version: 1,
          event_id: randomUUID(),
          aggregate_type: "worktree",
          aggregate_id: worktreeId,
          run_id: runId,
          event_name: eventName,
          occurred_at: occurredAt,
          payload,
        });
        await persistence.worktrees.activate(
          worktreeId,
          operationToken,
          occurredAt,
          event("worktree.created", { assignment_id: assignmentId }),
        );
        await persistence.worktrees.changeRetention(
          worktreeId,
          "retained",
          occurredAt,
          event("worktree.retention_changed", {
            from: "releasable",
            to: "retained",
          }),
        );
        await persistence.worktrees.changeRetention(
          worktreeId,
          "releasable",
          occurredAt,
          event("worktree.retention_changed", {
            from: "retained",
            to: "releasable",
          }),
        );
        await persistence.sql`
          UPDATE assignments SET status = 'released', released_at = ${occurredAt}
          WHERE id = ${assignmentId}
        `;
        let removing = (
          await persistence.worktrees.reserveRemoval(
            worktreeId,
            operationToken,
            randomUUID(),
            occurredAt,
            occurredAt,
          )
        ).record;
        removing = await persistence.worktrees.updateOperationStage(
          worktreeId,
          removing.operation_token,
          removing.operation_stage,
          "deleting_branch",
          occurredAt,
        );
        await persistence.worktrees.updateOperationStage(
          worktreeId,
          removing.operation_token,
          removing.operation_stage,
          "finalizing_removal",
          occurredAt,
        );
        const removed = await persistence.worktrees.markRemoved(
          worktreeId,
          removing.operation_token,
          occurredAt,
          event("worktree.removed", { assignment_id: assignmentId }),
        );
        expect(removed.status).toBe("removed");
        const assignment = await persistence.sql`
          SELECT worktree_id FROM assignments WHERE id = ${assignmentId}
        `;
        expect(assignment[0]?.worktree_id).toBe(worktreeId);
        const events = await persistence.sql`
          SELECT event_name FROM lifecycle_outbox
          WHERE aggregate_type = 'worktree' AND aggregate_id = ${worktreeId}
          ORDER BY occurred_at, event_name, event_id
        `;
        expect(events.map(({ event_name }) => event_name).sort()).toEqual([
          "worktree.created",
          "worktree.removed",
          "worktree.retention_changed",
          "worktree.retention_changed",
        ]);
        await expect(
          persistence.sql`
            UPDATE assignment_worktrees SET status = 'active'
            WHERE id = ${worktreeId}
          `,
        ).rejects.toMatchObject({ code: "23514" });
      } finally {
        await persistence.close();
      }
    });
  });
});
