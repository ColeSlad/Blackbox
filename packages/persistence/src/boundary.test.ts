import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

import { describe, expect, it } from "vitest";

const repositoryRoot = path.resolve(
  path.dirname(new URL(import.meta.url).pathname),
  "../../..",
);

async function readRepositoryFile(relativePath: string): Promise<string> {
  return readFile(path.join(repositoryRoot, relativePath), "utf8");
}

describe("persistence boundaries", () => {
  it("pins Postgres.js as the only database runtime dependency", async () => {
    const metadata = JSON.parse(
      await readRepositoryFile("packages/persistence/package.json"),
    ) as { dependencies: Record<string, string> };
    expect(metadata.dependencies).toEqual({
      "@blackbox/contracts": "workspace:*",
      postgres: "3.4.9",
    });
    const lockfile = await readRepositoryFile("pnpm-lock.yaml");
    expect(lockfile).toMatch(
      /postgres:\n\s+specifier: 3\.4\.9\n\s+version: 3\.4\.9/,
    );
  });

  it("keeps PostgreSQL and persistence types out of the domain package", async () => {
    const domainFiles = await readdir(
      path.join(repositoryRoot, "packages/domain/src"),
    );
    for (const fileName of domainFiles.filter((name) => name.endsWith(".ts"))) {
      const source = await readRepositoryFile(
        `packages/domain/src/${fileName}`,
      );
      expect(source).not.toMatch(
        /@blackbox\/persistence|from ["']postgres["']/,
      );
    }
  });

  it("confines raw SQL execution to validated repository migration bytes", async () => {
    const sourceDirectory = path.join(
      repositoryRoot,
      "packages/persistence/src",
    );
    const sourceFiles: string[] = [];
    const collect = async (directory: string): Promise<void> => {
      for (const entry of await readdir(directory, { withFileTypes: true })) {
        const entryPath = path.join(directory, entry.name);
        if (entry.isDirectory()) {
          await collect(entryPath);
        } else if (entry.name.endsWith(".ts")) {
          sourceFiles.push(entryPath);
        }
      }
    };
    await collect(sourceDirectory);
    const unsafeCalls: string[] = [];
    for (const file of sourceFiles.filter(
      (name) => !name.endsWith(".test.ts"),
    )) {
      const source = await readFile(file, "utf8");
      if (source.includes(".unsafe(")) {
        unsafeCalls.push(`${path.relative(repositoryRoot, file)}:${source}`);
      }
    }
    expect(unsafeCalls).toHaveLength(1);
    expect(unsafeCalls[0]).toContain("packages/persistence/src/migrator.ts");
    expect(unsafeCalls[0]).toContain("transaction.unsafe(migration.sql)");
  });

  it("keeps exactly two ordered immutable migration files", async () => {
    const migrationNames = (
      await readdir(
        path.join(repositoryRoot, "packages/persistence/migrations"),
      )
    ).sort();
    expect(migrationNames).toEqual([
      "0001_schema_migrations.sql",
      "0002_initial_command_records.sql",
    ]);
    const schema = await readRepositoryFile(
      "packages/persistence/migrations/0002_initial_command_records.sql",
    );
    for (const table of [
      "runs",
      "tickets",
      "assignments",
      "intents",
      "transactions",
    ]) {
      expect(schema).toMatch(
        new RegExp(
          `CREATE TABLE ${table} \\([\\s\\S]*?schema_version integer NOT NULL CHECK \\(schema_version = 1\\)`,
        ),
      );
    }
  });

  it("requires the database suite in local and canonical CI verification", async () => {
    const metadata = JSON.parse(await readRepositoryFile("package.json")) as {
      scripts: Record<string, string>;
    };
    expect(metadata.scripts["test:integration"]).toBe(
      "pnpm test:database && node --test scripts/verification/integration-smoke.mjs",
    );
    const workflow = await readRepositoryFile(".github/workflows/verify.yml");
    const compose = await readRepositoryFile("compose.yaml");
    const image =
      "postgres:17.10-alpine3.24@sha256:742f40ea20b9ff2ff31db5458d127452988a2164df9e17441e191f3b72252193";
    expect(workflow.match(/pnpm verify/g)).toHaveLength(1);
    expect(workflow).toContain(image);
    expect(compose).toContain(image);
    expect(workflow).toContain("POSTGRES_DB: blackbox");
    expect(compose).toContain('"127.0.0.1:${POSTGRES_PORT:-55432}:5432"');
  });

  it("keeps actual environment files and local database artifacts ignored", async () => {
    const gitignore = await readRepositoryFile(".gitignore");
    expect(gitignore).toMatch(/^\.env$/m);
    expect(gitignore).toMatch(/^\.env\.\*$/m);
    expect(gitignore).toMatch(/^!\.env\.example$/m);
  });
});
