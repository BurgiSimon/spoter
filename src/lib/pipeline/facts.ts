import { eq, inArray, sql } from "drizzle-orm";
import { db, schema } from "../db";
import { effectiveTags, idfWeight } from "../engine/tags";
import type { TagVector } from "../types";
import { chunk } from "../util";

let idfCache: { at: number; fn: (tag: string) => number } | undefined;

/** IDF over tagged artists and tracks, cached in-process for ten minutes. */
export async function loadIdf(): Promise<(tag: string) => number> {
  if (idfCache && Date.now() - idfCache.at < 600_000) return idfCache.fn;
  const rows = await db().select().from(schema.tagStats);
  const [{ total } = { total: 0 }] = (
    await db().execute<{ total: number }>(sql`
      SELECT ((SELECT count(*) FROM artists WHERE tags <> '{}'::jsonb) + (SELECT count(*) FROM tracks WHERE tags <> '{}'::jsonb))::int AS total
    `)
  ).rows;
  const df = new Map(rows.map((r) => [r.tag, r.df]));
  const n = Math.max(total, 1);
  const fn = (tag: string) => idfWeight(df.get(tag), n);
  idfCache = { at: Date.now(), fn };
  return fn;
}

export interface TrackCard {
  id: string;
  title: string;
  artistId: string;
  artistName: string;
  artistNames: string;
  albumName: string | null;
  imageUrl: string | null;
  artistImageUrl: string | null;
  releaseYear: number | null;
  durationMs: number | null;
  explicit: boolean | null;
  rank: number | null;
  bpm: number | null;
  spotifyId: string | null;
  deezerId: number | null;
  previewable: boolean | null;
  tags: TagVector;
}

/** Display + feature facts for a set of tracks (effective tags merge track, artist and genres). */
export async function loadTrackCards(ids: string[]): Promise<Map<string, TrackCard>> {
  const out = new Map<string, TrackCard>();
  const t = schema.tracks;
  const a = schema.artists;
  for (const part of chunk([...new Set(ids)], 1000)) {
    if (!part.length) continue;
    const rows = await db()
      .select({
        id: t.id,
        title: t.title,
        artistId: t.artistId,
        artistName: a.name,
        artistNames: t.artistNames,
        albumName: t.albumName,
        imageUrl: t.imageUrl,
        artistImageUrl: a.imageUrl,
        releaseYear: t.releaseYear,
        durationMs: t.durationMs,
        explicit: t.explicit,
        rank: t.rank,
        bpm: t.bpm,
        spotifyId: t.spotifyId,
        deezerId: t.deezerId,
        previewable: t.previewable,
        trackTags: t.tags,
        artistTags: a.tags,
        genres: a.genres,
      })
      .from(t)
      .innerJoin(a, eq(a.id, t.artistId))
      .where(inArray(t.id, part));
    for (const r of rows) {
      const { trackTags, artistTags, genres, ...rest } = r;
      out.set(r.id, { ...rest, tags: effectiveTags(trackTags, artistTags, genres) });
    }
  }
  return out;
}

/** Public shape sent to the browser. */
export function publicCard(c: TrackCard) {
  return {
    id: c.id,
    title: c.title,
    artist: c.artistNames || c.artistName,
    album: c.albumName,
    image: c.imageUrl ?? c.artistImageUrl,
    year: c.releaseYear,
    durationMs: c.durationMs,
    explicit: Boolean(c.explicit),
    spotifyId: c.spotifyId,
    hasPreview: Boolean(c.deezerId && c.previewable !== false),
    tags: Object.entries(c.tags)
      .sort((x, y) => y[1] - x[1])
      .slice(0, 4)
      .map(([tag]) => tag),
  };
}
export type PublicCard = ReturnType<typeof publicCard>;
