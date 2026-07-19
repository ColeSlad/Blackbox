import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  migrationError,
  PERSISTENCE_ERROR_CODES,
  queryError,
  queryErrorFromCaught,
  trustedPersistenceError,
} from "./errors.js";
import type { DatabaseSql } from "./postgres/client.js";

export const DEFAULT_MIGRATION_DIRECTORY = new URL(
  "../migrations/",
  import.meta.url,
);

export interface MigrationFile {
  readonly identifier: string;
  readonly fileName: string;
  readonly checksum: string;
  readonly sql: string;
}

export interface AppliedMigration {
  readonly identifier: string;
  readonly fileName: string;
  readonly checksum: string;
  readonly appliedAt: string;
}

export interface MigrationStatus {
  readonly current: boolean;
  readonly applied: readonly AppliedMigration[];
  readonly pending: readonly Pick<MigrationFile, "identifier" | "fileName">[];
}

function compareStrings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

export async function readMigrationFiles(
  directory: URL | string = DEFAULT_MIGRATION_DIRECTORY,
): Promise<MigrationFile[]> {
  const directoryPath =
    directory instanceof URL
      ? fileURLToPath(directory)
      : path.resolve(directory);
  let names: string[];
  try {
    names = (await readdir(directoryPath)).filter((name) =>
      name.endsWith(".sql"),
    );
  } catch {
    throw migrationError(PERSISTENCE_ERROR_CODES.MIGRATION_INVALID);
  }
  const migrations: MigrationFile[] = [];
  const identifiers = new Set<string>();

  for (const fileName of names) {
    const match = /^(\d{4})_[a-z0-9_]+\.sql$/.exec(fileName);
    if (match === null) {
      throw migrationError(PERSISTENCE_ERROR_CODES.MIGRATION_INVALID);
    }
    const identifier = match[1] as string;
    if (identifiers.has(identifier)) {
      throw migrationError(PERSISTENCE_ERROR_CODES.MIGRATION_INVALID);
    }
    identifiers.add(identifier);
    let sql: string;
    try {
      sql = await readFile(path.join(directoryPath, fileName), "utf8");
    } catch {
      throw migrationError(PERSISTENCE_ERROR_CODES.MIGRATION_INVALID);
    }
    if (sql.trim() === "") {
      throw migrationError(PERSISTENCE_ERROR_CODES.MIGRATION_INVALID);
    }
    migrations.push({
      identifier,
      fileName,
      checksum: createHash("sha256").update(sql).digest("hex"),
      sql,
    });
  }

  migrations.sort((left, right) =>
    compareStrings(left.identifier, right.identifier),
  );
  if (migrations.length === 0 || migrations[0]?.identifier !== "0001") {
    throw migrationError(PERSISTENCE_ERROR_CODES.MIGRATION_INVALID);
  }
  return migrations;
}

async function readAppliedMigrations(
  sql: DatabaseSql,
): Promise<AppliedMigration[]> {
  const [existence] = await sql`
    SELECT to_regclass('public.schema_migrations') AS relation
  `;
  if (existence?.relation === null) {
    return [];
  }
  const rows = await sql`
    SELECT identifier, file_name, checksum, applied_at
    FROM schema_migrations
    ORDER BY identifier
  `;
  return rows.map((row) => ({
    identifier: String(row.identifier),
    fileName: String(row.file_name),
    checksum: String(row.checksum),
    appliedAt:
      row.applied_at instanceof Date
        ? row.applied_at.toISOString()
        : String(row.applied_at),
  }));
}

function validateAppliedState(
  available: readonly MigrationFile[],
  applied: readonly AppliedMigration[],
): void {
  const availableByIdentifier = new Map(
    available.map((migration) => [migration.identifier, migration]),
  );
  const latestIdentifier = available.at(-1)?.identifier as string;

  for (const record of applied) {
    const migration = availableByIdentifier.get(record.identifier);
    if (migration === undefined) {
      if (record.identifier > latestIdentifier) {
        throw migrationError(PERSISTENCE_ERROR_CODES.MIGRATION_FUTURE_VERSION);
      }
      throw migrationError(PERSISTENCE_ERROR_CODES.MIGRATION_FILE_MISSING);
    }
    if (
      migration.fileName !== record.fileName ||
      migration.checksum !== record.checksum
    ) {
      throw migrationError(PERSISTENCE_ERROR_CODES.MIGRATION_CHECKSUM_CHANGED);
    }
  }

  for (const [index, record] of applied.entries()) {
    if (record.identifier !== available[index]?.identifier) {
      throw migrationError(PERSISTENCE_ERROR_CODES.MIGRATION_INVALID);
    }
  }
}

export async function getMigrationStatus(
  sql: DatabaseSql,
): Promise<MigrationStatus> {
  try {
    const available = await readMigrationFiles();
    const applied = await readAppliedMigrations(sql);
    validateAppliedState(available, applied);
    const appliedIdentifiers = new Set(
      applied.map((entry) => entry.identifier),
    );
    const pending = available
      .filter((migration) => !appliedIdentifiers.has(migration.identifier))
      .map(({ identifier, fileName }) => ({ identifier, fileName }));
    return Object.freeze({
      current: pending.length === 0,
      applied: Object.freeze(applied),
      pending: Object.freeze(pending),
    });
  } catch (error) {
    const trustedError = trustedPersistenceError(error);
    if (trustedError !== undefined) {
      throw trustedError;
    }
    throw queryErrorFromCaught(error);
  }
}

export async function migrateDatabase(
  sql: DatabaseSql,
): Promise<readonly string[]> {
  const available = await readMigrationFiles();
  const status = await getMigrationStatus(sql);
  const pendingIdentifiers = new Set(
    status.pending.map((migration) => migration.identifier),
  );
  const applied: string[] = [];

  for (const migration of available) {
    if (!pendingIdentifiers.has(migration.identifier)) {
      continue;
    }
    try {
      await sql.begin(async (transaction) => {
        await transaction.unsafe(migration.sql);
        await transaction`
          INSERT INTO schema_migrations (identifier, file_name, checksum)
          VALUES (
            ${migration.identifier}, ${migration.fileName}, ${migration.checksum}
          )
        `;
      });
    } catch {
      throw queryError();
    }
    applied.push(migration.identifier);
  }
  return Object.freeze(applied);
}
