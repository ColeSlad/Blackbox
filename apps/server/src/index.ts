import { pathToFileURL } from "node:url";

import { LifecycleService } from "@blackbox/application";
import { readWorktreeConfiguration } from "@blackbox/config";
import {
  createPostgresPersistence,
  readDatabaseConfig,
} from "@blackbox/persistence";
import {
  RepositoryBindingRegistry,
  WorktreeManager,
} from "@blackbox/worktrees";

import { buildServer } from "./app.js";

export async function startServer(
  environment: NodeJS.ProcessEnv = process.env,
): Promise<void> {
  const bearerToken = environment.BLACKBOX_API_TOKEN;
  if (bearerToken === undefined || !/\S/.test(bearerToken)) {
    throw new Error("BLACKBOX_API_TOKEN must be configured.");
  }
  const persistence = await createPostgresPersistence(
    readDatabaseConfig(environment).url,
  );
  const bindings = await RepositoryBindingRegistry.create(
    readWorktreeConfiguration(environment),
  );
  const worktrees = new WorktreeManager(bindings, persistence.worktrees);
  const server = buildServer({
    bearerToken,
    lifecycle: new LifecycleService(persistence.lifecycle, {
      worktreeVerifier: worktrees,
    }),
    worktrees,
    close: () => persistence.close(),
  });
  const port = Number.parseInt(environment.PORT ?? "3000", 10);

  try {
    await server.listen({ host: "127.0.0.1", port });
  } catch (error) {
    await server.close().catch(() => undefined);
    throw error;
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  await startServer();
}
