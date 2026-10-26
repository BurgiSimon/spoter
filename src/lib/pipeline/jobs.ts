import { and, desc, eq, inArray } from "drizzle-orm";
import { db, schema } from "../db";
import type { JobProgress } from "../types";

export type JobKind = "pipeline" | "ingest";

export async function createJob(userId: string, kind: JobKind): Promise<string> {
  const [row] = await db()
    .insert(schema.userJobs)
    .values({ userId, kind })
    .returning({ id: schema.userJobs.id });
  return row!.id;
}

/** The newest queued/running job of a kind, so the UI does not start duplicates. */
export async function activeJob(userId: string, kind: JobKind) {
  const [row] = await db()
    .select()
    .from(schema.userJobs)
    .where(
      and(
        eq(schema.userJobs.userId, userId),
        eq(schema.userJobs.kind, kind),
        inArray(schema.userJobs.status, ["queued", "running"]),
      ),
    )
    .orderBy(desc(schema.userJobs.createdAt))
    .limit(1);
  return row;
}

/** Throttled progress reporter for long-running steps. */
export class JobReporter {
  private lastWrite = 0;
  readonly stats: Record<string, number> = {};

  constructor(readonly jobId: string) {}

  async start(): Promise<void> {
    await db()
      .update(schema.userJobs)
      .set({ status: "running", startedAt: new Date(), error: null })
      .where(eq(schema.userJobs.id, this.jobId));
  }

  async progress(
    step: string,
    done: number,
    total: number,
    message?: string,
    force = false,
  ): Promise<void> {
    const now = Date.now();
    if (!force && now - this.lastWrite < 1000 && done < total) return;
    this.lastWrite = now;
    const progress: JobProgress = { step, done, total, message };
    await db().update(schema.userJobs).set({ progress }).where(eq(schema.userJobs.id, this.jobId));
  }

  count(key: string, by = 1): void {
    this.stats[key] = (this.stats[key] ?? 0) + by;
  }

  async finish(): Promise<void> {
    await db()
      .update(schema.userJobs)
      .set({
        status: "done",
        finishedAt: new Date(),
        stats: this.stats,
        progress: { step: "done", done: 1, total: 1 },
      })
      .where(eq(schema.userJobs.id, this.jobId));
  }

  async fail(err: unknown): Promise<void> {
    // Database errors wrap the real cause; show that instead of the whole SQL statement.
    const cause = err instanceof Error && err.cause instanceof Error ? err.cause : err;
    const message = cause instanceof Error ? cause.message : String(cause);
    await db()
      .update(schema.userJobs)
      .set({
        status: "failed",
        finishedAt: new Date(),
        error: message.slice(0, 500),
        stats: this.stats,
      })
      .where(eq(schema.userJobs.id, this.jobId));
  }
}
