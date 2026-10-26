/**
 * Personalized PageRank over the artist similarity graph. The random surfer
 * restarts at the user's artists (weighted by affinity), so the stationary
 * distribution scores how "reachable" every other artist is from your taste.
 * Unlike one-hop "similar artists", it rewards artists that are close to many of
 * your favourites at once and finds second- and third-degree neighbours.
 */

export interface Edge {
  from: string;
  to: string;
  weight: number;
}

export function personalizedPageRank(
  edges: Edge[],
  seeds: Map<string, number>,
  opts: { restart?: number; iterations?: number; tolerance?: number } = {},
): Map<string, number> {
  const restart = opts.restart ?? 0.25;
  const iterations = opts.iterations ?? 40;
  const tolerance = opts.tolerance ?? 1e-6;

  // Symmetrize: similarity is mutual even if a provider only lists one direction.
  const adj = new Map<string, Map<string, number>>();
  const add = (a: string, b: string, w: number) => {
    let m = adj.get(a);
    if (!m) adj.set(a, (m = new Map()));
    m.set(b, Math.max(m.get(b) ?? 0, w));
  };
  for (const e of edges) {
    if (e.from === e.to || e.weight <= 0) continue;
    add(e.from, e.to, e.weight);
    add(e.to, e.from, e.weight);
  }

  const seedTotal = [...seeds.values()].reduce((s, v) => s + Math.max(v, 0), 0);
  if (seedTotal <= 0) return new Map();
  const teleport = new Map<string, number>();
  for (const [k, v] of seeds) if (v > 0) teleport.set(k, v / seedTotal);

  const totals = new Map<string, number>();
  for (const [node, nbrs] of adj) {
    let s = 0;
    for (const w of nbrs.values()) s += w;
    totals.set(node, s);
  }

  let rank = new Map(teleport);
  for (let i = 0; i < iterations; i++) {
    const next = new Map<string, number>();
    let dangling = 0;
    for (const [node, r] of rank) {
      const nbrs = adj.get(node);
      const total = totals.get(node) ?? 0;
      if (!nbrs || total === 0) {
        dangling += r;
        continue;
      }
      for (const [nbr, w] of nbrs)
        next.set(nbr, (next.get(nbr) ?? 0) + (1 - restart) * r * (w / total));
    }
    // Restart mass plus mass that hit a dead end goes back to the seeds.
    const back = restart + (1 - restart) * dangling;
    for (const [k, t] of teleport) next.set(k, (next.get(k) ?? 0) + back * t);

    let delta = 0;
    for (const [k, v] of next) delta += Math.abs(v - (rank.get(k) ?? 0));
    rank = next;
    if (delta < tolerance) break;
  }
  return rank;
}

/** Maps raw scores to [0, 1] by rank percentile (robust to the heavy-tailed PPR distribution). */
export function rankNormalize(scores: Map<string, number>, keep = 3000): Record<string, number> {
  const sorted = [...scores.entries()].sort((a, b) => b[1] - a[1]).slice(0, keep);
  const n = sorted.length;
  const out: Record<string, number> = {};
  sorted.forEach(([k], i) => {
    out[k] = Math.round((1 - i / Math.max(n, 1)) * 1000) / 1000;
  });
  return out;
}
