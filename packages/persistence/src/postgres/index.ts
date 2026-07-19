import type { CommandRepositories } from "../repositories.js";
import { connectPostgres, type DatabaseSql } from "./client.js";
import { createPostgresLifecyclePersistence } from "./lifecycle.js";
import { createPostgresRepositories } from "./repositories.js";
import type { LifecyclePersistence } from "../lifecycle.js";

export interface PostgresPersistence {
  readonly sql: DatabaseSql;
  readonly repositories: CommandRepositories;
  readonly lifecycle: LifecyclePersistence;
  close(): Promise<void>;
}

export async function createPostgresPersistence(
  url: string,
): Promise<PostgresPersistence> {
  const sql = await connectPostgres(url);
  return Object.freeze({
    sql,
    repositories: createPostgresRepositories(sql),
    lifecycle: createPostgresLifecyclePersistence(sql),
    close: () => sql.end({ timeout: 5 }),
  });
}

export { createPostgresLifecyclePersistence } from "./lifecycle.js";
