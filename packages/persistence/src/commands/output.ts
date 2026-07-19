import { safePersistenceError } from "../errors.js";

export async function runCommand(
  operation: () => Promise<void>,
): Promise<void> {
  try {
    await operation();
  } catch (error) {
    const safeError = safePersistenceError(error);
    if (safeError === undefined) {
      console.error("PERSISTENCE_COMMAND_FAILED: Database command failed.");
    } else {
      console.error(`${safeError.code}: ${safeError.message}`);
    }
    process.exitCode = 1;
  }
}
