import { env } from "../env";
import { normalizeArtist, normalizeTitle } from "../normalize";
import { cached, DAY } from "./cache";
import { fetchJson, RateLimiter, sleep } from "./http";

// Last.fm asks for no more than 5 requests per second averaged over 5 minutes.
const limiter = new RateLimiter(4, 4);
const BASE = "https://ws.audioscrobbler.com/2.0/";

export interface LfmTag {
  name: string;
  count: number;
}
export interface LfmSimilarArtist {
  name: string;
  mbid?: string;
  match: number;
}
export interface LfmSimilarTrack {
  name: string;
  artist: string;
  match: number;
}
export interface LfmTagTrack {
  name: string;
  artist: string;
  rank: number;
}

interface LfmError {
  error?: number;
  message?: string;
}

async function call<T>(params: Record<string, string>): Promise<T | null> {
  const key = env().LASTFM_API_KEY;
  if (!key) return null;
  const qs = new URLSearchParams({ ...params, api_key: key, format: "json", autocorrect: "1" });
  for (let attempt = 0; attempt < 4; attempt++) {
    const res = await fetchJson<T & LfmError>(`${BASE}?${qs}`, { limiter }).catch(
      (err: unknown) => {
        // Last.fm answers "not found" with HTTP 400/404 plus an error body.
        if (
          err &&
          typeof err === "object" &&
          "status" in err &&
          (err.status === 400 || err.status === 404)
        ) {
          return { error: 6 } as T & LfmError;
        }
        throw err;
      },
    );
    if (!res?.error) return res;
    if (res.error === 29 || res.error === 16 || res.error === 11) {
      limiter.penalize(5_000);
      await sleep(5_000);
      continue;
    }
    return null; // 6 = not found, others are not retryable
  }
  return null;
}

const arr = <T>(v: T | T[] | undefined): T[] => (Array.isArray(v) ? v : v ? [v] : []);

/** Like `cached`, but never caches anything while Last.fm is not configured. */
function lfmCached<T>(key: string, fallback: T, fn: () => Promise<T>): Promise<T> {
  if (!env().LASTFM_API_KEY) return Promise.resolve(fallback);
  return cached(key, 30 * DAY, fn);
}

export async function lfmArtistInfo(
  artist: string,
): Promise<{ mbid?: string; listeners?: number } | null> {
  return lfmCached<{ mbid?: string; listeners?: number } | null>(
    `lfm:artist-info:${normalizeArtist(artist)}`,
    null,
    async () => {
      const res = await call<{ artist?: { mbid?: string; stats?: { listeners?: string } } }>({
        method: "artist.getinfo",
        artist,
      });
      if (!res?.artist) return null;
      return {
        mbid: res.artist.mbid || undefined,
        listeners: res.artist.stats?.listeners ? Number(res.artist.stats.listeners) : undefined,
      };
    },
  );
}

export async function lfmArtistTags(artist: string): Promise<LfmTag[]> {
  return lfmCached<LfmTag[]>(`lfm:artist-tags:${normalizeArtist(artist)}`, [], async () => {
    const res = await call<{ toptags?: { tag?: { name: string; count: number | string }[] } }>({
      method: "artist.gettoptags",
      artist,
    });
    return arr(res?.toptags?.tag).map((t) => ({ name: t.name, count: Number(t.count) }));
  });
}

export async function lfmTrackTags(artist: string, track: string): Promise<LfmTag[]> {
  return lfmCached<LfmTag[]>(
    `lfm:track-tags:${normalizeArtist(artist)}::${normalizeTitle(track)}`,
    [],
    async () => {
      const res = await call<{ toptags?: { tag?: { name: string; count: number | string }[] } }>({
        method: "track.gettoptags",
        artist,
        track,
      });
      return arr(res?.toptags?.tag).map((t) => ({ name: t.name, count: Number(t.count) }));
    },
  );
}

export async function lfmSimilarArtists(artist: string, limit = 40): Promise<LfmSimilarArtist[]> {
  return lfmCached<LfmSimilarArtist[]>(
    `lfm:similar-artists:${normalizeArtist(artist)}:${limit}`,
    [],
    async () => {
      const res = await call<{
        similarartists?: { artist?: { name: string; mbid?: string; match: string | number }[] };
      }>({ method: "artist.getsimilar", artist, limit: String(limit) });
      return arr(res?.similarartists?.artist).map((a) => ({
        name: a.name,
        mbid: a.mbid || undefined,
        match: Number(a.match),
      }));
    },
  );
}

export async function lfmSimilarTracks(
  artist: string,
  track: string,
  limit = 40,
): Promise<LfmSimilarTrack[]> {
  return lfmCached<LfmSimilarTrack[]>(
    `lfm:similar-tracks:${normalizeArtist(artist)}::${normalizeTitle(track)}:${limit}`,
    [],
    async () => {
      const res = await call<{
        similartracks?: {
          track?: { name: string; match: number | string; artist: { name: string } }[];
        };
      }>({ method: "track.getsimilar", artist, track, limit: String(limit) });
      return arr(res?.similartracks?.track).map((t) => ({
        name: t.name,
        artist: t.artist.name,
        match: Number(t.match),
      }));
    },
  );
}

export async function lfmTagTopTracks(tag: string, limit = 50): Promise<LfmTagTrack[]> {
  return lfmCached<LfmTagTrack[]>(`lfm:tag-tracks:${tag}:${limit}`, [], async () => {
    const res = await call<{
      tracks?: { track?: { name: string; artist: { name: string }; "@attr"?: { rank: string } }[] };
    }>({ method: "tag.gettoptracks", tag, limit: String(limit) });
    return arr(res?.tracks?.track).map((t, i) => ({
      name: t.name,
      artist: t.artist.name,
      rank: Number(t["@attr"]?.rank ?? i + 1),
    }));
  });
}
