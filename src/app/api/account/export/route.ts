import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { authed } from "@/lib/api";
import { db, schema } from "@/lib/db";

/** GDPR-style export of everything Spoter stores about you (except the shared music catalog). */
export const GET = authed(async ({ user }) => {
  const id = user.id;
  const [account] = await db()
    .select({
      email: schema.users.email,
      displayName: schema.users.displayName,
      settings: schema.users.settings,
      createdAt: schema.users.createdAt,
    })
    .from(schema.users)
    .where(eq(schema.users.id, id));
  const library = await db()
    .select({
      title: schema.tracks.title,
      artist: schema.tracks.artistNames,
      spotifyId: schema.tracks.spotifyId,
      playCount: schema.userTracks.playCount,
      savedAt: schema.userTracks.savedAt,
      rating: schema.userTracks.ratingMu,
      comparisons: schema.userTracks.comparisons,
    })
    .from(schema.userTracks)
    .innerJoin(schema.tracks, eq(schema.tracks.id, schema.userTracks.trackId))
    .where(eq(schema.userTracks.userId, id));
  const feedback = await db()
    .select({
      kind: schema.feedbackEvents.kind,
      trackId: schema.feedbackEvents.trackId,
      other: schema.feedbackEvents.otherTrackId,
      value: schema.feedbackEvents.value,
      at: schema.feedbackEvents.createdAt,
    })
    .from(schema.feedbackEvents)
    .where(eq(schema.feedbackEvents.userId, id));
  const [model] = await db()
    .select()
    .from(schema.tasteModels)
    .where(eq(schema.tasteModels.userId, id));
  const [profile] = await db()
    .select()
    .from(schema.tasteProfiles)
    .where(eq(schema.tasteProfiles.userId, id));
  const data = {
    exportedAt: new Date().toISOString(),
    account,
    library,
    feedback,
    model: model?.weights ?? {},
    profile: profile?.data ?? null,
  };
  return new NextResponse(JSON.stringify(data, null, 2), {
    headers: {
      "Content-Type": "application/json",
      "Content-Disposition": `attachment; filename="spoter-export-${new Date().toISOString().slice(0, 10)}.json"`,
    },
  });
});
