import postgres from "postgres";

import { assertLocalDatabaseUrl, readDatabaseConfig } from "../config.js";
import { resetRefusedError } from "../errors.js";
import { migrateDatabase } from "../migrator.js";
import { createPostgresPersistence } from "../postgres/index.js";
import { runCommand } from "./output.js";

const CONFIRMATION_FLAG = "--confirm-reset";

await runCommand(async () => {
  if (!process.argv.slice(2).includes(CONFIRMATION_FLAG)) {
    throw resetRefusedError();
  }
  const configuredUrl = readDatabaseConfig().url;
  let parsed: URL;
  try {
    parsed = assertLocalDatabaseUrl(configuredUrl);
  } catch {
    throw resetRefusedError();
  }
  const databaseName = decodeURIComponent(parsed.pathname.slice(1));
  if (!/^[a-zA-Z_][a-zA-Z0-9_-]*$/.test(databaseName)) {
    throw resetRefusedError();
  }

  const administrationUrl = new URL(parsed);
  administrationUrl.pathname = "/postgres";
  const administrationSql = postgres(administrationUrl.toString(), {
    connect_timeout: 5,
    max: 1,
    onnotice: () => undefined,
  });
  try {
    await administrationSql`
      SELECT pg_terminate_backend(pid)
      FROM pg_stat_activity
      WHERE datname = ${databaseName} AND pid <> pg_backend_pid()
    `;
    await administrationSql`DROP DATABASE IF EXISTS ${administrationSql(databaseName)}`;
    await administrationSql`CREATE DATABASE ${administrationSql(databaseName)}`;
  } finally {
    await administrationSql.end({ timeout: 5 });
  }

  const persistence = await createPostgresPersistence(configuredUrl);
  try {
    await migrateDatabase(persistence.sql);
  } finally {
    await persistence.close();
  }
  console.log(
    `Development database reset confirmed for local database ${databaseName}.`,
  );
});
