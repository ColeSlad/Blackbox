import { readDatabaseConfig } from "../config.js";
import { migrateDatabase } from "../migrator.js";
import { createPostgresPersistence } from "../postgres/index.js";
import { runCommand } from "./output.js";

await runCommand(async () => {
  const persistence = await createPostgresPersistence(readDatabaseConfig().url);
  try {
    const applied = await migrateDatabase(persistence.sql);
    console.log(
      applied.length === 0
        ? "Database migrations are current."
        : `Applied database migrations: ${applied.join(", ")}.`,
    );
  } finally {
    await persistence.close();
  }
});
