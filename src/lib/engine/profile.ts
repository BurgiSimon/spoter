import type { ProfileData, TagVector } from "../types";
import { personalizedPageRank, rankNormalize, type Edge } from "./graph";
import { l2normalize, tfidf, topN } from "./tags";

/** Everything the profile builder needs to know about one library track. */
export interface LibraryTrack {
  trackId: string;
  artistId: string;
  tags: TagVector; // effective tags (track + artist + genres)
  releaseYear: number | null;
  rank: number | null;
  explicit: boolean | null;
  saved: boolean;
  playlistCount: number;
  playCount: number;
  skipCount: number;
  msPlayed: number;
  lastPlayedAt: Date | null;
  topShort: number | null;
  topMedium: number | null;
  topLong: number | null;
  inExportLibrary: boolean;
  /** Liked through Spoter (2) or superliked (4); 0 otherwise. */
  discovered: number;
  banned: boolean;
  ratingMu: number | null;
}

export interface LibraryArtist {
  artistId: string;
  followed: boolean;
  topShort: number | null;
  topMedium: number | null;
  topLong: number | null;
  blocked: boolean;
}

const DAY = 86_400_000;

/**
 * How much a library track says about your taste. Combines listening volume
 * (with diminishing returns), recency, saves, playlists, top lists and skips,
 * then scales by explicit pairwise ratings when you have ranked the song.
 */
export function implicitWeight(t: LibraryTrack, now = Date.now()): number {
  if (t.banned) return 0;
  let w = 0;
  if (t.playCount > 0) {
    const ageDays = t.lastPlayedAt ? (now - t.lastPlayedAt.getTime()) / DAY : 365;
    const recency = 0.45 + 0.55 * Math.exp(-ageDays / 540);
    w += Math.log1p(t.playCount) * recency;
  }
  if (t.saved) w += 1.5;
  if (t.inExportLibrary && !t.saved) w += 1.2;
  if (t.playlistCount > 0) w += 0.6 * Math.log1p(t.playlistCount);
  const top = (rank: number | null, scale: number) => (rank ? scale * (1 - (rank - 1) / 50) : 0);
  w += top(t.topShort, 1.6) + top(t.topMedium, 1.3) + top(t.topLong, 1.1);
  if (t.discovered === 2) w += 1.4;
  if (t.discovered === 4) w += 2.4;

  const plays = t.playCount + t.skipCount;
  if (plays >= 3) w *= 1 - 0.6 * (t.skipCount / plays);
  if (t.ratingMu !== null) w *= Math.exp(0.6 * Math.max(-2.5, Math.min(2.5, t.ratingMu)));
  return Math.max(w, 0);
}

/** z-score of log weights; seeds the TrueSkill prior for a song's first duel. */
export function implicitZScores(weights: Map<string, number>): Map<string, number> {
  const logs = [...weights.values()].filter((w) => w > 0).map((w) => Math.log(w));
  const mean = logs.reduce((s, v) => s + v, 0) / Math.max(logs.length, 1);
  const std =
    Math.sqrt(logs.reduce((s, v) => s + (v - mean) ** 2, 0) / Math.max(logs.length, 1)) || 1;
  const out = new Map<string, number>();
  for (const [k, w] of weights) out.set(k, w > 0 ? (Math.log(w) - mean) / std : -2);
  return out;
}

export function buildProfile(input: {
  tracks: LibraryTrack[];
  artists: LibraryArtist[];
  edges: Edge[];
  idf: (tag: string) => number;
  now?: number;
}): { profile: ProfileData; weights: Map<string, number> } {
  const now = input.now ?? Date.now();
  const weights = new Map<string, number>();
  const artistMass = new Map<string, number>();
  const tagMass: TagVector = {};
  const decades = new Map<number, number>();
  let popSum = 0;
  let popSq = 0;
  let popW = 0;
  let explicitW = 0;
  let totalW = 0;
  let plays = 0;
  let ms = 0;

  for (const t of input.tracks) {
    plays += t.playCount;
    ms += t.msPlayed;
    const w = implicitWeight(t, now);
    weights.set(t.trackId, w);
    if (w <= 0) continue;
    totalW += w;
    artistMass.set(t.artistId, (artistMass.get(t.artistId) ?? 0) + w);
    for (const tag in t.tags) tagMass[tag] = (tagMass[tag] ?? 0) + w * t.tags[tag]!;
    if (t.releaseYear) {
      const d = Math.floor(t.releaseYear / 10) * 10;
      decades.set(d, (decades.get(d) ?? 0) + w);
    }
    if (t.rank !== null && t.rank > 0) {
      const lp = Math.log10(t.rank + 1);
      popSum += w * lp;
      popSq += w * lp * lp;
      popW += w;
    }
    if (t.explicit) explicitW += w;
  }

  const blocked = new Set(input.artists.filter((a) => a.blocked).map((a) => a.artistId));
  for (const a of input.artists) {
    if (a.blocked) {
      artistMass.delete(a.artistId);
      continue;
    }
    const top = (rank: number | null, scale: number) => (rank ? scale * (1 - (rank - 1) / 50) : 0);
    const bonus =
      (a.followed ? 2 : 0) + top(a.topShort, 3) + top(a.topMedium, 2.5) + top(a.topLong, 2);
    if (bonus > 0) artistMass.set(a.artistId, (artistMass.get(a.artistId) ?? 0) + bonus);
  }

  // Artist affinity: log-compressed so one obsession does not drown everything else.
  const maxMass = Math.max(0, ...artistMass.values());
  const artists: Record<string, number> = {};
  [...artistMass.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 800)
    .forEach(([id, m]) => {
      artists[id] = Math.round((Math.log1p(m) / Math.log1p(maxMass || 1)) * 1000) / 1000;
    });

  const tags = topN(tfidf(tagMass, input.idf), 150);

  // Decade histogram, smoothed into neighbouring decades (never into the future).
  const currentDecade = Math.floor(new Date(now).getUTCFullYear() / 10) * 10;
  const smoothed = new Map<number, number>();
  for (const [d, w] of decades) {
    smoothed.set(d, (smoothed.get(d) ?? 0) + w);
    smoothed.set(d - 10, (smoothed.get(d - 10) ?? 0) + w * 0.25);
    if (d + 10 <= currentDecade) smoothed.set(d + 10, (smoothed.get(d + 10) ?? 0) + w * 0.25);
  }
  const decadeTotal = [...smoothed.values()].reduce((s, v) => s + v, 0);
  const decadesOut: Record<string, number> = {};
  for (const [d, w] of [...smoothed.entries()].sort((a, b) => a[0] - b[0]))
    if (d >= 1900 && d <= 2100)
      decadesOut[String(d)] = Math.round((w / (decadeTotal || 1)) * 1000) / 1000;

  const popMean = popW ? popSum / popW : 5;
  const popStd = popW ? Math.sqrt(Math.max(popSq / popW - popMean * popMean, 0.01)) : 0.6;

  const seeds = new Map<string, number>();
  for (const [id, a] of Object.entries(artists)) seeds.set(id, a * a);
  const ppr = personalizedPageRank(
    input.edges.filter((e) => !blocked.has(e.from) && !blocked.has(e.to)),
    seeds,
  );

  return {
    weights,
    profile: {
      tags: l2normalize(tags),
      artists,
      graph: rankNormalize(ppr),
      decades: decadesOut,
      popularity: { mean: popMean, std: popStd },
      stats: {
        tracks: input.tracks.length,
        artists: artistMass.size,
        plays,
        hours: Math.round(ms / 3_600_000),
        explicitShare: totalW ? Math.round((explicitW / totalW) * 100) / 100 : 0,
      },
    },
  };
}
