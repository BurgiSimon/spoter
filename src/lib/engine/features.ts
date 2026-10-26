import type { CandidateSource, FeatureVector, ProfileData, TagVector } from "../types";
import { dot, tfidf, topN } from "./tags";

export interface TrackFacts {
  trackId: string;
  artistId: string;
  /** Effective tags (track + artist + genres), not yet IDF weighted. */
  tags: TagVector;
  releaseYear: number | null;
  rank: number | null;
  explicit: boolean | null;
  bpm: number | null;
  sources: CandidateSource[];
  knownArtist: boolean;
}

/**
 * Dense features are centered so that an "average" candidate sits near zero and the
 * bias term carries the base rate. Keeping them roughly zero-mean makes the probit
 * updates symmetric for likes and passes.
 */
export const DENSE_CENTER: Record<string, number> = {
  "d:tagSim": 0.25,
  "d:graph": 0.4,
  "d:artist": 0.15,
  "d:trackSim": 0.15,
  "d:consensus": 0.2,
  "d:era": 0.5,
  "d:pop": 0.5,
  "d:novel": 0.7,
};

export function decadeOf(year: number | null): number | null {
  return year ? Math.floor(year / 10) * 10 : null;
}

export function popularityBucket(rank: number | null): number | null {
  if (rank === null || rank <= 0) return null;
  return Math.min(6, Math.floor(Math.log10(rank + 1)));
}

export function trackFeatures(
  c: TrackFacts,
  profile: ProfileData,
  idf: (tag: string) => number,
): FeatureVector {
  const weighted = tfidf(c.tags, idf);
  const x: FeatureVector = {};

  const dense: Record<string, number> = {
    "d:tagSim": dot(weighted, profile.tags),
    "d:graph": profile.graph[c.artistId] ?? 0,
    "d:artist": profile.artists[c.artistId] ?? 0,
    "d:trackSim": Math.max(
      0,
      ...c.sources.filter((s) => s.type === "similar-track").map((s) => s.score),
    ),
    "d:consensus": 1 - Math.exp(-Math.max(0, distinctSeeds(c.sources) - 1) / 2),
    "d:era": eraFit(c.releaseYear, profile),
    "d:pop": popularityFit(c.rank, profile),
    "d:novel": c.knownArtist ? 0 : 1,
  };
  for (const f in dense) x[f] = round(dense[f]! - DENSE_CENTER[f]!);

  for (const [tag, w] of Object.entries(topN(weighted, 8))) x[`t:${tag}`] = round(w);
  x[`a:${c.artistId}`] = 1;
  const decade = decadeOf(c.releaseYear);
  if (decade) x[`y:${decade}`] = 1;
  const pop = popularityBucket(c.rank);
  if (pop !== null) x[`p:${pop}`] = 1;
  if (c.bpm && c.bpm > 40) x[`b:${Math.round(c.bpm / 20) * 20}`] = 1;
  if (c.explicit) x["x:explicit"] = 1;
  x.bias = 1;
  return x;
}

function distinctSeeds(sources: CandidateSource[]): number {
  return new Set(sources.map((s) => `${s.type}:${s.seedId ?? s.seedLabel ?? ""}`)).size;
}

function eraFit(year: number | null, profile: ProfileData): number {
  const decade = decadeOf(year);
  if (!decade) return 0.5;
  const max = Math.max(0, ...Object.values(profile.decades));
  if (max === 0) return 0.5;
  return (profile.decades[String(decade)] ?? 0) / max;
}

function popularityFit(rank: number | null, profile: ProfileData): number {
  if (rank === null || rank <= 0) return 0.5;
  const z = (Math.log10(rank + 1) - profile.popularity.mean) / (profile.popularity.std + 0.25);
  return Math.exp(-(z * z) / 2);
}

function round(n: number): number {
  return Math.round(n * 1000) / 1000;
}
