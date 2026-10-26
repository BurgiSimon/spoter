import { desc, eq } from "drizzle-orm";
import { authed } from "@/lib/api";
import { db, schema } from "@/lib/db";

export const GET = authed(async ({ user }) => {
  const j = schema.userJobs;
  const jobs = await db()
    .select({
      id: j.id,
      kind: j.kind,
      status: j.status,
      progress: j.progress,
      stats: j.stats,
      error: j.error,
      createdAt: j.createdAt,
      finishedAt: j.finishedAt,
    })
    .from(j)
    .where(eq(j.userId, user.id))
    .orderBy(desc(j.createdAt))
    .limit(10);
  return { jobs };
});
