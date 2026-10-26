import { cached, DAY } from "./cache";
import { fetchJson, RateLimiter } from "./http";

const limiter = new RateLimiter(2, 2);
const ALGORITHM =
  "session_based_days_7500_session_300_contribution_5_threshold_10_limit_100_filter_True_skip_30";

export interface LbSimilarArtist {
  mbid: string;
  name: string;
  /** Normalized to (0, 1] relative to the strongest neighbour. */
  score: number;
}

/** ListenBrainz Labs: artists listened to in the same sessions. Keyless, best effort. */
export async function lbSimilarArtists(mbid: string): Promise<LbSimilarArtist[]> {
  return cached(`lb:similar:${mbid}`, 30 * DAY, async () => {
    const url = `https://labs.api.listenbrainz.org/similar-artists/json?artist_mbids=${encodeURIComponent(mbid)}&algorithm=${ALGORITHM}`;
    const rows = await fetchJson<{ artist_mbid: string; name: string; score: number }[]>(url, {
      limiter,
      retries: 1,
    }).catch(() => []);
    const max = Math.max(1, ...rows.map((r) => r.score));
    return rows
      .slice(0, 50)
      .map((r) => ({ mbid: r.artist_mbid, name: r.name, score: r.score / max }));
  });
}
