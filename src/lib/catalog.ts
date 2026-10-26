import { and, eq, sql } from "drizzle-orm";
import { db, schema, type Database } from "./db";
import { normalizeArtist, normalizeTitle } from "./normalize";
import type { SpotifyTrack } from "./spotify/types";
import type { DeezerTrack } from "./providers/deezer";
import { deezerYear } from "./providers/deezer";

export interface ArtistInput {
  name: string;
  spotifyId?: string | null;
  deezerId?: number | null;
  mbid?: string | null;
  imageUrl?: string | null;
  genres?: string[];
  fans?: number | null;
}

export interface TrackInput {
  title: string;
  artist: ArtistInput;
  artistNames?: string;
  spotifyId?: string | null;
  deezerId?: number | null;
  isrc?: string | null;
  albumName?: string | null;
  imageUrl?: string | null;
  durationMs?: number | null;
  releaseYear?: number | null;
  explicit?: boolean | null;
  rank?: number | null;
  previewable?: boolean | null;
}

type Executor = Database | Parameters<Parameters<Database["transaction"]>[0]>[0];
type IdRow<T> = { id: string; spotifyId: string | null; deezerId: number | null } & T;

const isUniqueViolation = (err: unknown) =>
  typeof err === "object" &&
  err !== null &&
  "code" in err &&
  (err as { code: string }).code === "23505";

/** No conflicting provider ids: the rows can describe the same entity. */
function compatible(
  input: { spotifyId?: string | null; deezerId?: number | null },
  row: IdRow<unknown>,
): boolean {
  return (
    (!input.spotifyId || !row.spotifyId || row.spotifyId === input.spotifyId) &&
    (!input.deezerId || !row.deezerId || row.deezerId === input.deezerId)
  );
}

/**
 * Resolves catalog rows, creating them when needed. Safe under concurrency:
 * identical in-flight lookups share one promise, and creation runs under a
 * Postgres advisory lock keyed on the normalized name, so parallel workers never
 * create the same artist or track twice.
 */
export class Catalog {
  private artistMemo = new Map<string, Promise<string>>();
  private trackMemo = new Map<string, Promise<string>>();

  artist(input: ArtistInput): Promise<string> {
    const nameNorm = normalizeArtist(input.name) || input.name.toLowerCase();
    const key = input.spotifyId
      ? `s:${input.spotifyId}`
      : input.deezerId
        ? `d:${input.deezerId}`
        : `n:${nameNorm}`;
    let p = this.artistMemo.get(key);
    if (!p) {
      p = this.resolveArtist(input, nameNorm);
      p.catch(() => this.artistMemo.delete(key));
      this.artistMemo.set(key, p);
    }
    return p;
  }

  private async findArtist(q: Executor, input: ArtistInput, nameNorm: string) {
    const a = schema.artists;
    const cols = { id: a.id, spotifyId: a.spotifyId, deezerId: a.deezerId };
    if (input.spotifyId) {
      const [row] = await q.select(cols).from(a).where(eq(a.spotifyId, input.spotifyId)).limit(1);
      if (row) return row;
    }
    if (input.deezerId) {
      const [row] = await q.select(cols).from(a).where(eq(a.deezerId, input.deezerId)).limit(1);
      if (row) return row;
    }
    const sameName = await q.select(cols).from(a).where(eq(a.nameNorm, nameNorm)).limit(10);
    return sameName.find((c) => compatible(input, c));
  }

  private async resolveArtist(input: ArtistInput, nameNorm: string): Promise<string> {
    const a = schema.artists;
    let row = await this.findArtist(db(), input, nameNorm);
    if (!row) {
      row = await db().transaction(async (tx) => {
        await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`artist:${nameNorm}`}))`);
        const existing = await this.findArtist(tx, input, nameNorm);
        if (existing) return existing;
        const [created] = await tx
          .insert(a)
          .values({
            name: input.name,
            nameNorm,
            spotifyId: input.spotifyId ?? null,
            deezerId: input.deezerId ?? null,
            mbid: input.mbid ?? null,
            imageUrl: input.imageUrl ?? null,
            genres: input.genres ?? [],
            fans: input.fans ?? null,
          })
          .returning({ id: a.id, spotifyId: a.spotifyId, deezerId: a.deezerId });
        return created!;
      });
      return row.id;
    }

    const patch: Partial<typeof a.$inferInsert> = {};
    if (input.spotifyId && !row.spotifyId) patch.spotifyId = input.spotifyId;
    if (input.deezerId && !row.deezerId) patch.deezerId = input.deezerId;
    if (input.imageUrl)
      patch.imageUrl = sql`coalesce(${a.imageUrl}, ${input.imageUrl})` as unknown as string;
    if (input.genres?.length) patch.genres = input.genres;
    if (input.mbid) patch.mbid = sql`coalesce(${a.mbid}, ${input.mbid})` as unknown as string;
    if (input.fans) patch.fans = input.fans;
    if (Object.keys(patch).length) {
      await db()
        .update(a)
        .set(patch)
        .where(eq(a.id, row.id))
        .catch((err) => {
          if (!isUniqueViolation(err)) throw err;
        });
    }
    return row.id;
  }

  track(input: TrackInput): Promise<string> {
    const key = input.spotifyId
      ? `s:${input.spotifyId}`
      : input.deezerId
        ? `d:${input.deezerId}`
        : `n:${normalizeArtist(input.artist.name)}::${normalizeTitle(input.title)}`;
    let p = this.trackMemo.get(key);
    if (!p) {
      p = this.resolveTrack(input);
      p.catch(() => this.trackMemo.delete(key));
      this.trackMemo.set(key, p);
    }
    return p;
  }

  private async findTrack(q: Executor, input: TrackInput, artistId: string, titleNorm: string) {
    const t = schema.tracks;
    const cols = { id: t.id, spotifyId: t.spotifyId, deezerId: t.deezerId, isrc: t.isrc };
    if (input.spotifyId) {
      const [row] = await q.select(cols).from(t).where(eq(t.spotifyId, input.spotifyId)).limit(1);
      if (row) return row;
    }
    if (input.deezerId) {
      const [row] = await q.select(cols).from(t).where(eq(t.deezerId, input.deezerId)).limit(1);
      if (row) return row;
    }
    if (input.isrc) {
      const [row] = await q.select(cols).from(t).where(eq(t.isrc, input.isrc)).limit(1);
      if (row) return row;
    }
    const sameName = await q
      .select(cols)
      .from(t)
      .where(and(eq(t.artistId, artistId), eq(t.titleNorm, titleNorm)))
      .limit(10);
    return sameName.find((c) => compatible(input, c));
  }

  private async resolveTrack(input: TrackInput): Promise<string> {
    const t = schema.tracks;
    const artistId = await this.artist(input.artist);
    const titleNorm = normalizeTitle(input.title) || input.title.toLowerCase();
    const row = await this.findTrack(db(), input, artistId, titleNorm);

    if (!row) {
      const created = await db().transaction(async (tx) => {
        await tx.execute(
          sql`SELECT pg_advisory_xact_lock(hashtext(${`track:${artistId}:${titleNorm}`}))`,
        );
        const existing = await this.findTrack(tx, input, artistId, titleNorm);
        if (existing) return existing.id;
        const [inserted] = await tx
          .insert(t)
          .values({
            title: input.title,
            titleNorm,
            artistId,
            artistNames: input.artistNames ?? input.artist.name,
            spotifyId: input.spotifyId ?? null,
            deezerId: input.deezerId ?? null,
            isrc: input.isrc ?? null,
            albumName: input.albumName ?? null,
            imageUrl: input.imageUrl ?? null,
            durationMs: input.durationMs ?? null,
            releaseYear: input.releaseYear ?? null,
            explicit: input.explicit ?? null,
            rank: input.rank ?? null,
            previewable: input.previewable ?? null,
          })
          .returning({ id: t.id });
        return inserted!.id;
      });
      return created;
    }

    const patch: Record<string, unknown> = {};
    if (input.spotifyId && !row.spotifyId) patch.spotifyId = input.spotifyId;
    if (input.deezerId && !row.deezerId) patch.deezerId = input.deezerId;
    if (input.isrc && !row.isrc) patch.isrc = input.isrc;
    const fill = (key: keyof typeof t.$inferInsert, column: unknown, value: unknown) => {
      if (value !== undefined && value !== null) patch[key] = sql`coalesce(${column}, ${value})`;
    };
    fill("albumName", t.albumName, input.albumName);
    fill("imageUrl", t.imageUrl, input.imageUrl);
    fill("durationMs", t.durationMs, input.durationMs);
    fill("releaseYear", t.releaseYear, input.releaseYear);
    fill("explicit", t.explicit, input.explicit);
    if (input.rank) patch.rank = input.rank;
    if (input.previewable !== undefined && input.previewable !== null)
      patch.previewable = input.previewable;
    if (Object.keys(patch).length) {
      await db()
        .update(t)
        .set(patch as Partial<typeof t.$inferInsert>)
        .where(eq(t.id, row.id))
        .catch((err) => {
          if (!isUniqueViolation(err)) throw err;
        });
    }
    return row.id;
  }
}

export function trackInputFromSpotify(track: SpotifyTrack): TrackInput | null {
  if (!track.id || track.is_local || (track.type && track.type !== "track")) return null;
  const main = track.artists[0];
  if (!main) return null;
  const year = Number(track.album.release_date?.slice(0, 4));
  const image =
    track.album.images.find((i) => (i.width ?? 0) >= 250 && (i.width ?? 0) <= 700)?.url ??
    track.album.images[0]?.url;
  return {
    title: track.name,
    artist: { name: main.name, spotifyId: main.id },
    artistNames: track.artists.map((a) => a.name).join(", "),
    spotifyId: track.id,
    isrc: track.external_ids?.isrc ?? null,
    albumName: track.album.name,
    imageUrl: image ?? null,
    durationMs: track.duration_ms,
    releaseYear: year > 1900 ? year : null,
    explicit: track.explicit,
  };
}

export function trackInputFromDeezer(track: DeezerTrack): TrackInput {
  const names = track.contributors?.length
    ? track.contributors.map((c) => c.name)
    : [track.artist.name];
  return {
    title: track.title,
    artist: {
      name: track.artist.name,
      deezerId: track.artist.id,
      imageUrl: track.artist.picture_medium ?? null,
    },
    artistNames: names.join(", "),
    deezerId: track.id,
    isrc: track.isrc ?? null,
    albumName: track.album?.title ?? null,
    imageUrl: track.album?.cover_medium ?? null,
    durationMs: track.duration ? track.duration * 1000 : null,
    releaseYear: deezerYear(track),
    explicit: track.explicit_lyrics ?? null,
    rank: track.rank ?? null,
    previewable: Boolean(track.preview),
  };
}
