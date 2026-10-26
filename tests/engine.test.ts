import { describe, expect, it } from "vitest";
import { cdf, rng, vFn, wFn } from "@/lib/engine/gaussian";
import { predict, update, updatePair, difference, drift, sampler } from "@/lib/engine/model";
import { rate, rankingToPairs, initialRating } from "@/lib/engine/rating";
import { personalizedPageRank, rankNormalize } from "@/lib/engine/graph";
import { buildProfile, implicitWeight, type LibraryTrack } from "@/lib/engine/profile";
import { diversify, type RankItem } from "@/lib/engine/rerank";
import { pairInformation, pickRankSet } from "@/lib/engine/active";
import { trackFeatures } from "@/lib/engine/features";
import { effectiveTags, tagVectorFrom, cosine } from "@/lib/engine/tags";
import { explain } from "@/lib/engine/explain";
import type { ModelWeights, ProfileData } from "@/lib/types";

describe("gaussian helpers", () => {
  it("computes the normal CDF accurately", () => {
    expect(cdf(0)).toBeCloseTo(0.5, 6);
    expect(cdf(1.96)).toBeCloseTo(0.975, 3);
    expect(cdf(-1.96)).toBeCloseTo(0.025, 3);
  });

  it("keeps v and w finite in the far tail", () => {
    for (const t of [-40, -12, -6.01, -5.99, 0, 8]) {
      expect(Number.isFinite(vFn(t))).toBe(true);
      expect(wFn(t)).toBeGreaterThan(0);
      expect(wFn(t)).toBeLessThan(1);
    }
    // v(t) ≈ -t for very negative t
    expect(vFn(-30)).toBeCloseTo(30, 0);
  });
});

describe("probit preference model", () => {
  it("moves weights toward liked features and shrinks uncertainty", () => {
    const w: ModelWeights = {};
    const x = { "t:shoegaze": 1, bias: 1 };
    const before = predict(w, x);
    update(w, x, 1);
    const after = predict(w, x);
    expect(after.mean).toBeGreaterThan(before.mean);
    expect(after.variance).toBeLessThan(before.variance);
    update(w, { "t:edm": 1, bias: 1 }, -1);
    expect(w["t:edm"]![0]).toBeLessThan(0);
  });

  it("weaker observations move the model less", () => {
    const strong: ModelWeights = {};
    const weak: ModelWeights = {};
    update(strong, { "t:jazz": 1 }, 1, 1);
    update(weak, { "t:jazz": 1 }, 1, 0.2);
    expect(strong["t:jazz"]![0]).toBeGreaterThan(weak["t:jazz"]![0]);
  });

  it("learns a hidden taste from swipes and duels", () => {
    const random = rng(7);
    const tags = ["rock", "pop", "jazz", "metal", "folk", "house"];
    const truth: Record<string, number> = {
      rock: 1.5,
      folk: 1,
      jazz: 0.2,
      pop: -1,
      metal: -0.5,
      house: -1.5,
    };
    const w: ModelWeights = {};
    const song = () => {
      const a = tags[Math.floor(random() * tags.length)]!;
      const b = tags[Math.floor(random() * tags.length)]!;
      const x: Record<string, number> = { bias: 1 };
      x[`t:${a}`] = (x[`t:${a}`] ?? 0) + 0.8;
      x[`t:${b}`] = (x[`t:${b}`] ?? 0) + 0.6;
      const u = Object.entries(x).reduce((s, [f, v]) => s + (truth[f.slice(2)] ?? 0) * v, 0);
      return { x, u };
    };
    for (let i = 0; i < 150; i++) {
      const s = song();
      update(w, s.x, s.u + (random() - 0.5) * 0.5 > 0 ? 1 : -1);
      const a = song();
      const b = song();
      if (a.u > b.u) updatePair(w, a.x, b.x);
      else updatePair(w, b.x, a.x);
    }
    expect(predict(w, { "t:rock": 1, bias: 1 }).p).toBeGreaterThan(0.75);
    expect(predict(w, { "t:house": 1, bias: 1 }).p).toBeLessThan(0.25);
    expect(w["t:rock"]![0]).toBeGreaterThan(w["t:pop"]![0]);
    expect(w["t:folk"]![0]).toBeGreaterThan(w["t:metal"]![0]);
  });

  it("difference vectors cancel shared features", () => {
    expect(difference({ a: 1, b: 2 }, { a: 1, c: 1 })).toEqual({ b: 2, c: -1 });
  });

  it("drift lets variance recover toward the prior", () => {
    const w: ModelWeights = { "t:rock": [1, 0.01] };
    drift(w, 30);
    expect(w["t:rock"]![1]).toBeGreaterThan(0.01);
    expect(w["t:rock"]![0]).toBe(1);
  });

  it("thompson samples are reproducible and centered on the mean", () => {
    const w: ModelWeights = { "t:x": [1, 0.25] };
    const draws = Array.from({ length: 400 }, (_, i) => sampler(w, rng(i))({ "t:x": 1 }));
    const mean = draws.reduce((s, v) => s + v, 0) / draws.length;
    expect(mean).toBeGreaterThan(0.9);
    expect(mean).toBeLessThan(1.1);
    expect(sampler(w, rng(1))({ "t:x": 1 })).toBe(sampler(w, rng(1))({ "t:x": 1 }));
  });
});

describe("pairwise ratings", () => {
  it("winner goes up, loser goes down, both get more certain", () => {
    const [a, b] = rate({ mu: 0, sigma: 1 }, { mu: 0, sigma: 1 });
    expect(a.mu).toBeGreaterThan(0);
    expect(b.mu).toBeLessThan(0);
    expect(a.sigma).toBeLessThan(1);
    expect(b.sigma).toBeLessThan(1);
  });

  it("an upset moves ratings more than an expected result", () => {
    const [upsetWinner] = rate({ mu: -1, sigma: 0.8 }, { mu: 1, sigma: 0.8 });
    const [expectedWinner] = rate({ mu: 1, sigma: 0.8 }, { mu: -1, sigma: 0.8 });
    expect(upsetWinner.mu - -1).toBeGreaterThan(expectedWinner.mu - 1);
  });

  it("expands a ranking into all implied pairs", () => {
    expect(rankingToPairs(["a", "b", "c"])).toEqual([
      ["a", "b"],
      ["a", "c"],
      ["b", "c"],
    ]);
    expect(rankingToPairs([1, 2, 3, 4, 5])).toHaveLength(10);
  });

  it("clamps the implicit prior", () => {
    expect(initialRating(10).mu).toBe(1);
    expect(initialRating(-10).mu).toBe(-1);
  });
});

describe("personalized pagerank", () => {
  const edges = [
    { from: "seedA", to: "x", weight: 1 },
    { from: "seedB", to: "x", weight: 1 },
    { from: "seedA", to: "y", weight: 1 },
    { from: "y", to: "far", weight: 1 },
    { from: "unrelated", to: "other", weight: 1 },
  ];

  it("prefers artists close to several seeds", () => {
    const ppr = personalizedPageRank(
      edges,
      new Map([
        ["seedA", 1],
        ["seedB", 1],
      ]),
    );
    expect(ppr.get("x")!).toBeGreaterThan(ppr.get("y")!);
    expect(ppr.get("y")!).toBeGreaterThan(ppr.get("far")!);
    expect(ppr.get("unrelated") ?? 0).toBe(0);
    const total = [...ppr.values()].reduce((s, v) => s + v, 0);
    expect(total).toBeCloseTo(1, 4);
  });

  it("rank-normalizes into (0, 1]", () => {
    const norm = rankNormalize(
      new Map([
        ["a", 0.5],
        ["b", 0.3],
        ["c", 0.2],
      ]),
    );
    expect(norm.a).toBe(1);
    expect(norm.c).toBeGreaterThan(0);
    expect(norm.c).toBeLessThan(norm.b!);
  });
});

const baseTrack = (over: Partial<LibraryTrack>): LibraryTrack => ({
  trackId: "t",
  artistId: "a",
  tags: {},
  releaseYear: null,
  rank: null,
  explicit: false,
  saved: false,
  playlistCount: 0,
  playCount: 0,
  skipCount: 0,
  msPlayed: 0,
  lastPlayedAt: null,
  topShort: null,
  topMedium: null,
  topLong: null,
  inExportLibrary: false,
  discovered: 0,
  banned: false,
  ratingMu: null,
  ...over,
});

describe("taste profile", () => {
  const now = Date.UTC(2026, 9, 1);

  it("weights listening with diminishing returns, saves and skips", () => {
    const recent = new Date(now - 86_400_000);
    const few = implicitWeight(baseTrack({ playCount: 5, lastPlayedAt: recent }), now);
    const many = implicitWeight(baseTrack({ playCount: 200, lastPlayedAt: recent }), now);
    expect(many).toBeGreaterThan(few);
    expect(many).toBeLessThan(few * 6);
    expect(implicitWeight(baseTrack({ playCount: 50, banned: true }), now)).toBe(0);
    const skipped = implicitWeight(
      baseTrack({ playCount: 10, skipCount: 30, lastPlayedAt: recent }),
      now,
    );
    const kept = implicitWeight(
      baseTrack({ playCount: 10, skipCount: 0, lastPlayedAt: recent }),
      now,
    );
    expect(skipped).toBeLessThan(kept);
    const loved = implicitWeight(
      baseTrack({ playCount: 10, lastPlayedAt: recent, ratingMu: 1.5 }),
      now,
    );
    expect(loved).toBeGreaterThan(kept);
  });

  it("emphasizes distinctive tags through IDF", () => {
    const tracks = [
      baseTrack({
        trackId: "1",
        artistId: "a1",
        saved: true,
        tags: { rock: 1, shoegaze: 0.8 },
        releaseYear: 1991,
      }),
      baseTrack({
        trackId: "2",
        artistId: "a2",
        saved: true,
        tags: { rock: 1, shoegaze: 0.8 },
        releaseYear: 1993,
      }),
    ];
    const df: Record<string, number> = { rock: 5000, shoegaze: 40 };
    const { profile } = buildProfile({
      tracks,
      artists: [],
      edges: [{ from: "a1", to: "a3", weight: 1 }],
      idf: (t) => Math.log(10001 / ((df[t] ?? 0) + 1)) + 1,
      now,
    });
    expect(profile.tags.shoegaze!).toBeGreaterThan(profile.tags.rock!);
    expect(profile.decades["1990"]).toBeGreaterThan(profile.decades["2000"] ?? 0);
    expect(profile.graph.a3).toBeGreaterThan(0);
    expect(profile.artists.a1).toBeGreaterThan(0);
  });
});

describe("features, ranking and explanations", () => {
  const profile: ProfileData = {
    tags: { shoegaze: 0.8, "dream pop": 0.6 },
    artists: { known: 1 },
    graph: { near: 0.9, known: 1 },
    decades: { "1990": 0.7, "2000": 0.3 },
    popularity: { mean: 5, std: 0.5 },
    stats: { tracks: 1, artists: 1, plays: 1, hours: 1, explicitShare: 0 },
  };

  it("builds a sparse vector with dense meta-features", () => {
    const x = trackFeatures(
      {
        trackId: "t1",
        artistId: "near",
        tags: { shoegaze: 1, noise: 0.5 },
        releaseYear: 1994,
        rank: 100000,
        explicit: false,
        bpm: 120,
        sources: [{ type: "similar-track", score: 0.8, seedLabel: "Only Shallow" }],
        knownArtist: false,
      },
      profile,
      () => 1,
    );
    expect(x["d:tagSim"]!).toBeGreaterThan(0);
    expect(x["d:graph"]).toBeCloseTo(0.5, 5);
    expect(x["a:near"]).toBe(1);
    expect(x["y:1990"]).toBe(1);
    expect(x["b:120"]).toBe(1);
    expect(x.bias).toBe(1);
    const reasons = explain({
      features: x,
      weights: {},
      sources: [{ type: "similar-track", score: 0.8, seedLabel: "Only Shallow" }],
      tags: { shoegaze: 1 },
      profile,
      releaseYear: 1994,
    });
    expect(reasons.some((r) => r.includes("shoegaze"))).toBe(true);
    expect(reasons.length).toBeLessThanOrEqual(3);
  });

  it("diversifies by artist", () => {
    const items: RankItem[] = [
      { id: "1", score: 10, artistId: "a", tags: { rock: 1 } },
      { id: "2", score: 9.9, artistId: "a", tags: { rock: 1 } },
      { id: "3", score: 9, artistId: "b", tags: { jazz: 1 } },
      { id: "4", score: 8, artistId: "c", tags: { rock: 1 } },
    ];
    const picked = diversify(items, 3);
    expect(picked.map((p) => p.artistId)).toEqual(["a", "b", "c"]);
  });

  it("asks about close, uncertain pairs first", () => {
    const close = pairInformation(
      { id: "a", mean: 0, variance: 1 },
      { id: "b", mean: 0.1, variance: 1 },
    );
    const far = pairInformation(
      { id: "a", mean: -3, variance: 1 },
      { id: "b", mean: 3, variance: 1 },
    );
    const certain = pairInformation(
      { id: "a", mean: 0, variance: 0.01 },
      { id: "b", mean: 0, variance: 0.01 },
    );
    expect(close).toBeGreaterThan(far);
    expect(close).toBeGreaterThan(certain);
  });

  it("picks a spread of uncertain songs to rank", () => {
    const options = Array.from({ length: 100 }, (_, i) => ({
      id: String(i),
      mean: i / 10,
      variance: 1,
    }));
    const set = pickRankSet(options, 5, rng(3));
    expect(new Set(set.map((s) => s.id)).size).toBe(5);
    const means = set.map((s) => s.mean).sort((a, b) => a - b);
    expect(means[4]! - means[0]!).toBeGreaterThan(3);
  });
});

describe("tag handling", () => {
  it("drops junk tags, years and the artist's own name", () => {
    const v = tagVectorFrom(
      [
        { name: "Shoegaze", count: 100 },
        { name: "seen live", count: 90 },
        { name: "90s", count: 80 },
        { name: "My Bloody Valentine", count: 50 },
        { name: "Dream Pop", count: 40 },
      ],
      { artistNameNorm: "my bloody valentine" },
    );
    expect(Object.keys(v)).toEqual(["shoegaze", "dream pop"]);
  });

  it("falls back to artist tags when a track has few tags", () => {
    const tags = effectiveTags({ rock: 1 }, { jazz: 1, fusion: 0.5 });
    expect(tags.jazz!).toBeGreaterThan(tags.rock!);
    expect(cosine({ a: 1 }, { a: 2 })).toBeCloseTo(1, 6);
  });
});
