import { pathToFileURL } from "node:url";

import { buildServer } from "./app.js";

export async function startServer(): Promise<void> {
  const server = buildServer();
  const port = Number.parseInt(process.env.PORT ?? "3000", 10);

  await server.listen({ host: "127.0.0.1", port });
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  await startServer();
}
