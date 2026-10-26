import { and, desc, eq, gt, inArray, isNotNull, lt, or, sql } from "drizzle-orm";
import { db, schema } from "./db";
import { pickPair, pickRankSet, shuffle, type Option } from "./engine/active";
import { explain } from "./engine/explain";
import { trackFeatures } from "./engine/features";
import { rng } from "./engine/gaussian";
import { predict } from "./engine/model";
import { initialRating } from "./engine/rating";
import { nextBatch, topRecommendations, type PoolItem, type Scored } from "./engine/recommend";
import { loadModel } from "./model-store";
import { loadIdf, loadTrackCards, publicCard, type TrackCard } from "./pipeline/facts";
import { loadProfile } from "./pipeline/profile";
import { getSettings } from "./settings";
import { CANDIDATE_STATUS, type FeatureVector, type ModelWeights, type ProfileData } from "./types";

const RESURFACE_AFTER_MS = 3 * 86_400_000;

function seed(): () => number {
  return rng((Date.now() ^ Math.floor(Math.random() * 2 ** 31)) >>> 0);
}

async function loadPool(
  userId: string,
  statuses: number[],
): Promise<{ pool: PoolItem[]; cards: Map<string, TrackCard> }> {
  const c = schema.candidates;
  const rows = await db()
    .select({
      trackId: c.trackId,
      features: c.features,
      sources: c.sources,
      status: c.status,
      shownAt: c.shownAt,
    })
    .from(c)
    .where(
      and(
        eq(c.userId, userId),
        or(
          inArray(
            c.status,
            statuses.filter((s) => s !== CANDIDATE_STATUS.SHOWN),
          ),
          statuses.includes(CANDIDATE_STATUS.SHOWN)
            ? and(
                eq(c.status, CANDIDATE_STATUS.SHOWN),
                lt(c.shownAt, new Date(Date.now() - RESURFACE_AFTER_MS)),
              )
            : sql`false`,
        ),
      ),
    );
  const cards = await loadTrackCards(rows.map((r) => r.trackId));
  const pool: PoolItem[] = [];
  for (const r of rows) {
    const card = cards.get(r.trackId);
    if (!card) continue;
    pool.push({
      trackId: r.trackId,
      artistId: card.artistId,
      tags: card.tags,
      features: r.features,
      sources: r.sources,
      rank: card.rank,
    });
  }
  return { pool, cards };
}

function toCard(s: Scored, card: TrackCard, weights: ModelWeights, profile: ProfileData | null) {
  return {
    ...publicCard(card),
    match: Math.round(s.p * 100),
    confidence: Math.round(100 / (1 + Math.sqrt(s.variance))),
    reasons: profile
      ? explain({
          features: s.features,
          weights,
          sources: s.sources,
          tags: card.tags,
          profile,
          releaseYear: card.releaseYear,
        })
      : [],
  };
}
export type DiscoverCard = ReturnType<typeof toCard>;

export async function discoverBatch(userId: string, size: number) {
  const [weights, settings, profile, { pool, cards }] = await Promise.all([
    loadModel(userId),
    getSettings(userId),
    loadProfile(userId),
    loadPool(userId, [CANDIDATE_STATUS.NEW, CANDIDATE_STATUS.SHOWN]),
  ]);
  const recent = await db()
    .select({ artistId: schema.tracks.artistId })
    .from(schema.candidates)
    .innerJoin(schema.tracks, eq(schema.tracks.id, schema.candidates.trackId))
    .where(and(eq(schema.candidates.userId, userId), isNotNull(schema.candidates.shownAt)))
    .orderBy(desc(schema.candidates.shownAt))
    .limit(25);
  const batch = nextBatch(pool, weights, settings, {
    size,
    random: seed(),
    recentArtists: new Set(recent.map((r) => r.artistId)),
  });
  if (batch.length) {
    await db()
      .update(schema.candidates)
      .set({ status: CANDIDATE_STATUS.SHOWN, shownAt: new Date() })
      .where(
        and(
          eq(schema.candidates.userId, userId),
          inArray(
            schema.candidates.trackId,
            batch.map((b) => b.trackId),
          ),
        ),
      );
  }
  return {
    cards: batch.map((b) => toCard(b, cards.get(b.trackId)!, weights, profile)),
    poolSize: pool.length,
  };
}

export async function recommendations(userId: string, size: number) {
  const [weights, settings, profile, { pool, cards }] = await Promise.all([
    loadModel(userId),
    getSettings(userId),
    loadProfile(userId),
    loadPool(userId, [CANDIDATE_STATUS.NEW, CANDIDATE_STATUS.SHOWN]),
  ]);
  const top = topRecommendations(pool, weights, settings, { size, random: seed() });
  return top.map((s) => toCard(s, cards.get(s.trackId)!, weights, profile));
}

export async function likedSongs(userId: string, limit = 200) {
  const c = schema.candidates;
  const rows = await db()
    .select({ trackId: c.trackId, status: c.status, decidedAt: c.decidedAt })
    .from(c)
    .where(
      and(
        eq(c.userId, userId),
        inArray(c.status, [CANDIDATE_STATUS.LIKED, CANDIDATE_STATUS.SUPERLIKED]),
      ),
    )
    .orderBy(desc(c.decidedAt))
    .limit(limit);
  const cards = await loadTrackCards(rows.map((r) => r.trackId));
  return rows
    .filter((r) => cards.has(r.trackId))
    .map((r) => ({
      ...publicCard(cards.get(r.trackId)!),
      superliked: r.status === CANDIDATE_STATUS.SUPERLIKED,
      likedAt: r.decidedAt,
    }));
}

/** Library tracks as duel/rank options, with ratings (or their implicit prior). */
async function knownOptions(userId: string, limit: number) {
  const ut = schema.userTracks;
  const rows = await db()
    .select({
      trackId: ut.trackId,
      mu: ut.ratingMu,
      sigma: ut.ratingSigma,
      z: ut.affinityZ,
      comparisons: ut.comparisons,
    })
    .from(ut)
    .where(
      and(eq(ut.userId, userId), eq(ut.banned, false), isNotNull(ut.affinity), gt(ut.affinity, 0)),
    )
    .orderBy(desc(ut.affinity))
    .limit(limit);
  return rows.map((r) => {
    const prior = initialRating(r.z ?? 0);
    const mu = r.mu ?? prior.mu;
    const sigma = r.sigma ?? prior.sigma;
    return { id: r.trackId, mean: mu, variance: sigma * sigma, comparisons: r.comparisons };
  });
}

/** Features for library tracks, computed on the fly from the current profile. */
export async function libraryFeatures(
  ids: string[],
  profile: ProfileData,
): Promise<Map<string, FeatureVector>> {
  const [cards, idf] = await Promise.all([loadTrackCards(ids), loadIdf()]);
  const out = new Map<string, FeatureVector>();
  for (const [id, c] of cards) {
    out.set(
      id,
      trackFeatures(
        {
          trackId: id,
          artistId: c.artistId,
          tags: c.tags,
          releaseYear: c.releaseYear,
          rank: c.rank,
          explicit: c.explicit,
          bpm: c.bpm,
          sources: [],
          knownArtist: (profile.artists[c.artistId] ?? 0) > 0,
        },
        profile,
        idf,
      ),
    );
  }
  return out;
}

export type DuelMode = "known" | "mixed" | "new";

export async function nextDuel(userId: string, exclude: string[] = []) {
  const random = seed();
  const [weights, profile, known, { pool, cards }] = await Promise.all([
    loadModel(userId),
    loadProfile(userId),
    knownOptions(userId, 400),
    loadPool(userId, [CANDIDATE_STATUS.NEW, CANDIDATE_STATUS.SHOWN, CANDIDATE_STATUS.LIKED]),
  ]);
  if (!profile) return null;
  const ex = new Set(exclude);
  const fresh: Option[] = pool.map((p) => {
    const pred = predict(weights, p.features);
    return { id: p.trackId, mean: pred.mean, variance: pred.variance };
  });

  const modes: DuelMode[] = [];
  if (known.length >= 2) modes.push("known", "known");
  if (known.length >= 1 && fresh.length >= 1) modes.push("mixed", "mixed", "mixed");
  if (fresh.length >= 2) modes.push("new");
  if (!modes.length) return null;
  const mode = modes[Math.floor(random() * modes.length)]!;

  let pair: [Option, Option] | null = null;
  if (mode === "known") {
    pair = pickPair(known, known, random, { exclude: ex });
  } else {
    // Put library songs on the model's utility scale so both sides are comparable.
    const sample = shuffle(known, random).slice(0, 60);
    const feats = await libraryFeatures(
      sample.map((k) => k.id),
      profile,
    );
    const knownModel: Option[] = sample
      .filter((k) => feats.has(k.id))
      .map((k) => {
        const pred = predict(weights, feats.get(k.id)!);
        return { id: k.id, mean: pred.mean, variance: pred.variance };
      });
    pair =
      mode === "mixed"
        ? pickPair(fresh, knownModel, random, { exclude: ex })
        : pickPair(fresh, fresh, random, { exclude: ex });
  }
  if (!pair) return null;
  const allCards = new Map(cards);
  const missing = pair.map((p) => p.id).filter((id) => !allCards.has(id));
  if (missing.length) for (const [k, v] of await loadTrackCards(missing)) allCards.set(k, v);
  const [a, b] = random() < 0.5 ? pair : [pair[1], pair[0]];
  const knownIds = new Set(known.map((k) => k.id));
  return {
    mode,
    a: { ...publicCard(allCards.get(a.id)!), known: knownIds.has(a.id) },
    b: { ...publicCard(allCards.get(b.id)!), known: knownIds.has(b.id) },
  };
}

export async function nextRankSet(userId: string, n = 5, exclude: string[] = []) {
  const known = await knownOptions(userId, 600);
  if (known.length < n) return null;
  const set = pickRankSet(known, n, seed(), new Set(exclude));
  const cards = await loadTrackCards(set.map((s) => s.id));
  return set.filter((s) => cards.has(s.id)).map((s) => publicCard(cards.get(s.id)!));
}

export async function topRated(userId: string, limit = 50) {
  const ut = schema.userTracks;
  const rows = await db()
    .select({
      trackId: ut.trackId,
      mu: ut.ratingMu,
      sigma: ut.ratingSigma,
      comparisons: ut.comparisons,
    })
    .from(ut)
    .where(and(eq(ut.userId, userId), isNotNull(ut.ratingMu)))
    .orderBy(desc(sql`${ut.ratingMu} - 2 * ${ut.ratingSigma}`))
    .limit(limit);
  const cards = await loadTrackCards(rows.map((r) => r.trackId));
  return rows
    .filter((r) => cards.has(r.trackId))
    .map((r) => ({
      ...publicCard(cards.get(r.trackId)!),
      rating: r.mu!,
      sigma: r.sigma!,
      comparisons: r.comparisons,
    }));
}
