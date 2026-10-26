import { eq, sql } from "drizzle-orm";
import { Catalog, trackInputFromDeezer } from "../catalog";
import { db, schema } from "../db";
import { lastfmEnabled } from "../env";
import { logger } from "../logger";
import { normalizeArtist } from "../normalize";
import { DAY } from "../providers/cache";
import {
  deezerArtistGenres,
  deezerRelated,
  deezerSearchArtist,
  deezerSearchTrack,
  deezerTrack,
  deezerTrackByIsrc,
  deezerYear,
  type DeezerTrack,
} from "../providers/deezer";
import {
  lfmArtistInfo,
  lfmArtistTags,
  lfmSimilarArtists,
  lfmSimilarTracks,
  lfmTrackTags,
} from "../providers/lastfm";
import { lbSimilarArtists } from "../providers/listenbrainz";
import { mbSearchArtist } from "../providers/musicbrainz";
import { tagVectorFrom } from "../engine/tags";

const STALE_MS = 30 * DAY * 1000;
const isStale = (d: Date | null) => !d || Date.now() - d.getTime() > STALE_MS;

export const SIMILAR_SOURCE = { lastfm: 1, deezer: 2, listenbrainz: 3 } as const;

type ArtistRow = typeof schema.artists.$inferSelect;
type TrackRow = typeof schema.tracks.$inferSelect;

/** Fills an artist's tags, provider ids and (optionally) similar-artist edges. */
export async function enrichArtist(
  artist: ArtistRow,
  opts: { similar: boolean; catalog: Catalog },
): Promise<void> {
  const a = schema.artists;
  const patch: Partial<typeof a.$inferInsert> = {};
  let mbid = artist.mbid;
  let deezerId = artist.deezerId;

  let hasTags = Object.keys(artist.tags).length > 0;
  const setTags = (raw: { name: string; count: number }[]) => {
    const vec = tagVectorFrom(raw, { artistNameNorm: artist.nameNorm });
    if (Object.keys(vec).length) {
      patch.tags = vec;
      hasTags = true;
    }
  };

  try {
    if (lastfmEnabled() && isStale(artist.lastfmCheckedAt)) {
      const [info, tags] = await Promise.all([
        lfmArtistInfo(artist.name),
        lfmArtistTags(artist.name),
      ]);
      if (info?.mbid && !mbid) mbid = patch.mbid = info.mbid;
      if (info?.listeners) patch.listeners = info.listeners;
      setTags(tags);
      patch.lastfmCheckedAt = new Date();
    }
    // MusicBrainz: keyless community tags plus the MBID that unlocks ListenBrainz.
    if ((!hasTags || !mbid) && isStale(artist.musicbrainzCheckedAt)) {
      const mb = await mbSearchArtist(artist.name);
      if (mb) {
        if (!mbid) mbid = patch.mbid = mb.mbid;
        if (!hasTags) setTags(mb.tags);
      }
      patch.musicbrainzCheckedAt = new Date();
    }
    if (isStale(artist.deezerCheckedAt)) {
      if (!deezerId) {
        const dz = await deezerSearchArtist(artist.name);
        if (dz) {
          const taken = await db()
            .select({ id: a.id })
            .from(a)
            .where(eq(a.deezerId, dz.id))
            .limit(1);
          if (!taken.length) deezerId = patch.deezerId = dz.id;
          patch.fans = dz.nb_fan ?? null;
          if (!artist.imageUrl && dz.picture_medium) patch.imageUrl = dz.picture_medium;
        }
      }
      if (!hasTags && deezerId) setTags(await deezerArtistGenres(deezerId));
      patch.deezerCheckedAt = new Date();
    }
    if (Object.keys(patch).length) await db().update(a).set(patch).where(eq(a.id, artist.id));
  } catch (err) {
    logger.warn({ err, artist: artist.name }, "artist enrichment failed");
  }

  if (!opts.similar || !isStale(artist.similarCheckedAt)) return;
  const edges: { similarId: string; source: number; score: number }[] = [];
  const collect = async (
    source: number,
    items: { name: string; mbid?: string; deezerId?: number; score: number; image?: string }[],
  ) => {
    for (const item of items) {
      if (!item.name || normalizeArtist(item.name) === artist.nameNorm) continue;
      const similarId = await opts.catalog.artist({
        name: item.name,
        mbid: item.mbid ?? null,
        deezerId: item.deezerId ?? null,
        imageUrl: item.image ?? null,
      });
      if (similarId !== artist.id)
        edges.push({ similarId, source, score: Math.max(0.01, Math.min(1, item.score)) });
    }
  };
  try {
    const [lfm, dz, lb] = await Promise.all([
      lastfmEnabled() ? lfmSimilarArtists(artist.name, 40) : Promise.resolve([]),
      deezerId ? deezerRelated(deezerId) : Promise.resolve([]),
      mbid ? lbSimilarArtists(mbid) : Promise.resolve([]),
    ]);
    await collect(
      SIMILAR_SOURCE.lastfm,
      lfm.map((s) => ({ name: s.name, mbid: s.mbid, score: s.match })),
    );
    // Deezer returns related artists ordered by relevance without scores.
    await collect(
      SIMILAR_SOURCE.deezer,
      dz.map((s, i) => ({
        name: s.name,
        deezerId: s.id,
        image: s.picture_medium,
        score: 0.9 * Math.exp(-i / 15),
      })),
    );
    await collect(
      SIMILAR_SOURCE.listenbrainz,
      lb.slice(0, 30).map((s) => ({ name: s.name, mbid: s.mbid, score: s.score })),
    );
    if (edges.length) {
      await db()
        .insert(schema.artistSimilar)
        .values(edges.map((e) => ({ artistId: artist.id, ...e })))
        .onConflictDoUpdate({
          target: [
            schema.artistSimilar.artistId,
            schema.artistSimilar.similarId,
            schema.artistSimilar.source,
          ],
          set: { score: sql`excluded.score` },
        });
    }
    await db().update(a).set({ similarCheckedAt: new Date() }).where(eq(a.id, artist.id));
  } catch (err) {
    logger.warn({ err, artist: artist.name }, "similar-artist enrichment failed");
  }
}

/**
 * Matches a track on Deezer (preview, popularity, year, BPM) and fetches its
 * Last.fm tags and similar tracks when asked.
 */
export async function enrichTrack(
  track: TrackRow & { artistName: string },
  opts: { tags: boolean; similar: boolean; catalog: Catalog },
): Promise<void> {
  const t = schema.tracks;
  const patch: Partial<typeof t.$inferInsert> = {};
  try {
    if (isStale(track.deezerCheckedAt)) {
      let dz: DeezerTrack | null = null;
      if (track.deezerId) dz = await deezerTrack(track.deezerId);
      if (!dz && track.isrc) dz = await deezerTrackByIsrc(track.isrc);
      if (!dz) {
        const hit = await deezerSearchTrack(track.artistName, track.title);
        // Search results lack bpm/release date; fetch the full record.
        dz = hit ? ((await deezerTrack(hit.id)) ?? hit) : null;
      }
      if (dz) {
        const input = trackInputFromDeezer(dz);
        if (!track.deezerId) {
          const taken = await db()
            .select({ id: t.id })
            .from(t)
            .where(eq(t.deezerId, dz.id))
            .limit(1);
          if (!taken.length) patch.deezerId = dz.id;
        }
        if (!track.isrc && input.isrc) patch.isrc = input.isrc;
        if (!track.releaseYear) patch.releaseYear = deezerYear(dz);
        if (!track.imageUrl && input.imageUrl) patch.imageUrl = input.imageUrl;
        if (track.explicit === null && input.explicit !== null) patch.explicit = input.explicit;
        if (!track.albumName && input.albumName) patch.albumName = input.albumName;
        if (!track.durationMs && input.durationMs) patch.durationMs = input.durationMs;
        patch.rank = dz.rank ?? null;
        patch.bpm = dz.bpm && dz.bpm > 0 ? dz.bpm : null;
        patch.previewable = Boolean(dz.preview);
      } else {
        patch.previewable = false;
      }
      patch.deezerCheckedAt = new Date();
    }
    if (opts.tags && lastfmEnabled() && isStale(track.lastfmCheckedAt)) {
      const tags = tagVectorFrom(await lfmTrackTags(track.artistName, track.title), {
        artistNameNorm: normalizeArtist(track.artistName),
      });
      if (Object.keys(tags).length) patch.tags = tags;
      patch.lastfmCheckedAt = new Date();
    }
    if (Object.keys(patch).length) await db().update(t).set(patch).where(eq(t.id, track.id));
  } catch (err) {
    logger.warn({ err, track: track.title }, "track enrichment failed");
  }

  if (!opts.similar || !lastfmEnabled() || !isStale(track.similarCheckedAt)) return;
  try {
    const similar = await lfmSimilarTracks(track.artistName, track.title, 30);
    const rows: { trackId: string; similarId: string; score: number }[] = [];
    for (const s of similar) {
      const id = await opts.catalog.track({ title: s.name, artist: { name: s.artist } });
      if (id !== track.id)
        rows.push({
          trackId: track.id,
          similarId: id,
          score: Math.max(0.01, Math.min(1, s.match)),
        });
    }
    if (rows.length) {
      await db()
        .insert(schema.trackSimilar)
        .values(rows)
        .onConflictDoUpdate({
          target: [schema.trackSimilar.trackId, schema.trackSimilar.similarId],
          set: { score: sql`excluded.score` },
        });
    }
    await db().update(t).set({ similarCheckedAt: new Date() }).where(eq(t.id, track.id));
  } catch (err) {
    logger.warn({ err, track: track.title }, "similar-track enrichment failed");
  }
}

/** Recomputes tag document frequencies across all artists (for IDF weighting). */
export async function refreshTagStats(): Promise<void> {
  await db().transaction(async (tx) => {
    await tx.execute(sql`DELETE FROM tag_stats`);
    await tx.execute(sql`
      INSERT INTO tag_stats (tag, df)
      SELECT key, count(*)::int FROM (
        SELECT jsonb_object_keys(tags) AS key FROM artists
        UNION ALL
        SELECT jsonb_object_keys(tags) AS key FROM tracks
      ) k GROUP BY key
    `);
  });
}
