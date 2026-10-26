import { and, gt, isNotNull, sql } from "drizzle-orm";
import { PgBoss } from "pg-boss";
import { pruneRateLimits } from "../lib/auth/rate-limit";
import { pruneSessions } from "../lib/auth/session";
import { db, pool, schema } from "../lib/db";
import { env, lastfmEnabled, spotifyEnabled } from "../lib/env";
import { logger } from "../lib/logger";
import { createJob, JobReporter } from "../lib/pipeline/jobs";
import { refreshTagStats } from "../lib/pipeline/enrich";
import { ingestExport } from "../lib/pipeline/ingest";
import { rebuildProfile } from "../lib/pipeline/profile";
import { runPipeline } from "../lib/pipeline/run";
import { pruneProviderCache } from "../lib/providers/cache";
import {
  ensureQueues,
  QUEUES,
  type IngestJob,
  type PipelineJob,
  type ProfileJob,
} from "../lib/queue";

async function main() {
  const e = env();
  logger.info(
    { concurrency: e.WORKER_CONCURRENCY, spotify: spotifyEnabled(), lastfm: lastfmEnabled() },
    "starting Spoter worker",
  );
  if (!lastfmEnabled())
    logger.warn("LASTFM_API_KEY is not set: recommendations will be much weaker");

  const boss = new PgBoss({ connectionString: e.DATABASE_URL, max: 4 });
  boss.on("error", (err) => logger.error({ err }, "pg-boss error"));
  await boss.start();
  await ensureQueues(boss);

  await boss.work<PipelineJob>(
    QUEUES.pipeline,
    { localConcurrency: e.WORKER_CONCURRENCY },
    async ([job]) => {
      if (!job) return;
      logger.info({ userId: job.data.userId }, "pipeline started");
      await runPipeline(job.data.userId, job.data.jobId, { sync: job.data.sync });
      logger.info({ userId: job.data.userId }, "pipeline finished");
    },
  );

  await boss.work<IngestJob>(QUEUES.ingest, { localConcurrency: 1 }, async ([job]) => {
    if (!job) return;
    const { userId, jobId } = job.data;
    const report = new JobReporter(jobId);
    await report.start();
    try {
      await ingestExport(userId, jobId, report);
      await report.finish();
    } catch (err) {
      await report.fail(err);
      throw err;
    }
    // Fresh history: rebuild everything downstream.
    const pipelineJob = await createJob(userId, "pipeline");
    await boss.send(
      QUEUES.pipeline,
      { userId, jobId: pipelineJob, sync: false } satisfies PipelineJob,
      {
        singletonKey: userId,
      },
    );
  });

  await boss.work<ProfileJob>(QUEUES.profile, { localConcurrency: 2 }, async ([job]) => {
    if (job) await rebuildProfile(job.data.userId);
  });

  await boss.work(QUEUES.maintenance, async () => {
    await Promise.all([pruneProviderCache(), pruneSessions(), pruneRateLimits()]);
    await refreshTagStats();
    // Keep active Spotify users fresh.
    const active = await db()
      .select({ userId: schema.spotifyAccounts.userId })
      .from(schema.spotifyAccounts)
      .innerJoin(schema.users, sql`${schema.users.id} = ${schema.spotifyAccounts.userId}`)
      .where(
        and(
          isNotNull(schema.users.lastActiveAt),
          gt(schema.users.lastActiveAt, new Date(Date.now() - 7 * 86_400_000)),
        ),
      );
    for (const { userId } of active) {
      const jobId = await createJob(userId, "pipeline");
      await boss.send(QUEUES.pipeline, { userId, jobId, sync: true } satisfies PipelineJob, {
        singletonKey: userId,
      });
    }
    logger.info({ refreshed: active.length }, "maintenance done");
  });
  await boss.schedule(QUEUES.maintenance, "17 3 * * *", null, { tz: "UTC" });

  const shutdown = async (signal: string) => {
    logger.info({ signal }, "shutting down worker");
    await boss.stop({ graceful: true, timeout: 30_000 });
    await pool().end();
    process.exit(0);
  };
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));
}

main().catch((err) => {
  logger.fatal({ err }, "worker crashed");
  process.exit(1);
});
