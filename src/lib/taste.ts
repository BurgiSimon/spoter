import { and, eq, inArray, sql } from "drizzle-orm";
import { db, schema } from "./db";
import { loadModel } from "./model-store";
import { loadProfile } from "./pipeline/profile";
import { getSettings } from "./settings";
import { CANDIDATE_STATUS } from "./types";

export async function getTaste(userId: string) {
  const [profile, weights, settings] = await Promise.all([
    loadProfile(userId),
    loadModel(userId),
    getSettings(userId),
  ]);

  const tags = profile
    ? Object.entries(profile.tags)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 15)
    : [];
  const maxTag = tags[0]?.[1] ?? 1;

  const topArtistIds = profile
    ? Object.entries(profile.artists)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 12)
        .map(([id]) => id)
    : [];
  const artistRows = topArtistIds.length
    ? await db()
        .select({
          id: schema.artists.id,
          name: schema.artists.name,
          imageUrl: schema.artists.imageUrl,
        })
        .from(schema.artists)
        .where(inArray(schema.artists.id, topArtistIds))
    : [];
  const artistById = new Map(artistRows.map((a) => [a.id, a]));

  const learned = Object.entries(weights)
    .filter(([f, [mu]]) => f.startsWith("t:") && Math.abs(mu) > 0.05)
    .map(([f, [mu, s2]]) => ({ tag: f.slice(2), mean: mu, sd: Math.sqrt(s2) }));
  const leaningIn = [...learned]
    .sort((a, b) => b.mean - a.mean)
    .filter((l) => l.mean > 0)
    .slice(0, 8);
  const leaningOut = [...learned]
    .sort((a, b) => a.mean - b.mean)
    .filter((l) => l.mean < 0)
    .slice(0, 8);

  const counts = await db().execute<{ kind: string; n: number }>(sql`
    SELECT kind, count(*)::int AS n FROM feedback_events WHERE user_id = ${userId}::uuid GROUP BY kind
  `);
  const [likes] = (
    await db().execute<{ n: number }>(sql`
      SELECT count(*)::int AS n FROM candidates
      WHERE user_id = ${userId}::uuid AND status IN (${CANDIDATE_STATUS.LIKED}, ${CANDIDATE_STATUS.SUPERLIKED})
    `)
  ).rows;

  const blocked = await db()
    .select({ id: schema.artists.id, name: schema.artists.name })
    .from(schema.userArtists)
    .innerJoin(schema.artists, eq(schema.artists.id, schema.userArtists.artistId))
    .where(and(eq(schema.userArtists.userId, userId), eq(schema.userArtists.blocked, true)));

  const novelty = weights["d:novel"]?.[0] ?? 0;

  return {
    hasProfile: Boolean(profile),
    stats: profile?.stats ?? null,
    tags: tags.map(([tag, w]) => ({ tag, share: w / maxTag })),
    decades: profile
      ? Object.entries(profile.decades)
          .filter(([, v]) => v >= 0.005)
          .map(([decade, share]) => ({ decade: Number(decade), share }))
      : [],
    // Distinct names only: provider-side duplicates (two "Slowdive" ids) should not show twice.
    artists: topArtistIds
      .map((id) => artistById.get(id))
      .filter((a) => a !== undefined)
      .filter(
        (a, i, all) => all.findIndex((b) => b.name.toLowerCase() === a.name.toLowerCase()) === i,
      ),
    leaningIn,
    leaningOut,
    novelty,
    feedback: Object.fromEntries(counts.rows.map((r) => [r.kind, r.n])) as Record<string, number>,
    likes: likes?.n ?? 0,
    settings,
    blocked,
  };
}
export type Taste = Awaited<ReturnType<typeof getTaste>>;
