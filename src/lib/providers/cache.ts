import { eq, lt, sql } from "drizzle-orm";
import { db, schema } from "../db";

/**
 * Read-through cache for provider responses, shared by all users and instances.
 * Values are wrapped as `{ v }` so `null` (a confirmed miss) is cached too.
 */
export async function cached<T>(key: string, ttlSeconds: number, fn: () => Promise<T>): Promise<T> {
  const [hit] = await db()
    .select({ value: schema.providerCache.value, expiresAt: schema.providerCache.expiresAt })
    .from(schema.providerCache)
    .where(eq(schema.providerCache.key, key))
    .limit(1);
  if (hit && hit.expiresAt > new Date()) return (hit.value as { v: T }).v;

  const value = await fn();
  const expiresAt = new Date(Date.now() + ttlSeconds * 1000);
  await db()
    .insert(schema.providerCache)
    .values({ key, value: { v: value ?? null }, expiresAt })
    .onConflictDoUpdate({
      target: schema.providerCache.key,
      set: { value: sql`excluded.value`, expiresAt },
    });
  return value;
}

export async function pruneProviderCache(): Promise<void> {
  await db().delete(schema.providerCache).where(lt(schema.providerCache.expiresAt, new Date()));
}

export const DAY = 86_400;
