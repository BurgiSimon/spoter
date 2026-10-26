import { normalizeArtist } from "../normalize";
import { cached, DAY } from "./cache";
import { fetchJson, RateLimiter } from "./http";

// MusicBrainz allows one request per second per client and requires a descriptive User-Agent.
const limiter = new RateLimiter(1, 1);

export interface MbArtist {
  mbid: string;
  tags: { name: string; count: number }[];
}

interface SearchResult {
  artists?: { id: string; name: string; score: number; tags?: { name: string; count: number }[] }[];
}

/** Keyless artist lookup: MBID (for ListenBrainz) plus community tags such as "shoegaze". */
export async function mbSearchArtist(name: string): Promise<MbArtist | null> {
  const n = normalizeArtist(name);
  return cached(`mb:artist:${n}`, 60 * DAY, async () => {
    const query = `artist:"${name.replace(/["\\]/g, " ")}"`;
    const res = await fetchJson<SearchResult>(
      `https://musicbrainz.org/ws/2/artist/?query=${encodeURIComponent(query)}&fmt=json&limit=5`,
      { limiter, retries: 2 },
    ).catch(() => null);
    const candidates = (res?.artists ?? []).filter(
      (a) => a.score >= 90 && normalizeArtist(a.name) === n,
    );
    // Ambiguous names: prefer the entry the community tagged the most.
    candidates.sort(
      (x, y) =>
        (y.tags ?? []).reduce((s, t) => s + t.count, 0) -
        (x.tags ?? []).reduce((s, t) => s + t.count, 0),
    );
    const best = candidates[0];
    if (!best) return null;
    return { mbid: best.id, tags: (best.tags ?? []).filter((t) => t.count > 0) };
  });
}
