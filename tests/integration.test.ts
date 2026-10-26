/**
 * Integration tests against a real Postgres. Set TEST_DATABASE_URL to run them
 * (CI does); they are skipped otherwise. The database is wiped first.
 */
import { gzipSync } from "node:zlib";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const url = process.env.TEST_DATABASE_URL;
const suite = url ? describe : describe.skip;

suite("database integration", () => {
  // Modules are imported after the environment is set up.
  let m: {
    db: typeof import("@/lib/db");
    catalog: typeof import("@/lib/catalog");
    session: typeof import("@/lib/auth/session");
    rate: typeof import("@/lib/auth/rate-limit");
    feedback: typeof import("@/lib/feedback");
    ingest: typeof import("@/lib/pipeline/ingest");
    jobs: typeof import("@/lib/pipeline/jobs");
    drizzle: typeof import("drizzle-orm");
  };
  let userId: string;

  beforeAll(async () => {
    process.env.DATABASE_URL = url;
    process.env.ENCRYPTION_KEY ??= Buffer.alloc(32, 7).toString("base64");
    const pg = await import("pg");
    const admin = new pg.default.Client({ connectionString: url });
    await admin.connect();
    await admin.query(
      "DROP SCHEMA IF EXISTS public CASCADE; DROP SCHEMA IF EXISTS drizzle CASCADE; DROP SCHEMA IF EXISTS pgboss CASCADE; CREATE SCHEMA public;",
    );
    await admin.end();
    const { drizzle } = await import("drizzle-orm/node-postgres");
    const { migrate } = await import("drizzle-orm/node-postgres/migrator");
    const client = new pg.default.Client({ connectionString: url });
    await client.connect();
    await migrate(drizzle({ client }), { migrationsFolder: "drizzle" });
    await client.end();
    const { PgBoss } = await import("pg-boss");
    const { ensureQueues } = await import("@/lib/queue");
    const boss = new PgBoss({ connectionString: url, supervise: false, schedule: false });
    await boss.start();
    await ensureQueues(boss);
    await boss.stop({ graceful: false });

    m = {
      db: await import("@/lib/db"),
      catalog: await import("@/lib/catalog"),
      session: await import("@/lib/auth/session"),
      rate: await import("@/lib/auth/rate-limit"),
      feedback: await import("@/lib/feedback"),
      ingest: await import("@/lib/pipeline/ingest"),
      jobs: await import("@/lib/pipeline/jobs"),
      drizzle: await import("drizzle-orm"),
    };
    const [user] = await m.db
      .db()
      .insert(m.db.schema.users)
      .values({ displayName: "Test", email: "t@example.com" })
      .returning({ id: m.db.schema.users.id });
    userId = user!.id;
  }, 60_000);

  afterAll(async () => {
    const g = globalThis as unknown as {
      spoterBoss?: Promise<{ stop: (o: object) => Promise<void> }>;
    };
    if (g.spoterBoss) await (await g.spoterBoss).stop({ graceful: false });
    await m?.db.pool().end();
  });

  it("never duplicates artists or tracks under concurrency", async () => {
    const catalogs = Array.from({ length: 4 }, () => new m.catalog.Catalog());
    const ids = await Promise.all(
      Array.from({ length: 24 }, (_, i) =>
        catalogs[i % 4]!.track({
          title: i % 2 ? "Alison" : "Alison - Remastered 2005",
          artist: { name: i % 3 ? "Slowdive" : "slowdive" },
        }),
      ),
    );
    expect(new Set(ids).size).toBe(1);
    const { eq } = m.drizzle;
    const artists = await m.db
      .db()
      .select()
      .from(m.db.schema.artists)
      .where(eq(m.db.schema.artists.nameNorm, "slowdive"));
    expect(artists).toHaveLength(1);

    // A Deezer id arriving later is merged into the same rows.
    const fromDeezer = await new m.catalog.Catalog().track({
      title: "Alison",
      artist: { name: "Slowdive", deezerId: 2021 },
      deezerId: 3_000_000_001,
    });
    expect(fromDeezer).toBe(ids[0]);
  });

  it("creates, validates and revokes sessions", async () => {
    const token = await m.session.createSession(userId, "vitest");
    const user = await m.session.validateSessionToken(token);
    expect(user?.id).toBe(userId);
    expect(await m.session.validateSessionToken(`${token}x`)).toBeNull();
    await m.session.invalidateSession(token);
    expect(await m.session.validateSessionToken(token)).toBeNull();
  });

  it("rate limits per key and window", async () => {
    const results = [];
    for (let i = 0; i < 4; i++) results.push(await m.rate.rateLimit("test-key", 3, 60));
    expect(results).toEqual([true, true, true, false]);
  });

  it("applies a swipe to the model and undoes it exactly", async () => {
    const { eq, and } = m.drizzle;
    const s = m.db.schema;
    const trackId = await new m.catalog.Catalog().track({
      title: "Sometimes",
      artist: { name: "My Bloody Valentine" },
    });
    const features = { "d:tagSim": 0.4, "t:shoegaze": 0.8, bias: 1 };
    await m.db.db().insert(s.candidates).values({ userId, trackId, features, sources: [] });

    await m.feedback.recordSwipe(userId, trackId, "like");
    const [model] = await m.db
      .db()
      .select()
      .from(s.tasteModels)
      .where(eq(s.tasteModels.userId, userId));
    expect(model!.weights["t:shoegaze"]![0]).toBeGreaterThan(0);
    const [cand] = await m.db
      .db()
      .select()
      .from(s.candidates)
      .where(and(eq(s.candidates.userId, userId), eq(s.candidates.trackId, trackId)));
    expect(cand!.status).toBe(2);

    expect(await m.feedback.undoLastSwipe(userId)).toBe(trackId);
    const [after] = await m.db
      .db()
      .select()
      .from(s.tasteModels)
      .where(eq(s.tasteModels.userId, userId));
    expect(after!.weights["t:shoegaze"]).toBeUndefined();
    const [restored] = await m.db
      .db()
      .select()
      .from(s.candidates)
      .where(and(eq(s.candidates.userId, userId), eq(s.candidates.trackId, trackId)));
    expect(restored!.status).toBe(1);
  });

  it("ingests a data export idempotently", async () => {
    const payload = {
      tracks: [
        { title: "Fade Into You", artist: "Mazzy Star" },
        { title: "Glory Box", artist: "Portishead" },
      ],
      plays: [
        [0, 1_700_000_000, 200_000, 0],
        [0, 1_700_100_000, 210_000, 0],
        [1, 1_700_200_000, 5_000, 1],
      ],
      library: [0],
      banned: [],
      playlists: [{ name: "Night", items: [0, 1] }],
    };
    for (let round = 0; round < 2; round++) {
      const jobId = await m.jobs.createJob(userId, "ingest");
      await m.db
        .db()
        .insert(m.db.schema.importPayloads)
        .values({ jobId, data: gzipSync(Buffer.from(JSON.stringify(payload))) });
      await m.ingest.ingestExport(userId, jobId, new m.jobs.JobReporter(jobId));
    }
    const { eq } = m.drizzle;
    const rows = await m.db
      .db()
      .select({
        title: m.db.schema.tracks.title,
        plays: m.db.schema.userTracks.playCount,
        skips: m.db.schema.userTracks.skipCount,
        playlists: m.db.schema.userTracks.playlistCount,
      })
      .from(m.db.schema.userTracks)
      .innerJoin(m.db.schema.tracks, eq(m.db.schema.tracks.id, m.db.schema.userTracks.trackId))
      .where(eq(m.db.schema.userTracks.userId, userId));
    const fade = rows.find((r) => r.title === "Fade Into You");
    const glory = rows.find((r) => r.title === "Glory Box");
    // Imported twice, counted once.
    expect(fade).toMatchObject({ plays: 2, skips: 0, playlists: 1 });
    expect(glory).toMatchObject({ plays: 0, skips: 1, playlists: 1 });
  });
});
