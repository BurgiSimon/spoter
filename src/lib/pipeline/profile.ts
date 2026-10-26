import { and, eq, inArray, or, sql } from "drizzle-orm";
import { db, schema } from "../db";
import type { Edge } from "../engine/graph";
import {
  buildProfile,
  implicitZScores,
  type LibraryArtist,
  type LibraryTrack,
} from "../engine/profile";
import { effectiveTags } from "../engine/tags";
import { CANDIDATE_STATUS, TRACK_SOURCE, type ProfileData } from "../types";
import { chunk } from "../util";
import { loadIdf } from "./facts";

const MAX_EDGES = 250_000;

async function loadEdges(artistIds: string[]): Promise<Edge[]> {
  const s = schema.artistSimilar;
  const edges: Edge[] = [];
  const seen = new Set<string>(artistIds);
  const frontier: string[] = [];
  const add = (rows: { artistId: string; similarId: string; score: number }[]) => {
    for (const r of rows) {
      edges.push({ from: r.artistId, to: r.similarId, weight: r.score });
      for (const id of [r.artistId, r.similarId])
        if (!seen.has(id)) {
          seen.add(id);
          frontier.push(id);
        }
    }
  };
  for (const part of chunk(artistIds, 2000)) {
    add(
      await db()
        .select({ artistId: s.artistId, similarId: s.similarId, score: s.score })
        .from(s)
        .where(or(inArray(s.artistId, part), inArray(s.similarId, part))),
    );
  }
  // Second hop: edges of neighbours that have their own similarity lists.
  for (const part of chunk(frontier.slice(0, 20_000), 2000)) {
    if (edges.length > MAX_EDGES) break;
    add(
      await db()
        .select({ artistId: s.artistId, similarId: s.similarId, score: s.score })
        .from(s)
        .where(inArray(s.artistId, part)),
    );
  }
  return edges;
}

/** Rebuilds the taste profile from the library, ratings and Spoter likes. */
export async function rebuildProfile(userId: string): Promise<ProfileData> {
  const ut = schema.userTracks;
  const t = schema.tracks;
  const a = schema.artists;
  const rows = await db()
    .select({
      trackId: ut.trackId,
      artistId: t.artistId,
      trackTags: t.tags,
      artistTags: a.tags,
      genres: a.genres,
      releaseYear: t.releaseYear,
      rank: t.rank,
      explicit: t.explicit,
      sources: ut.sources,
      savedAt: ut.savedAt,
      playlistCount: ut.playlistCount,
      playCount: ut.playCount,
      skipCount: ut.skipCount,
      msPlayed: ut.msPlayed,
      lastPlayedAt: ut.lastPlayedAt,
      topShort: ut.topShort,
      topMedium: ut.topMedium,
      topLong: ut.topLong,
      banned: ut.banned,
      ratingMu: ut.ratingMu,
    })
    .from(ut)
    .innerJoin(t, eq(t.id, ut.trackId))
    .innerJoin(a, eq(a.id, t.artistId))
    .where(eq(ut.userId, userId));

  const tracks: LibraryTrack[] = rows.map((r) => ({
    trackId: r.trackId,
    artistId: r.artistId,
    tags: effectiveTags(r.trackTags, r.artistTags, r.genres),
    releaseYear: r.releaseYear,
    rank: r.rank,
    explicit: r.explicit,
    saved: Boolean(r.savedAt) && (r.sources & TRACK_SOURCE.SAVED) > 0,
    inExportLibrary: (r.sources & TRACK_SOURCE.EXPORT_LIBRARY) > 0,
    playlistCount: r.playlistCount,
    playCount: r.playCount,
    skipCount: r.skipCount,
    msPlayed: r.msPlayed,
    lastPlayedAt: r.lastPlayedAt,
    topShort: r.topShort,
    topMedium: r.topMedium,
    topLong: r.topLong,
    discovered: 0,
    banned: r.banned,
    ratingMu: r.ratingMu,
  }));

  // Songs you liked on Spoter count as part of your taste too.
  const c = schema.candidates;
  const liked = await db()
    .select({
      trackId: c.trackId,
      status: c.status,
      artistId: t.artistId,
      trackTags: t.tags,
      artistTags: a.tags,
      genres: a.genres,
      releaseYear: t.releaseYear,
      rank: t.rank,
      explicit: t.explicit,
    })
    .from(c)
    .innerJoin(t, eq(t.id, c.trackId))
    .innerJoin(a, eq(a.id, t.artistId))
    .where(
      and(
        eq(c.userId, userId),
        inArray(c.status, [CANDIDATE_STATUS.LIKED, CANDIDATE_STATUS.SUPERLIKED]),
      ),
    );
  const inLibrary = new Set(tracks.map((x) => x.trackId));
  for (const l of liked) {
    if (inLibrary.has(l.trackId)) continue;
    tracks.push({
      trackId: l.trackId,
      artistId: l.artistId,
      tags: effectiveTags(l.trackTags, l.artistTags, l.genres),
      releaseYear: l.releaseYear,
      rank: l.rank,
      explicit: l.explicit,
      saved: false,
      inExportLibrary: false,
      playlistCount: 0,
      playCount: 0,
      skipCount: 0,
      msPlayed: 0,
      lastPlayedAt: null,
      topShort: null,
      topMedium: null,
      topLong: null,
      discovered: l.status,
      banned: false,
      ratingMu: null,
    });
  }

  const ua = schema.userArtists;
  const artists: LibraryArtist[] = await db()
    .select({
      artistId: ua.artistId,
      followed: ua.followed,
      topShort: ua.topShort,
      topMedium: ua.topMedium,
      topLong: ua.topLong,
      blocked: ua.blocked,
    })
    .from(ua)
    .where(eq(ua.userId, userId));

  const artistIds = [
    ...new Set([...tracks.map((x) => x.artistId), ...artists.map((x) => x.artistId)]),
  ];
  const edges = await loadEdges(artistIds);
  const idf = await loadIdf();
  const { profile, weights } = buildProfile({ tracks, artists, edges, idf });

  await db()
    .insert(schema.tasteProfiles)
    .values({ userId, data: profile, builtAt: new Date() })
    .onConflictDoUpdate({
      target: schema.tasteProfiles.userId,
      set: { data: profile, builtAt: new Date() },
    });

  const z = implicitZScores(weights);
  const updates = rows.map(
    (r) => [r.trackId, weights.get(r.trackId) ?? 0, z.get(r.trackId) ?? -2] as const,
  );
  for (const part of chunk(updates, 1000)) {
    const values = sql.join(
      part.map(([id, w, zz]) => sql`(${id}::uuid, ${w}::real, ${zz}::real)`),
      sql`, `,
    );
    await db().execute(sql`
      UPDATE user_tracks SET affinity = v.w, affinity_z = v.z
      FROM (VALUES ${values}) AS v(id, w, z)
      WHERE user_tracks.user_id = ${userId}::uuid AND user_tracks.track_id = v.id
    `);
  }
  return profile;
}

export async function loadProfile(userId: string): Promise<ProfileData | null> {
  const [row] = await db()
    .select({ data: schema.tasteProfiles.data })
    .from(schema.tasteProfiles)
    .where(eq(schema.tasteProfiles.userId, userId))
    .limit(1);
  return row?.data ?? null;
}
