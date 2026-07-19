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
        ]);
        const tables = await persistence.sql`
          SELECT table_name
          FROM information_schema.tables
          WHERE table_schema = 'public'
          ORDER BY table_name
        `;
        expect(tables.map(({ table_name }) => table_name)).toEqual([
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
});
