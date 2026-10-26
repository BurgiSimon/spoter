import { sql } from "drizzle-orm";
import { db } from "../db";

/**
 * Fixed-window rate limiter stored in Postgres so it works across instances.
 * Returns true when the action is allowed.
 */
export async function rateLimit(
  key: string,
  limit: number,
  windowSeconds: number,
): Promise<boolean> {
  const interval = `${windowSeconds} seconds`;
  const result = await db().execute<{ count: number }>(sql`
    INSERT INTO rate_limits (key, window_start, count) VALUES (${key}, now(), 1)
    ON CONFLICT (key) DO UPDATE SET
      count = CASE WHEN rate_limits.window_start < now() - ${interval}::interval THEN 1 ELSE rate_limits.count + 1 END,
      window_start = CASE WHEN rate_limits.window_start < now() - ${interval}::interval THEN now() ELSE rate_limits.window_start END
    RETURNING count
  `);
  return (result.rows[0]?.count ?? 0) <= limit;
}

export async function pruneRateLimits(): Promise<void> {
  await db().execute(sql`DELETE FROM rate_limits WHERE window_start < now() - interval '1 day'`);
}
