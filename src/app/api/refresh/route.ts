import { eq } from "drizzle-orm";
import { ApiError, authed } from "@/lib/api";
import { rateLimit } from "@/lib/auth/rate-limit";
import { db, schema } from "@/lib/db";
import { activeJob, createJob } from "@/lib/pipeline/jobs";
import { enqueuePipeline } from "@/lib/queue";

/** Re-sync Spotify (if connected) and regenerate recommendations. */
export const POST = authed(async ({ user }) => {
  const running = await activeJob(user.id, "pipeline");
  if (running) return { jobId: running.id, alreadyRunning: true };
  if (!(await rateLimit(`refresh:${user.id}`, 6, 3600)))
    throw new ApiError(429, "You refreshed recently, give it a moment");
  const [account] = await db()
    .select({ userId: schema.spotifyAccounts.userId })
    .from(schema.spotifyAccounts)
    .where(eq(schema.spotifyAccounts.userId, user.id))
    .limit(1);
  const jobId = await createJob(user.id, "pipeline");
  await enqueuePipeline({ userId: user.id, jobId, sync: Boolean(account) });
  return { jobId, alreadyRunning: false };
});
