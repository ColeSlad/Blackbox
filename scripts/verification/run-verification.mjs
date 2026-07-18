import { spawnSync } from "node:child_process";
import process from "node:process";
import { pathToFileURL } from "node:url";

export const verificationGates = Object.freeze([
  "format:check",
  "lint",
  "typecheck",
  "test:unit",
  "build",
  "test:integration",
]);

export function runVerification(execute = spawnSync) {
  for (const gate of verificationGates) {
    const result = execute("pnpm", ["run", gate], {
      shell: false,
      stdio: "inherit",
    });

    if (result.error) {
      throw result.error;
    }

    if (result.status !== 0) {
      return result.status ?? 1;
    }
  }

  return 0;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  process.exitCode = runVerification();
}
