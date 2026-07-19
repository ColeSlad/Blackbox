import { readDatabaseConfig } from "../config.js";
import { getMigrationStatus } from "../migrator.js";
import { createPostgresPersistence } from "../postgres/index.js";
import { runCommand } from "./output.js";

await runCommand(async () => {
  const persistence = await createPostgresPersistence(readDatabaseConfig().url);
  try {
    const status = await getMigrationStatus(persistence.sql);
    console.log(
      JSON.stringify({
        current: status.current,
        applied: status.applied.map(({ identifier, fileName }) => ({
          identifier,
          file_name: fileName,
        })),
        pending: status.pending.map(({ identifier, fileName }) => ({
          identifier,
          file_name: fileName,
        })),
      }),
    );
  } finally {
    await persistence.close();
  }
});
