import type { TagVector } from "../types";
import { cosine } from "./tags";

export interface RankItem {
  id: string;
  score: number;
  artistId: string;
  tags: TagVector;
}

/**
 * Maximal Marginal Relevance: greedily trades relevance against similarity to what
 * was already picked, so a batch is not ten songs by the same artist or genre.
 */
export function diversify<T extends RankItem>(
  items: T[],
  k: number,
  opts: { lambda?: number; recentArtists?: Set<string>; maxPerArtist?: number; pool?: number } = {},
): T[] {
  const lambda = opts.lambda ?? 0.72;
  const maxPerArtist = opts.maxPerArtist ?? 1;
  const pool = [...items]
    .sort((a, b) => b.score - a.score)
    .slice(0, opts.pool ?? Math.max(k * 12, 120));
  if (pool.length === 0) return [];
  const hi = pool[0]!.score;
  const lo = pool[pool.length - 1]!.score;
  const norm = (s: number) => (hi === lo ? 1 : (s - lo) / (hi - lo));

  const picked: T[] = [];
  const perArtist = new Map<string, number>();
  const remaining = new Set(pool);
  while (picked.length < k && remaining.size > 0) {
    let best: T | undefined;
    let bestValue = -Infinity;
    const capReached = [...remaining].every(
      (c) => (perArtist.get(c.artistId) ?? 0) >= maxPerArtist,
    );
    for (const c of remaining) {
      if (!capReached && (perArtist.get(c.artistId) ?? 0) >= maxPerArtist) continue;
      let maxSim = 0;
      for (const p of picked) {
        const sim = 0.6 * cosine(c.tags, p.tags) + (c.artistId === p.artistId ? 0.4 : 0);
        if (sim > maxSim) maxSim = sim;
      }
      let value = lambda * norm(c.score) - (1 - lambda) * maxSim;
      if (opts.recentArtists?.has(c.artistId)) value -= 0.25;
      if (value > bestValue) {
        bestValue = value;
        best = c;
      }
    }
    if (!best) break;
    picked.push(best);
    remaining.delete(best);
    perArtist.set(best.artistId, (perArtist.get(best.artistId) ?? 0) + 1);
  }
  return picked;
}
