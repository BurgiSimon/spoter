import type {
  CandidateSource,
  FeatureVector,
  ModelWeights,
  TagVector,
  UserSettings,
} from "../types";
import { predict, sampler } from "./model";
import { diversify } from "./rerank";

export interface PoolItem {
  trackId: string;
  artistId: string;
  tags: TagVector;
  features: FeatureVector;
  sources: CandidateSource[];
  rank: number | null;
}

export interface Scored extends PoolItem {
  id: string;
  mean: number;
  variance: number;
  p: number;
  score: number;
}

/** User-facing knobs that shift the ranking without touching the learned model. */
export function settingsAdjustment(item: PoolItem, settings: UserSettings): number {
  let adj = 0;
  const novel = (item.features["d:novel"] ?? 0) > 0;
  adj += (settings.adventurousness - 0.35) * (novel ? 0.8 : -0.4);
  if (item.rank !== null && item.rank > 0) {
    const popularity = Math.log10(item.rank + 1) / 6 - 0.5; // ~[-0.5, 0.5]
    adj += settings.popularity * popularity * 1.6;
  }
  return adj;
}

export function scorePool(
  pool: PoolItem[],
  weights: ModelWeights,
  settings: UserSettings,
  opts: { explore: boolean; random: () => number },
): Scored[] {
  const sample = opts.explore
    ? sampler(weights, opts.random, 0.6 + settings.adventurousness)
    : null;
  return pool.map((item) => {
    const pred = predict(weights, item.features);
    const base = sample ? sample(item.features) : pred.mean;
    return {
      ...item,
      id: item.trackId,
      mean: pred.mean,
      variance: pred.variance,
      p: pred.p,
      score: base + settingsAdjustment(item, settings),
    };
  });
}

/** The next cards for swiping: Thompson-sampled, then diversified. */
export function nextBatch(
  pool: PoolItem[],
  weights: ModelWeights,
  settings: UserSettings,
  opts: { size: number; random: () => number; recentArtists?: Set<string> },
): Scored[] {
  const scored = scorePool(pool, weights, settings, { explore: true, random: opts.random });
  return diversify(scored, opts.size, { recentArtists: opts.recentArtists, maxPerArtist: 1 });
}

/** The "For you" list: best posterior mean, diversified, no exploration noise. */
export function topRecommendations(
  pool: PoolItem[],
  weights: ModelWeights,
  settings: UserSettings,
  opts: { size: number; random: () => number },
): Scored[] {
  const scored = scorePool(pool, weights, settings, { explore: false, random: opts.random });
  return diversify(scored, opts.size, { maxPerArtist: 2, lambda: 0.8 });
}
