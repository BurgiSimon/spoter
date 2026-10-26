import { eq, sql } from "drizzle-orm";
import { Catalog, trackInputFromSpotify } from "../catalog";
import { db, schema } from "../db";
import { logger } from "../logger";
import { SpotifyClient } from "../spotify/client";
import type { SpotifyArtist, SpotifyTrack } from "../spotify/types";
import { TRACK_SOURCE } from "../types";
import type { JobReporter } from "./jobs";
import {
  insertListeningEvents,
  recomputePlayStats,
  upsertUserTracks,
  type UserTrackPatch,
} from "./library";

const MAX_PLAYLISTS = 150;
const MAX_PLAYLIST_ITEMS = 8000;

/** Pulls everything Spotify still exposes to Development Mode apps into the library tables. */
export async function syncSpotify(userId: string, report: JobReporter): Promise<void> {
  const client = await SpotifyClient.forUser(userId);
  const catalog = new Catalog();
  const patches = new Map<string, UserTrackPatch>();
  const patch = (trackId: string, p: Omit<UserTrackPatch, "trackId">) => {
    const prev = patches.get(trackId);
    patches.set(trackId, { ...prev, ...p, trackId, sources: (prev?.sources ?? 0) | p.sources });
  };
  const resolve = async (t: SpotifyTrack | null | undefined) => {
    const input = t ? trackInputFromSpotify(t) : null;
    return input ? catalog.track(input) : null;
  };

  const me = await client.me();
  await db()
    .update(schema.spotifyAccounts)
    .set({ displayName: me.display_name })
    .where(eq(schema.spotifyAccounts.userId, userId));

  // Saved tracks
  let saved = 0;
  for await (const page of client.savedTracks()) {
    for (const item of page) {
      const id = await resolve(item.track);
      if (!id) continue;
      patch(id, { sources: TRACK_SOURCE.SAVED, savedAt: new Date(item.added_at) });
      saved++;
    }
    await report.progress("Syncing liked songs", saved, saved + 50);
  }
  report.count("savedTracks", saved);

  // Playlists the user owns or collaborates on (others no longer expose items)
  const playlistCounts = new Map<string, number>();
  let playlists = 0;
  let items = 0;
  outer: for await (const page of client.playlists()) {
    for (const pl of page) {
      if (pl.owner.id !== client.spotifyUserId && !pl.collaborative) continue;
      if (++playlists > MAX_PLAYLISTS) break outer;
      const seen = new Set<string>();
      try {
        for await (const entries of client.playlistItems(pl.id)) {
          for (const entry of entries) {
            const e = entry as { item?: SpotifyTrack | null; track?: SpotifyTrack | null };
            const id = await resolve(e.item ?? e.track);
            if (!id || seen.has(id)) continue;
            seen.add(id);
            playlistCounts.set(id, (playlistCounts.get(id) ?? 0) + 1);
            if (++items >= MAX_PLAYLIST_ITEMS) break outer;
          }
        }
      } catch (err) {
        logger.warn({ err, playlist: pl.id }, "skipping unreadable playlist");
      }
      await report.progress(
        "Reading your playlists",
        playlists,
        Math.min(MAX_PLAYLISTS, playlists + 5),
        pl.name,
      );
    }
  }
  for (const [id, count] of playlistCounts)
    patch(id, { sources: TRACK_SOURCE.PLAYLIST, playlistCount: count });
  report.count("playlists", playlists);

  // Top tracks and artists over three time ranges
  await report.progress("Fetching your top tracks", 0, 6, undefined, true);
  const ranges = [
    ["short_term", "topShort"],
    ["medium_term", "topMedium"],
    ["long_term", "topLong"],
  ] as const;
  for (const [range, field] of ranges) {
    const top = await client.top("tracks", range);
    for (const [i, t] of top.entries()) {
      const id = await resolve(t);
      if (id) patch(id, { sources: TRACK_SOURCE.TOP, [field]: i + 1 });
    }
  }

  const artistTop = new Map<
    string,
    { short?: number; medium?: number; long?: number; followed?: boolean }
  >();
  const resolveArtist = async (a: SpotifyArtist) =>
    a.id
      ? catalog.artist({
          name: a.name,
          spotifyId: a.id,
          genres: a.genres,
          imageUrl:
            a.images?.find((i) => (i.width ?? 0) >= 160 && (i.width ?? 0) <= 700)?.url ??
            a.images?.[0]?.url,
        })
      : null;
  for (const [range, key] of [
    ["short_term", "short"],
    ["medium_term", "medium"],
    ["long_term", "long"],
  ] as const) {
    const top = await client.top("artists", range);
    for (const [i, a] of top.entries()) {
      const id = await resolveArtist(a);
      if (id) artistTop.set(id, { ...artistTop.get(id), [key]: i + 1 });
    }
  }
  try {
    for (const a of await client.followedArtists()) {
      const id = await resolveArtist(a);
      if (id) artistTop.set(id, { ...artistTop.get(id), followed: true });
    }
  } catch (err) {
    logger.warn({ err }, "could not read followed artists");
  }

  // Recently played becomes listening history
  const recent = await client.recentlyPlayed();
  const events: { trackId: string; playedAt: Date; msPlayed: number; skipped: boolean }[] = [];
  for (const r of recent) {
    const id = await resolve(r.track);
    if (!id) continue;
    patch(id, { sources: TRACK_SOURCE.RECENT });
    events.push({
      trackId: id,
      playedAt: new Date(r.played_at),
      msPlayed: r.track.duration_ms,
      skipped: false,
    });
  }

  // Reset Spotify-derived facts, then apply the fresh snapshot.
  await db().execute(sql`
    UPDATE user_tracks SET
      top_short = NULL, top_medium = NULL, top_long = NULL,
      playlist_count = CASE WHEN sources & ${TRACK_SOURCE.PLAYLIST}::int > 0 THEN 0 ELSE playlist_count END,
      saved_at = CASE WHEN sources & ${TRACK_SOURCE.EXPORT_LIBRARY}::int = 0 THEN NULL ELSE saved_at END,
      sources = sources & ~(${TRACK_SOURCE.SAVED | TRACK_SOURCE.PLAYLIST | TRACK_SOURCE.TOP}::int)
    WHERE user_id = ${userId}::uuid
  `);
  await upsertUserTracks(userId, [...patches.values()]);

  await db().execute(sql`
    UPDATE user_artists SET top_short = NULL, top_medium = NULL, top_long = NULL, followed = false
    WHERE user_id = ${userId}::uuid
  `);
  for (const [artistId, t] of artistTop) {
    await db()
      .insert(schema.userArtists)
      .values({
        userId,
        artistId,
        followed: t.followed ?? false,
        topShort: t.short ?? null,
        topMedium: t.medium ?? null,
        topLong: t.long ?? null,
      })
      .onConflictDoUpdate({
        target: [schema.userArtists.userId, schema.userArtists.artistId],
        set: {
          followed: t.followed ?? false,
          topShort: t.short ?? null,
          topMedium: t.medium ?? null,
          topLong: t.long ?? null,
        },
      });
  }

  if (events.length) {
    await insertListeningEvents(userId, events);
    await recomputePlayStats(userId, TRACK_SOURCE.HISTORY);
  }
  await db()
    .update(schema.spotifyAccounts)
    .set({ lastSyncAt: new Date() })
    .where(eq(schema.spotifyAccounts.userId, userId));
  report.count("libraryTracks", patches.size);
}
