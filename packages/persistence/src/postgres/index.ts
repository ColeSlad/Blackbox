import type { CommandRepositories } from "../repositories.js";
import { connectPostgres, type DatabaseSql } from "./client.js";
import { createPostgresRepositories } from "./repositories.js";

export interface PostgresPersistence {
  readonly sql: DatabaseSql;
  readonly repositories: CommandRepositories;
  close(): Promise<void>;
}

export async function createPostgresPersistence(
  url: string,
): Promise<PostgresPersistence> {
  const sql = await connectPostgres(url);
  return Object.freeze({
    sql,
    repositories: createPostgresRepositories(sql),
    close: () => sql.end({ timeout: 5 }),
  });
}
