import { eq, inArray, sql } from "drizzle-orm";
import { Catalog } from "../catalog";
import { db, schema } from "../db";
import { lastfmEnabled } from "../env";
import { logger } from "../logger";
import { mapLimit } from "../util";
import { FULL_BUDGET, QUICK_BUDGET, generateCandidates, type CandidateBudget } from "./candidates";
import { enrichArtist, enrichTrack, refreshTagStats } from "./enrich";
import { JobReporter } from "./jobs";
import { rebuildProfile } from "./profile";
import { syncSpotify } from "./sync";

interface LibraryBudget {
  artists: number;
  similarArtists: number;
  tracks: number;
}
const QUICK_LIBRARY: LibraryBudget = { artists: 60, similarArtists: 25, tracks: 80 };
const FULL_LIBRARY: LibraryBudget = { artists: 300, similarArtists: 90, tracks: 400 };

/** Enriches the library entries that matter most (heaviest listening first). */
async function enrichLibrary(
  userId: string,
  budget: LibraryBudget,
  report: JobReporter,
  catalog: Catalog,
) {
  const topArtists = await db().execute<{ artist_id: string }>(sql`
    SELECT artist_id FROM (
      SELECT t.artist_id,
             sum(ut.play_count + CASE WHEN ut.saved_at IS NOT NULL THEN 6 ELSE 0 END + ut.playlist_count * 2
                 + CASE WHEN coalesce(ut.top_short, ut.top_medium, ut.top_long) IS NOT NULL THEN 10 ELSE 0 END) AS w
      FROM user_tracks ut JOIN tracks t ON t.id = ut.track_id
      WHERE ut.user_id = ${userId}::uuid AND NOT ut.banned
      GROUP BY t.artist_id
      UNION ALL
      SELECT artist_id, 40 + CASE WHEN followed THEN 10 ELSE 0 END FROM user_artists
      WHERE user_id = ${userId}::uuid AND NOT blocked
    ) x GROUP BY artist_id ORDER BY sum(w) DESC LIMIT ${budget.artists}
  `);
  const artistIds = topArtists.rows.map((r) => r.artist_id);
  const artists = artistIds.length
    ? await db().select().from(schema.artists).where(inArray(schema.artists.id, artistIds))
    : [];
  const order = new Map(artistIds.map((id, i) => [id, i]));
  artists.sort((x, y) => order.get(x.id)! - order.get(y.id)!);
  let done = 0;
  await mapLimit(artists, 4, async (artist, i) => {
    await enrichArtist(artist, { similar: i < budget.similarArtists, catalog });
    await report.progress("Analysing your artists", ++done, artists.length, artist.name);
  });

  const topTracks = await db().execute<{ track_id: string }>(sql`
    SELECT ut.track_id FROM user_tracks ut
    WHERE ut.user_id = ${userId}::uuid AND NOT ut.banned
    ORDER BY (ut.play_count + CASE WHEN ut.saved_at IS NOT NULL THEN 6 ELSE 0 END + ut.playlist_count * 2
              + CASE WHEN coalesce(ut.top_short, ut.top_medium, ut.top_long) IS NOT NULL THEN 10 ELSE 0 END) DESC
    LIMIT ${budget.tracks}
  `);
  const trackIds = topTracks.rows.map((r) => r.track_id);
  const tracks = trackIds.length
    ? await db()
        .select({ track: schema.tracks, artistName: schema.artists.name })
        .from(schema.tracks)
        .innerJoin(schema.artists, eq(schema.artists.id, schema.tracks.artistId))
        .where(inArray(schema.tracks.id, trackIds))
    : [];
  done = 0;
  await mapLimit(tracks, 4, async ({ track, artistName }) => {
    await enrichTrack({ ...track, artistName }, { tags: lastfmEnabled(), similar: false, catalog });
    await report.progress("Analysing your songs", ++done, tracks.length, track.title);
  });
}

async function tagStatsStale(): Promise<boolean> {
  const res = await db().execute<{ n: number }>(sql`SELECT count(*)::int AS n FROM tag_stats`);
  return (res.rows[0]?.n ?? 0) < 50;
}

async function pass(
  userId: string,
  report: JobReporter,
  lib: LibraryBudget,
  cand: CandidateBudget,
  catalog: Catalog,
) {
  await enrichLibrary(userId, lib, report, catalog);
  if (await tagStatsStale()) await refreshTagStats();
  await report.progress("Building your taste profile", 0, 1, undefined, true);
  const profile = await rebuildProfile(userId);
  return generateCandidates(userId, profile, cand, report);
}

/**
 * Full per-user pipeline. Runs a quick pass first so Discover has songs within a
 * minute or two, then a thorough pass that widens every source.
 */
export async function runPipeline(
  userId: string,
  jobId: string,
  opts: { sync: boolean },
): Promise<void> {
  const report = new JobReporter(jobId);
  await report.start();
  const catalog = new Catalog();
  try {
    if (opts.sync) {
      const [account] = await db()
        .select({ userId: schema.spotifyAccounts.userId })
        .from(schema.spotifyAccounts)
        .where(eq(schema.spotifyAccounts.userId, userId))
        .limit(1);
      if (account) {
        await report.progress("Syncing your Spotify library", 0, 1, undefined, true);
        await syncSpotify(userId, report);
      }
    }
    const [{ n } = { n: 0 }] = (
      await db().execute<{ n: number }>(
        sql`SELECT count(*)::int AS n FROM user_tracks WHERE user_id = ${userId}::uuid`,
      )
    ).rows;
    if (n === 0) {
      report.count("libraryTracks", 0);
      await report.finish();
      return;
    }
    const [{ c } = { c: 0 }] = (
      await db().execute<{ c: number }>(
        sql`SELECT count(*)::int AS c FROM candidates WHERE user_id = ${userId}::uuid AND status IN (0, 1)`,
      )
    ).rows;
    if (c < 40) await pass(userId, report, QUICK_LIBRARY, QUICK_BUDGET, catalog);
    await pass(userId, report, FULL_LIBRARY, FULL_BUDGET, catalog);
    await report.finish();
  } catch (err) {
    logger.error({ err, userId }, "pipeline failed");
    await report.fail(err);
    throw err;
  }
}
