/** Gaussian helpers shared by the probit model and pairwise ratings. */

const INV_SQRT_2PI = 0.3989422804014327;

export function pdf(x: number): number {
  return INV_SQRT_2PI * Math.exp(-0.5 * x * x);
}

/** Complementary error function with fractional error < 1.2e-7 (Numerical Recipes erfcc). */
export function erfc(x: number): number {
  const z = Math.abs(x);
  const t = 1 / (1 + 0.5 * z);
  const r =
    t *
    Math.exp(
      -z * z -
        1.26551223 +
        t *
          (1.00002368 +
            t *
              (0.37409196 +
                t *
                  (0.09678418 +
                    t *
                      (-0.18628806 +
                        t *
                          (0.27886807 +
                            t *
                              (-1.13520398 +
                                t * (1.48851587 + t * (-0.82215223 + t * 0.17087277)))))))),
    );
  return x >= 0 ? r : 2 - r;
}

export function cdf(x: number): number {
  return 0.5 * erfc(-x / Math.SQRT2);
}

/** v(t) = N(t) / Φ(t), the mean correction of a truncated Gaussian. Stable for very negative t. */
export function vFn(t: number): number {
  if (t < -6) {
    // Asymptotic expansion of the inverse Mills ratio.
    const t2 = t * t;
    return -t / (1 - 1 / t2 + 3 / (t2 * t2) - 15 / (t2 * t2 * t2));
  }
  return pdf(t) / Math.max(cdf(t), 1e-300);
}

/** w(t) = v(t) · (v(t) + t), the variance correction, always in (0, 1). */
export function wFn(t: number): number {
  const v = vFn(t);
  return Math.min(Math.max(v * (v + t), 1e-9), 1 - 1e-9);
}

/** Deterministic PRNG (mulberry32) so recommendations are reproducible in tests. */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Standard normal sample via Box-Muller. */
export function gaussian(random: () => number): number {
  const u = Math.max(random(), 1e-12);
  const v = random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}
