import { normalizeArtist, normalizeTitle } from "../normalize";
import { cached, DAY } from "./cache";
import { fetchJson, RateLimiter, sleep } from "./http";

// Deezer's public API allows 50 requests / 5 s per IP. Stay well below.
const limiter = new RateLimiter(7, 7);
const BASE = "https://api.deezer.com";

export interface DeezerArtist {
  id: number;
  name: string;
  picture_medium?: string;
  picture_big?: string;
  nb_fan?: number;
}

export interface DeezerTrack {
  id: number;
  title: string;
  title_short?: string;
  isrc?: string;
  duration?: number;
  rank?: number;
  explicit_lyrics?: boolean;
  preview?: string;
  release_date?: string;
  bpm?: number;
  readable?: boolean;
  artist: DeezerArtist;
  contributors?: DeezerArtist[];
  album?: {
    id: number;
    title: string;
    cover_medium?: string;
    cover_big?: string;
    release_date?: string;
  };
}

interface DeezerError {
  error?: { type: string; message: string; code: number };
}

async function call<T>(path: string): Promise<T | null> {
  for (let attempt = 0; attempt < 4; attempt++) {
    const res = await fetchJson<T & DeezerError>(`${BASE}${path}`, { limiter });
    if (!res?.error) return res;
    // Deezer reports errors with HTTP 200. 4 = quota exceeded, 700 = service busy, 800 = not found.
    if (res.error.code === 4 || res.error.code === 700) {
      limiter.penalize(5_000);
      await sleep(5_000);
      continue;
    }
    if (res.error.code === 800) return null;
    throw new Error(`Deezer error ${res.error.code}: ${res.error.message}`);
  }
  return null;
}

export function deezerTrack(id: number): Promise<DeezerTrack | null> {
  // Preview URLs are signed and expire; callers needing a playable URL use deezerTrackFresh.
  return cached(`dz:track:${id}`, 30 * DAY, () => call<DeezerTrack>(`/track/${id}`));
}

export function deezerTrackFresh(id: number): Promise<DeezerTrack | null> {
  return call<DeezerTrack>(`/track/${id}`);
}

export function deezerTrackByIsrc(isrc: string): Promise<DeezerTrack | null> {
  return cached(`dz:isrc:${isrc}`, 30 * DAY, () =>
    call<DeezerTrack>(`/track/isrc:${encodeURIComponent(isrc)}`),
  );
}

/** Fuzzy search; returns the result whose normalized artist + title match best. */
export async function deezerSearchTrack(
  artist: string,
  title: string,
): Promise<DeezerTrack | null> {
  const q = `${artist} ${title}`.slice(0, 200);
  return cached(
    `dz:search:${normalizeArtist(artist)}::${normalizeTitle(title)}`,
    30 * DAY,
    async () => {
      const res = await call<{ data: DeezerTrack[] }>(
        `/search?q=${encodeURIComponent(q)}&limit=10`,
      );
      const a = normalizeArtist(artist);
      const t = normalizeTitle(title);
      let best: DeezerTrack | null = null;
      let bestScore = 0;
      for (const item of res?.data ?? []) {
        const ia = normalizeArtist(item.artist.name);
        const it = normalizeTitle(item.title);
        let score = 0;
        if (ia === a) score += 2;
        else if (ia.includes(a) || a.includes(ia)) score += 1;
        if (it === t) score += 2;
        else if (it.startsWith(t) || t.startsWith(it)) score += 1;
        if (score > bestScore) {
          best = item;
          bestScore = score;
        }
      }
      return bestScore >= 3 ? best : null;
    },
  );
}

export async function deezerSearchArtist(name: string): Promise<DeezerArtist | null> {
  const n = normalizeArtist(name);
  return cached(`dz:artist-search:${n}`, 30 * DAY, async () => {
    const res = await call<{ data: DeezerArtist[] }>(
      `/search/artist?q=${encodeURIComponent(name)}&limit=10`,
    );
    const exact = (res?.data ?? []).filter((a) => normalizeArtist(a.name) === n);
    exact.sort((x, y) => (y.nb_fan ?? 0) - (x.nb_fan ?? 0));
    return exact[0] ?? null;
  });
}

export async function deezerRelated(artistId: number): Promise<DeezerArtist[]> {
  const res = await cached(`dz:related:${artistId}`, 30 * DAY, () =>
    call<{ data: DeezerArtist[] }>(`/artist/${artistId}/related?limit=40`),
  );
  return res?.data ?? [];
}

export async function deezerArtistTop(artistId: number, limit = 25): Promise<DeezerTrack[]> {
  const res = await cached(`dz:top:${artistId}:${limit}`, 14 * DAY, () =>
    call<{ data: DeezerTrack[] }>(`/artist/${artistId}/top?limit=${limit}`),
  );
  return res?.data ?? [];
}

export async function deezerArtistRadio(artistId: number): Promise<DeezerTrack[]> {
  const res = await cached(`dz:radio:${artistId}`, 7 * DAY, () =>
    call<{ data: DeezerTrack[] }>(`/artist/${artistId}/radio?limit=40`),
  );
  return res?.data ?? [];
}

export function deezerYear(t: Pick<DeezerTrack, "release_date" | "album">): number | null {
  const date = t.release_date ?? t.album?.release_date;
  const year = date ? Number(date.slice(0, 4)) : NaN;
  return year > 1900 && year < 2100 ? year : null;
}

let genreNames: Promise<Map<number, string>> | undefined;

/** Coarse genres from an artist's albums (Deezer has ~30 genres); a last-resort tag source. */
export async function deezerArtistGenres(
  artistId: number,
): Promise<{ name: string; count: number }[]> {
  genreNames ??= cached("dz:genres", 90 * DAY, () =>
    call<{ data: { id: number; name: string }[] }>("/genre"),
  )
    .then((res) => new Map((res?.data ?? []).map((g) => [g.id, g.name])))
    .catch((err) => {
      genreNames = undefined;
      throw err;
    });
  const [names, albums] = await Promise.all([
    genreNames,
    cached(`dz:artist-albums:${artistId}`, 30 * DAY, () =>
      call<{ data: { genre_id?: number }[] }>(`/artist/${artistId}/albums?limit=25`),
    ),
  ]);
  const counts = new Map<string, number>();
  for (const album of albums?.data ?? []) {
    const name = album.genre_id && album.genre_id > 0 ? names.get(album.genre_id) : undefined;
    // "Rap/Hip Hop" → "rap", "hip hop"
    for (const part of name?.split("/") ?? [])
      counts.set(part.trim(), (counts.get(part.trim()) ?? 0) + 1);
  }
  return [...counts.entries()].map(([name, count]) => ({ name, count }));
}
