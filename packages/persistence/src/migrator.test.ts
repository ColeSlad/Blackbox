import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { PERSISTENCE_ERROR_CODES } from "./errors.js";
import { readMigrationFiles } from "./migrator.js";

const temporaryDirectories: string[] = [];

async function temporaryMigrationDirectory(): Promise<string> {
  const directory = await mkdtemp(path.join(tmpdir(), "blackbox-migrations-"));
  temporaryDirectories.push(directory);
  return directory;
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { force: true, recursive: true })),
  );
});

describe("migration file discovery", () => {
  it("orders valid repository-owned SQL lexically and hashes exact bytes", async () => {
    const directory = await temporaryMigrationDirectory();
    await writeFile(path.join(directory, "0002_second.sql"), "SELECT 2;\n");
    await writeFile(path.join(directory, "0001_first.sql"), "SELECT 1;\n");
    const migrations = await readMigrationFiles(directory);
    expect(migrations.map(({ identifier }) => identifier)).toEqual([
      "0001",
      "0002",
    ]);
    expect(migrations[0]?.checksum).toMatch(/^[0-9a-f]{64}$/);
  });

  it("refuses duplicate identifiers", async () => {
    const directory = await temporaryMigrationDirectory();
    await writeFile(path.join(directory, "0001_first.sql"), "SELECT 1;");
    await writeFile(path.join(directory, "0001_again.sql"), "SELECT 2;");
    await expect(readMigrationFiles(directory)).rejects.toMatchObject({
      code: PERSISTENCE_ERROR_CODES.MIGRATION_INVALID,
    });
  });

  it.each(["1_short.sql", "0001-Ambiguous.sql", "0001_first.txt"])(
    "refuses an invalid or ambiguous migration name %s",
    async (fileName) => {
      const directory = await temporaryMigrationDirectory();
      await writeFile(path.join(directory, fileName), "SELECT 1;");
      await expect(readMigrationFiles(directory)).rejects.toMatchObject({
        code: PERSISTENCE_ERROR_CODES.MIGRATION_INVALID,
      });
    },
  );
});
