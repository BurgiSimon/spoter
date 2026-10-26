import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { authed, body } from "@/lib/api";
import { db, schema } from "@/lib/db";
import { CANDIDATE_STATUS } from "@/lib/types";

const input = z
  .object({ artistId: z.uuid().optional(), trackId: z.uuid().optional(), blocked: z.boolean() })
  .refine((v) => v.artistId || v.trackId, "artistId or trackId required");

/** Never recommend this artist again (or undo it). Accepts a track to block its artist. */
export const POST = authed(async ({ req, user }) => {
  const data = await body(req, input);
  let artistId = data.artistId;
  if (!artistId && data.trackId) {
    const [t] = await db()
      .select({ artistId: schema.tracks.artistId })
      .from(schema.tracks)
      .where(eq(schema.tracks.id, data.trackId))
      .limit(1);
    artistId = t?.artistId;
  }
  if (!artistId) return Response.json({ error: "Unknown artist" }, { status: 404 });
  await db()
    .insert(schema.userArtists)
    .values({ userId: user.id, artistId, blocked: data.blocked })
    .onConflictDoUpdate({
      target: [schema.userArtists.userId, schema.userArtists.artistId],
      set: { blocked: data.blocked },
    });
  if (data.blocked) {
    const trackIds = (
      await db()
        .select({ id: schema.tracks.id })
        .from(schema.tracks)
        .where(eq(schema.tracks.artistId, artistId))
    ).map((t) => t.id);
    if (trackIds.length) {
      await db()
        .update(schema.candidates)
        .set({ status: CANDIDATE_STATUS.DISMISSED })
        .where(
          and(
            eq(schema.candidates.userId, user.id),
            inArray(schema.candidates.trackId, trackIds),
            inArray(schema.candidates.status, [CANDIDATE_STATUS.NEW, CANDIDATE_STATUS.SHOWN]),
          ),
        );
    }
  }
  return { ok: true, artistId };
});
