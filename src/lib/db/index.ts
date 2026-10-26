import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import pg from "pg";
import { env } from "../env";
import * as schema from "./schema";

export type Database = NodePgDatabase<typeof schema>;

const globalForDb = globalThis as unknown as { spoterPool?: pg.Pool; spoterDb?: Database };

export function pool(): pg.Pool {
  if (!globalForDb.spoterPool) {
    globalForDb.spoterPool = new pg.Pool({
      connectionString: env().DATABASE_URL,
      max: Number(process.env.DATABASE_POOL_MAX ?? 10),
      idleTimeoutMillis: 30_000,
    });
  }
  return globalForDb.spoterPool;
}

/** Lazily-initialized Drizzle client (no connection is opened at import time). */
export function db(): Database {
  if (!globalForDb.spoterDb) globalForDb.spoterDb = drizzle({ client: pool(), schema });
  return globalForDb.spoterDb;
}

export { schema };
