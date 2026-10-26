import { eq, sql } from "drizzle-orm";
import { db, schema, type Database } from "./db";
import { drift } from "./engine/model";
import type { ModelWeights } from "./types";

type Tx = Parameters<Parameters<Database["transaction"]>[0]>[0];

/** Loads a user's model with time-based drift applied (taste changes slowly). */
export async function loadModel(userId: string, tx: Database | Tx = db()): Promise<ModelWeights> {
  const [row] = await tx
    .select({ weights: schema.tasteModels.weights, updatedAt: schema.tasteModels.updatedAt })
    .from(schema.tasteModels)
    .where(eq(schema.tasteModels.userId, userId))
    .limit(1);
  if (!row) return {};
  const weights = { ...row.weights };
  drift(weights, (Date.now() - row.updatedAt.getTime()) / 86_400_000);
  return weights;
}

/**
 * Read-modify-write of the model under a row lock so concurrent feedback requests
 * (e.g. fast swiping) never lose updates.
 */
export async function withModel<T>(
  userId: string,
  fn: (weights: ModelWeights, tx: Tx) => Promise<T>,
): Promise<T> {
  return db().transaction(async (tx) => {
    await tx
      .insert(schema.tasteModels)
      .values({ userId, weights: {} })
      .onConflictDoNothing({ target: schema.tasteModels.userId });
    await tx.execute(sql`SELECT 1 FROM taste_models WHERE user_id = ${userId}::uuid FOR UPDATE`);
    const weights = await loadModel(userId, tx);
    const result = await fn(weights, tx);
    await tx
      .update(schema.tasteModels)
      .set({ weights, updates: sql`${schema.tasteModels.updates} + 1`, updatedAt: new Date() })
      .where(eq(schema.tasteModels.userId, userId));
    return result;
  });
}
