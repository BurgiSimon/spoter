import { vFn, wFn } from "./gaussian";

/**
 * TrueSkill-style ratings for songs in your own library. Every duel or ranking
 * between two known songs moves their ratings; the rating then scales how much
 * each song shapes your taste profile ("you play it a lot" vs "you truly love it").
 */

export interface Rating {
  mu: number;
  sigma: number;
}

export const RATING_BETA = 0.5;
const MIN_SIGMA = 0.08;

/** Prior from implicit signals (z-scored listening weight). */
export function initialRating(implicitZ: number): Rating {
  return { mu: Math.max(-2, Math.min(2, implicitZ)) * 0.5, sigma: 1 };
}

export function rate(winner: Rating, loser: Rating, strength = 1): [Rating, Rating] {
  const beta2 = (RATING_BETA * RATING_BETA) / Math.max(strength, 1e-3);
  const c2 = 2 * beta2 + winner.sigma ** 2 + loser.sigma ** 2;
  const c = Math.sqrt(c2);
  const t = (winner.mu - loser.mu) / c;
  const v = vFn(t);
  const w = wFn(t);
  const w2 = winner.sigma ** 2;
  const l2 = loser.sigma ** 2;
  return [
    {
      mu: winner.mu + (w2 / c) * v,
      sigma: Math.max(Math.sqrt(w2 * (1 - (w2 / c2) * w)), MIN_SIGMA),
    },
    {
      mu: loser.mu - (l2 / c) * v,
      sigma: Math.max(Math.sqrt(l2 * (1 - (l2 / c2) * w)), MIN_SIGMA),
    },
  ];
}

/** A full ordering (best first) expands to every implied pair. */
export function rankingToPairs<T>(ordered: T[]): [T, T][] {
  const pairs: [T, T][] = [];
  for (let i = 0; i < ordered.length; i++)
    for (let j = i + 1; j < ordered.length; j++) pairs.push([ordered[i]!, ordered[j]!]);
  return pairs;
}

/** Conservative skill estimate used for "your top songs" lists. */
export function conservative(r: Rating): number {
  return r.mu - 2 * r.sigma;
}
