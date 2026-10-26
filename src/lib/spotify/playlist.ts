import { and, eq, inArray, isNull } from "drizzle-orm";
import { db, schema } from "../db";
import { spotifyEnabled } from "../env";
import { logger } from "../logger";
import { normalizeArtist, normalizeTitle } from "../normalize";
import { CANDIDATE_STATUS } from "../types";
import { SpotifyClient, searchSpotifyTrack } from "./client";

const PLAYLIST_NAME = "Spoter Discoveries";

/** Finds (and remembers) the Spotify id of catalog tracks discovered via Deezer or Last.fm. */
export async function resolveSpotifyIds(trackIds: string[]): Promise<Map<string, string>> {
  const t = schema.tracks;
  const rows = trackIds.length
    ? await db()
        .select({
          id: t.id,
          spotifyId: t.spotifyId,
          isrc: t.isrc,
          title: t.title,
          artist: schema.artists.name,
        })
        .from(t)
        .innerJoin(schema.artists, eq(schema.artists.id, t.artistId))
        .where(inArray(t.id, trackIds))
    : [];
  const out = new Map<string, string>();
  for (const r of rows) {
    if (r.spotifyId) {
      out.set(r.id, r.spotifyId);
      continue;
    }
    try {
      let hits = r.isrc ? await searchSpotifyTrack(`isrc:${r.isrc}`) : [];
      if (!hits.length) hits = await searchSpotifyTrack(`track:${r.title} artist:${r.artist}`);
      const match = hits.find(
        (h) =>
          h.id &&
          (h.external_ids?.isrc === r.isrc ||
            (normalizeTitle(h.name) === normalizeTitle(r.title) &&
              h.artists.some((a) => normalizeArtist(a.name) === normalizeArtist(r.artist)))),
      );
      if (match?.id) {
        out.set(r.id, match.id);
        await db()
          .update(t)
          .set({ spotifyId: match.id })
          .where(eq(t.id, r.id))
          .catch(() => undefined);
      }
    } catch (err) {
      logger.warn({ err, track: r.title }, "spotify lookup failed");
    }
  }
  return out;
}

async function ensurePlaylist(userId: string, client: SpotifyClient): Promise<string> {
  const [account] = await db()
    .select({ playlistId: schema.spotifyAccounts.playlistId })
    .from(schema.spotifyAccounts)
    .where(eq(schema.spotifyAccounts.userId, userId))
    .limit(1);
  if (account?.playlistId) return account.playlistId;
  const pl = await client.createPlaylist(PLAYLIST_NAME, "Songs I matched with on Spoter.");
  await db()
    .update(schema.spotifyAccounts)
    .set({ playlistId: pl.id })
    .where(eq(schema.spotifyAccounts.userId, userId));
  return pl.id;
}

export async function addToSpoterPlaylist(userId: string, trackIds: string[]): Promise<number> {
  if (!spotifyEnabled() || !trackIds.length) return 0;
  const client = await SpotifyClient.forUser(userId).catch(() => null);
  if (!client) return 0;
  const ids = await resolveSpotifyIds(trackIds);
  if (!ids.size) return 0;
  const playlistId = await ensurePlaylist(userId, client);
  try {
    await client.addToPlaylist(
      playlistId,
      [...ids.values()].map((id) => `spotify:track:${id}`),
    );
  } catch (err) {
    // The playlist may have been deleted on Spotify: forget it and retry once.
    logger.warn({ err }, "playlist add failed, recreating playlist");
    await db()
      .update(schema.spotifyAccounts)
      .set({ playlistId: null })
      .where(eq(schema.spotifyAccounts.userId, userId));
    const fresh = await ensurePlaylist(userId, client);
    await client.addToPlaylist(
      fresh,
      [...ids.values()].map((id) => `spotify:track:${id}`),
    );
  }
  await db()
    .update(schema.candidates)
    .set({ exportedAt: new Date() })
    .where(
      and(
        eq(schema.candidates.userId, userId),
        inArray(schema.candidates.trackId, [...ids.keys()]),
      ),
    );
  return ids.size;
}

/** Adds every liked song that is not on the playlist yet. */
export async function exportLikes(userId: string): Promise<number> {
  const c = schema.candidates;
  const rows = await db()
    .select({ trackId: c.trackId })
    .from(c)
    .where(
      and(
        eq(c.userId, userId),
        inArray(c.status, [CANDIDATE_STATUS.LIKED, CANDIDATE_STATUS.SUPERLIKED]),
        isNull(c.exportedAt),
      ),
    )
    .limit(500);
  return addToSpoterPlaylist(
    userId,
    rows.map((r) => r.trackId),
  );
}

/** Saves songs to the user's Spotify "Liked Songs". */
export async function saveToSpotifyLibrary(userId: string, trackIds: string[]): Promise<number> {
  const client = await SpotifyClient.forUser(userId);
  const ids = await resolveSpotifyIds(trackIds);
  await client.saveToLibrary([...ids.values()].map((id) => `spotify:track:${id}`));
  return ids.size;
}
