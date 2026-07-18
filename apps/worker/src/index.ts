import { pathToFileURL } from "node:url";

export async function runWorker(): Promise<void> {}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  await runWorker();
}
