import postgres from "postgres";

import { connectionError } from "../errors.js";

export type DatabaseSql = postgres.Sql;
export type TransactionSql = postgres.TransactionSql;

async function closeFailedClient(sql: DatabaseSql): Promise<void> {
  try {
    await sql.end({ timeout: 1 });
  } catch {
    return;
  }
}

export async function connectPostgres(url: string): Promise<DatabaseSql> {
  let sql: DatabaseSql | undefined;
  try {
    sql = postgres(url, {
      connect_timeout: 5,
      max: 5,
      onnotice: () => undefined,
    });
    await sql`SELECT 1`;
    return sql;
  } catch {
    if (sql !== undefined) {
      await closeFailedClient(sql);
    }
    throw connectionError();
  }
}
