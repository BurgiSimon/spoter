import { PgBoss } from "pg-boss";
import { env } from "./env";
import { logger } from "./logger";

export const QUEUES = {
  /** Per-user: sync → enrich → profile → candidates. One queued + one active per user. */
  pipeline: "pipeline",
  /** Per-user: ingest an uploaded Spotify data export. */
  ingest: "ingest",
  /** Rebuild the taste profile only (cheap, no network). */
  profile: "profile",
  /** Daily housekeeping. */
  maintenance: "maintenance",
} as const;

export interface PipelineJob {
  userId: string;
  jobId: string;
  sync: boolean;
}
export interface IngestJob {
  userId: string;
  jobId: string;
}
export interface ProfileJob {
  userId: string;
}

export async function ensureQueues(boss: PgBoss): Promise<void> {
  await boss.createQueue(QUEUES.pipeline, {
    policy: "stately",
    retryLimit: 2,
    retryDelay: 60,
    expireInSeconds: 3600,
  });
  await boss.createQueue(QUEUES.ingest, {
    policy: "standard",
    retryLimit: 1,
    expireInSeconds: 3600,
  });
  await boss.createQueue(QUEUES.profile, {
    policy: "stately",
    retryLimit: 1,
    expireInSeconds: 600,
  });
  await boss.createQueue(QUEUES.maintenance, {
    policy: "singleton",
    retryLimit: 0,
    expireInSeconds: 3600,
  });
}

const globalForBoss = globalThis as unknown as { spoterBoss?: Promise<PgBoss> };

/** Producer-only instance for the web process: no maintenance, no cron, no migrations. */
export function producer(): Promise<PgBoss> {
  globalForBoss.spoterBoss ??= (async () => {
    const boss = new PgBoss({
      connectionString: env().DATABASE_URL,
      max: 3,
      supervise: false,
      schedule: false,
      migrate: false,
    });
    boss.on("error", (err) => logger.error({ err }, "pg-boss producer error"));
    await boss.start();
    return boss;
  })().catch((err) => {
    globalForBoss.spoterBoss = undefined;
    throw err;
  });
  return globalForBoss.spoterBoss;
}

export async function enqueuePipeline(data: PipelineJob): Promise<string | null> {
  const boss = await producer();
  return boss.send(QUEUES.pipeline, data, { singletonKey: data.userId });
}

export async function enqueueIngest(data: IngestJob): Promise<string | null> {
  const boss = await producer();
  return boss.send(QUEUES.ingest, data);
}

export async function enqueueProfile(data: ProfileJob): Promise<string | null> {
  const boss = await producer();
  return boss.send(QUEUES.profile, data, { singletonKey: data.userId, startAfter: 20 });
}
