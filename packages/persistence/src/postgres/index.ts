import type { CommandRepositories } from "../repositories.js";
import { connectPostgres, type DatabaseSql } from "./client.js";
import { createPostgresLifecyclePersistence } from "./lifecycle.js";
import { createPostgresRepositories } from "./repositories.js";
import type { LifecyclePersistence } from "../lifecycle.js";
import { createPostgresWorktreePersistence } from "./worktrees.js";
import type { WorktreePersistence } from "@blackbox/worktrees";

export interface PostgresPersistence {
  readonly sql: DatabaseSql;
  readonly repositories: CommandRepositories;
  readonly lifecycle: LifecyclePersistence;
  readonly worktrees: WorktreePersistence;
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
    worktrees: createPostgresWorktreePersistence(sql),
    close: () => sql.end({ timeout: 5 }),
  });
}

export { createPostgresLifecyclePersistence } from "./lifecycle.js";
export { createPostgresWorktreePersistence } from "./worktrees.js";
