import { normalizeTag } from "../normalize";
import type { TagVector } from "../types";

/** Converts provider tags (Last.fm counts 0–100, Spotify genres, Deezer genres) into a TagVector. */
export function tagVectorFrom(
  tags: { name: string; count: number }[],
  opts: { artistNameNorm?: string; limit?: number } = {},
): TagVector {
  const out: TagVector = {};
  const max = Math.max(1, ...tags.map((t) => t.count));
  for (const t of tags) {
    const name = normalizeTag(t.name, opts.artistNameNorm);
    if (!name || t.count <= 0) continue;
    const w = t.count / max;
    if (w < 0.05) continue;
    out[name] = Math.max(out[name] ?? 0, round(w));
  }
  return topN(out, opts.limit ?? 15);
}

/** Genres have no weights; earlier entries are usually more representative. */
export function tagVectorFromGenres(genres: string[]): TagVector {
  return tagVectorFrom(genres.map((g, i) => ({ name: g, count: 100 - i * 8 })));
}

export function mergeTags(parts: [TagVector, number][]): TagVector {
  const out: TagVector = {};
  for (const [vec, weight] of parts) for (const t in vec) out[t] = (out[t] ?? 0) + vec[t]! * weight;
  const max = Math.max(0, ...Object.values(out));
  if (max > 0) for (const t in out) out[t] = round(out[t]! / max);
  return out;
}

/** Track tags win when present, otherwise the artist's tags stand in for the track. */
export function effectiveTags(
  trackTags: TagVector,
  artistTags: TagVector,
  genres: string[] = [],
): TagVector {
  const hasTrack = Object.keys(trackTags).length >= 3;
  const genreTags = genres.length ? tagVectorFromGenres(genres) : {};
  return mergeTags([
    [trackTags, hasTrack ? 0.6 : 0.3],
    [artistTags, hasTrack ? 0.4 : 0.7],
    [genreTags, 0.3],
  ]);
}

export function idfWeight(df: number | undefined, totalDocs: number): number {
  return Math.log((totalDocs + 1) / ((df ?? 0) + 1)) + 1;
}

export function tfidf(vec: TagVector, idf: (tag: string) => number): TagVector {
  const out: TagVector = {};
  for (const t in vec) out[t] = vec[t]! * idf(t);
  return l2normalize(out);
}

export function l2normalize(vec: TagVector): TagVector {
  let norm = 0;
  for (const t in vec) norm += vec[t]! * vec[t]!;
  norm = Math.sqrt(norm);
  if (norm === 0) return {};
  const out: TagVector = {};
  for (const t in vec) out[t] = vec[t]! / norm;
  return out;
}

/** Dot product; equals cosine similarity for L2-normalized vectors. */
export function dot(a: TagVector, b: TagVector): number {
  let s = 0;
  const [small, large] = Object.keys(a).length < Object.keys(b).length ? [a, b] : [b, a];
  for (const t in small) {
    const v = large[t];
    if (v !== undefined) s += small[t]! * v;
  }
  return s;
}

export function cosine(a: TagVector, b: TagVector): number {
  return dot(l2normalize(a), l2normalize(b));
}

export function topN(vec: TagVector, n: number): TagVector {
  return Object.fromEntries(
    Object.entries(vec)
      .sort((x, y) => y[1] - x[1])
      .slice(0, n),
  );
}

/** Tags two vectors share, strongest first: used for "because you like shoegaze". */
export function sharedTags(a: TagVector, b: TagVector, n = 3): string[] {
  return Object.keys(a)
    .filter((t) => b[t] !== undefined)
    .sort((x, y) => a[y]! * b[y]! - a[x]! * b[x]!)
    .slice(0, n);
}

function round(n: number): number {
  return Math.round(n * 1000) / 1000;
}
