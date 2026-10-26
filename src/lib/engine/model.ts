import type { FeatureVector, ModelWeights } from "../types";
import { cdf, gaussian, vFn, wFn } from "./gaussian";

/**
 * Online Bayesian probit regression (in the spirit of Microsoft's AdPredictor).
 *
 * Each feature weight has a Gaussian belief N(μ, σ²). For a feature vector x the
 * utility is s = Σ xᵢwᵢ and the probability of a "like" is Φ(s / √(β² + Σ xᵢ²σᵢ²)).
 * Every observation (swipe, duel, ranking) is a probit factor that is absorbed with
 * closed-form assumed-density filtering, so learning is instant and needs no batch
 * training. The variances give calibrated uncertainty, which drives exploration
 * (Thompson sampling) and active learning (which song to ask about next).
 *
 * Pairwise preferences (A beats B) use the same update on the difference vector
 * x = φ(A) − φ(B): that is the Thurstone model of paired comparisons.
 */

export const BETA = 1;
const MIN_VARIANCE = 1e-4;

/** Prior beliefs. Dense meta-features start with sensible positive weights for cold start. */
export const DENSE_PRIORS: Record<string, [number, number]> = {
  "d:tagSim": [2.2, 0.6],
  "d:graph": [1.6, 0.6],
  "d:artist": [1.0, 0.6],
  "d:trackSim": [1.4, 0.6],
  "d:consensus": [0.8, 0.4],
  "d:era": [0.6, 0.4],
  "d:pop": [0.6, 0.4],
  "d:novel": [0, 0.5],
  bias: [0, 1],
};

export function prior(feature: string): [number, number] {
  const dense = DENSE_PRIORS[feature];
  if (dense) return dense;
  switch (feature[0]) {
    case "t": // tag
      return [0, 0.35];
    case "a": // artist
      return [0, 0.8];
    case "y": // decade
    case "p": // popularity bucket
      return [0, 0.25];
    case "b": // bpm bucket
      return [0, 0.15];
    default:
      return [0, 0.25];
  }
}

function belief(weights: ModelWeights, f: string): [number, number] {
  return weights[f] ?? prior(f);
}

export interface Prediction {
  /** Expected utility Σ xᵢμᵢ. */
  mean: number;
  /** Uncertainty of the utility Σ xᵢ²σᵢ². */
  variance: number;
  /** P(like). */
  p: number;
}

export function predict(weights: ModelWeights, x: FeatureVector, beta = BETA): Prediction {
  let mean = 0;
  let variance = 0;
  for (const f in x) {
    const xi = x[f]!;
    if (xi === 0) continue;
    const [mu, s2] = belief(weights, f);
    mean += xi * mu;
    variance += xi * xi * s2;
  }
  return { mean, variance, p: cdf(mean / Math.sqrt(beta * beta + variance)) };
}

/**
 * Absorbs one binary observation. y = +1 (liked / preferred) or -1.
 * `strength` < 1 weakens the observation (implemented as extra noise), e.g. for
 * implicit signals or the many pairs derived from a single ranking.
 * Returns the predicted P(y) before the update (useful for logging surprise).
 */
export function update(weights: ModelWeights, x: FeatureVector, y: 1 | -1, strength = 1): number {
  const beta = BETA / Math.sqrt(Math.max(strength, 1e-3));
  const { mean, variance } = predict(weights, x, beta);
  const total = beta * beta + variance;
  const sd = Math.sqrt(total);
  const t = (y * mean) / sd;
  const v = vFn(t);
  const w = wFn(t);
  for (const f in x) {
    const xi = x[f]!;
    if (xi === 0) continue;
    const [mu, s2] = belief(weights, f);
    const newMu = mu + ((y * xi * s2) / sd) * v;
    const newS2 = Math.max(s2 * (1 - ((xi * xi * s2) / total) * w), MIN_VARIANCE);
    weights[f] = [round(newMu), round(newS2)];
  }
  return cdf(t);
}

/** Pairwise preference: `winner` was preferred over `loser`. */
export function updatePair(
  weights: ModelWeights,
  winner: FeatureVector,
  loser: FeatureVector,
  strength = 1,
): number {
  return update(weights, difference(winner, loser), 1, strength);
}

export function difference(a: FeatureVector, b: FeatureVector): FeatureVector {
  const out: FeatureVector = { ...a };
  for (const f in b) out[f] = (out[f] ?? 0) - b[f]!;
  for (const f in out) if (Math.abs(out[f]!) < 1e-9) delete out[f];
  return out;
}

/**
 * Lets beliefs slowly forget so the model follows changing taste: variance grows
 * back toward the prior by `rate` per day elapsed.
 */
export function drift(weights: ModelWeights, days: number, rate = 0.01): void {
  if (days <= 0) return;
  for (const f in weights) {
    const [mu, s2] = weights[f]!;
    const p = prior(f)[1];
    if (s2 < p) weights[f] = [mu, round(Math.min(p, s2 + rate * days * p))];
  }
}

/** One Thompson sample of the full weight vector (lazily, only for features that occur). */
export function sampler(weights: ModelWeights, random: () => number, temperature = 1) {
  const drawn = new Map<string, number>();
  return (x: FeatureVector): number => {
    let s = 0;
    for (const f in x) {
      let w = drawn.get(f);
      if (w === undefined) {
        const [mu, s2] = belief(weights, f);
        w = mu + Math.sqrt(s2) * temperature * gaussian(random);
        drawn.set(f, w);
      }
      s += x[f]! * w;
    }
    return s;
  };
}

/** Per-feature contribution xᵢμᵢ, used for explanations. */
export function contributions(weights: ModelWeights, x: FeatureVector): [string, number][] {
  return Object.keys(x)
    .map((f) => [f, x[f]! * belief(weights, f)[0]] as [string, number])
    .sort((a, b) => b[1] - a[1]);
}

/** Keeps stored JSON compact. */
function round(n: number): number {
  return Math.round(n * 1e5) / 1e5;
}
