import { and, eq, inArray, sql } from "drizzle-orm";
import { db, schema } from "./db";
import { logger } from "./logger";
import { update, updatePair } from "./engine/model";
import { initialRating, rankingToPairs, rate, type Rating } from "./engine/rating";
import { withModel } from "./model-store";
import { loadProfile } from "./pipeline/profile";
import { enqueueProfile } from "./queue";
import { libraryFeatures } from "./serve";
import { addToSpoterPlaylist } from "./spotify/playlist";
import { CANDIDATE_STATUS, type FeatureVector } from "./types";

export type SwipeAction = "like" | "dislike" | "superlike" | "skip";

const SWIPE: Record<SwipeAction, { y: 1 | -1; strength: number; status: number }> = {
  like: { y: 1, strength: 1, status: CANDIDATE_STATUS.LIKED },
  superlike: { y: 1, strength: 2.5, status: CANDIDATE_STATUS.SUPERLIKED },
  dislike: { y: -1, strength: 1, status: CANDIDATE_STATUS.DISLIKED },
  // Skips say "not now" more than "not me": a faint negative.
  skip: { y: -1, strength: 0.15, status: CANDIDATE_STATUS.SHOWN },
};

async function candidateFeatures(
  userId: string,
  ids: string[],
): Promise<Map<string, FeatureVector>> {
  if (!ids.length) return new Map();
  const rows = await db()
    .select({ trackId: schema.candidates.trackId, features: schema.candidates.features })
    .from(schema.candidates)
    .where(and(eq(schema.candidates.userId, userId), inArray(schema.candidates.trackId, ids)));
  return new Map(rows.map((r) => [r.trackId, r.features]));
}

/** Features for any mix of candidate and library tracks. */
async function featuresFor(userId: string, ids: string[]): Promise<Map<string, FeatureVector>> {
  const out = await candidateFeatures(userId, ids);
  const missing = ids.filter((id) => !out.has(id));
  if (missing.length) {
    const profile = await loadProfile(userId);
    if (profile) for (const [k, v] of await libraryFeatures(missing, profile)) out.set(k, v);
  }
  return out;
}

async function maybeRefreshProfile(userId: string): Promise<void> {
  const res = await db().execute<{ n: number }>(sql`
    SELECT count(*)::int AS n FROM feedback_events
    WHERE user_id = ${userId}::uuid AND created_at > now() - interval '1 hour'
  `);
  // Rebuild the profile every ~15 signals so likes start shaping candidate generation.
  if ((res.rows[0]?.n ?? 0) % 15 === 0) await enqueueProfile({ userId }).catch(() => undefined);
}

export async function recordSwipe(
  userId: string,
  trackId: string,
  action: SwipeAction,
): Promise<{ p: number }> {
  const rule = SWIPE[action];
  const features = (await candidateFeatures(userId, [trackId])).get(trackId);
  if (!features) throw new Error("Unknown candidate");
  const p = await withModel(userId, async (weights, tx) => {
    // Snapshot the touched beliefs so an undo can restore them exactly.
    const before = Object.fromEntries(Object.keys(features).map((f) => [f, weights[f] ?? null]));
    const prob = update(weights, features, rule.y, rule.strength);
    await tx
      .update(schema.candidates)
      .set({ status: rule.status, decidedAt: action === "skip" ? null : new Date() })
      .where(and(eq(schema.candidates.userId, userId), eq(schema.candidates.trackId, trackId)));
    await tx.insert(schema.feedbackEvents).values({
      userId,
      kind: "swipe",
      trackId,
      value: action === "superlike" ? 2 : rule.y,
      context: { action, before },
    });
    return prob;
  });
  if (action === "superlike") {
    addToSpoterPlaylist(userId, [trackId]).catch((err) =>
      logger.warn({ err }, "could not add to playlist"),
    );
  }
  await maybeRefreshProfile(userId);
  return { p };
}

export type DuelOutcome = "a" | "b" | "both" | "neither";

async function ratingsFor(userId: string, ids: string[]) {
  const ut = schema.userTracks;
  const rows = await db()
    .select({ trackId: ut.trackId, mu: ut.ratingMu, sigma: ut.ratingSigma, z: ut.affinityZ })
    .from(ut)
    .where(and(eq(ut.userId, userId), inArray(ut.trackId, ids)));
  return new Map(
    rows.map((r) => {
      const prior = initialRating(r.z ?? 0);
      return [r.trackId, { mu: r.mu ?? prior.mu, sigma: r.sigma ?? prior.sigma } satisfies Rating];
    }),
  );
}

async function saveRatings(
  userId: string,
  updates: Map<string, Rating>,
  comparisons: Map<string, number>,
) {
  for (const [trackId, r] of updates) {
    await db()
      .update(schema.userTracks)
      .set({
        ratingMu: r.mu,
        ratingSigma: r.sigma,
        comparisons: sql`${schema.userTracks.comparisons} + ${comparisons.get(trackId) ?? 1}`,
        updatedAt: new Date(),
      })
      .where(and(eq(schema.userTracks.userId, userId), eq(schema.userTracks.trackId, trackId)));
  }
}

/** Marks a new song the user preferred as liked (and remembers it as discovered). */
async function promoteCandidate(userId: string, trackId: string) {
  await db()
    .update(schema.candidates)
    .set({ status: CANDIDATE_STATUS.LIKED, decidedAt: new Date() })
    .where(
      and(
        eq(schema.candidates.userId, userId),
        eq(schema.candidates.trackId, trackId),
        inArray(schema.candidates.status, [CANDIDATE_STATUS.NEW, CANDIDATE_STATUS.SHOWN]),
      ),
    );
}

export async function recordDuel(
  userId: string,
  a: string,
  b: string,
  outcome: DuelOutcome,
): Promise<void> {
  const ratings = await ratingsFor(userId, [a, b]);
  const feats = await featuresFor(userId, [a, b]);
  const fa = feats.get(a);
  const fb = feats.get(b);
  if (!fa || !fb) throw new Error("Unknown track");
  const bothKnown = ratings.has(a) && ratings.has(b);

  await withModel(userId, async (weights, tx) => {
    if (outcome === "a" || outcome === "b") {
      const [w, l] = outcome === "a" ? [fa, fb] : [fb, fa];
      // Comparing two songs you already love says less about new music: weaker update.
      updatePair(weights, w, l, bothKnown ? 0.5 : 1);
    } else {
      const y = outcome === "both" ? 1 : -1;
      update(weights, fa, y, 0.6);
      update(weights, fb, y, 0.6);
    }
    await tx.insert(schema.feedbackEvents).values({
      userId,
      kind: "duel",
      trackId: a,
      otherTrackId: b,
      value: outcome === "a" ? 1 : outcome === "b" ? -1 : 0,
      context: { outcome, a: fa, b: fb },
    });
  });

  if (bothKnown && (outcome === "a" || outcome === "b")) {
    const [winner, loser] = outcome === "a" ? [a, b] : [b, a];
    const [rw, rl] = rate(ratings.get(winner)!, ratings.get(loser)!);
    await saveRatings(
      userId,
      new Map([
        [winner, rw],
        [loser, rl],
      ]),
      new Map(),
    );
  }
  for (const [id, won] of [
    [a, outcome === "a" || outcome === "both"],
    [b, outcome === "b" || outcome === "both"],
  ] as const) {
    if (won && !ratings.has(id)) await promoteCandidate(userId, id);
  }
  await maybeRefreshProfile(userId);
}

/** A full ordering of library songs, best first. */
export async function recordRanking(userId: string, ordered: string[]): Promise<void> {
  const ratings = await ratingsFor(userId, ordered);
  if (ratings.size !== ordered.length)
    throw new Error("Only songs from your library can be ranked");
  const feats = await featuresFor(userId, ordered);
  const pairs = rankingToPairs(ordered);
  // n songs give n(n-1)/2 pairs that are not independent; scale each one down.
  const strength = 1 / Math.max(1, ordered.length - 1);

  const current = new Map(ratings);
  for (const [w, l] of pairs) {
    const [rw, rl] = rate(current.get(w)!, current.get(l)!, strength * 1.5);
    current.set(w, rw);
    current.set(l, rl);
  }
  await withModel(userId, async (weights, tx) => {
    for (const [w, l] of pairs) {
      const fw = feats.get(w);
      const fl = feats.get(l);
      if (fw && fl) updatePair(weights, fw, fl, strength * 0.6);
    }
    await tx.insert(schema.feedbackEvents).values({
      userId,
      kind: "rank",
      trackId: ordered[0]!,
      value: ordered.length,
      context: { ordered },
    });
  });
  await saveRatings(userId, current, new Map(ordered.map((id) => [id, ordered.length - 1])));
  await maybeRefreshProfile(userId);
}

/** Undo the most recent swipe: restores the candidate and the model beliefs it touched. */
export async function undoLastSwipe(userId: string): Promise<string | null> {
  const [last] = await db()
    .select({
      id: schema.feedbackEvents.id,
      trackId: schema.feedbackEvents.trackId,
      context: schema.feedbackEvents.context,
    })
    .from(schema.feedbackEvents)
    .where(and(eq(schema.feedbackEvents.userId, userId), eq(schema.feedbackEvents.kind, "swipe")))
    .orderBy(sql`${schema.feedbackEvents.id} DESC`)
    .limit(1);
  if (!last) return null;
  const before = (last.context?.before ?? {}) as Record<string, [number, number] | null>;
  await withModel(userId, async (weights, tx) => {
    for (const [f, belief] of Object.entries(before)) {
      if (belief) weights[f] = belief;
      else delete weights[f];
    }
    await tx
      .update(schema.candidates)
      .set({ status: CANDIDATE_STATUS.SHOWN, decidedAt: null })
      .where(
        and(eq(schema.candidates.userId, userId), eq(schema.candidates.trackId, last.trackId)),
      );
    await tx.delete(schema.feedbackEvents).where(eq(schema.feedbackEvents.id, last.id));
  });
  return last.trackId;
}
