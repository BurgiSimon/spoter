import { BETA } from "./model";

export interface Option {
  id: string;
  mean: number;
  variance: number;
}

/**
 * Expected information of asking "A or B?": high when both are uncertain and the
 * model cannot already predict the winner (means are close). This is the
 * uncertainty-sampling heuristic for Thurstone comparisons.
 */
export function pairInformation(a: Option, b: Option, beta = BETA): number {
  const v = a.variance + b.variance;
  const d = a.mean - b.mean;
  return (v + 0.01) * Math.exp(-(d * d) / (2 * (v + beta * beta)));
}

/** Picks a pair from two pools (they may be the same pool) maximizing information. */
export function pickPair(
  left: Option[],
  right: Option[],
  random: () => number,
  opts: { samples?: number; exclude?: Set<string> } = {},
): [Option, Option] | null {
  const ok = (o: Option) => !opts.exclude?.has(o.id);
  const l = left.filter(ok);
  const r = right.filter(ok);
  if (l.length === 0 || r.length === 0) return null;
  const samples = opts.samples ?? 250;
  const scored: { pair: [Option, Option]; info: number }[] = [];
  for (let i = 0; i < samples; i++) {
    const a = l[Math.floor(random() * l.length)]!;
    const b = r[Math.floor(random() * r.length)]!;
    if (a.id === b.id) continue;
    scored.push({ pair: [a, b], info: pairInformation(a, b) });
  }
  if (scored.length === 0) return null;
  scored.sort((x, y) => y.info - x.info);
  // Sample among the top few so sessions don't repeat the exact same question.
  const top = scored.slice(0, 5);
  return top[Math.floor(random() * top.length)]!.pair;
}

/**
 * Picks `n` songs to rank: the least-certain ones, spread across the rating range so
 * the ordering is informative (ranking five equally-loved songs teaches little).
 */
export function pickRankSet(
  options: Option[],
  n: number,
  random: () => number,
  exclude?: Set<string>,
): Option[] {
  const pool = options.filter((o) => !exclude?.has(o.id));
  if (pool.length <= n) return shuffle(pool, random);
  const uncertain = [...pool]
    .sort((a, b) => b.variance + random() * 0.2 - (a.variance + random() * 0.2))
    .slice(0, Math.max(n * 8, 40))
    .sort((a, b) => a.mean - b.mean);
  const out: Option[] = [];
  for (let i = 0; i < n; i++) {
    const start = Math.floor((i * uncertain.length) / n);
    const end = Math.floor(((i + 1) * uncertain.length) / n);
    const stratum = uncertain.slice(start, Math.max(end, start + 1));
    out.push(stratum[Math.floor(random() * stratum.length)]!);
  }
  return shuffle(out, random);
}

export function shuffle<T>(items: T[], random: () => number): T[] {
  const a = [...items];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [a[i], a[j]] = [a[j]!, a[i]!];
  }
  return a;
}
