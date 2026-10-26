import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { authed, body } from "@/lib/api";
import { db, schema } from "@/lib/db";
import { likedSongs } from "@/lib/serve";
import { CANDIDATE_STATUS } from "@/lib/types";

export const GET = authed(async ({ user }) => ({ items: await likedSongs(user.id) }));

/** Remove a song from your likes (it will not be recommended again). */
const input = z.object({ trackId: z.uuid() });
export const DELETE = authed(async ({ req, user }) => {
  const { trackId } = await body(req, input);
  await db()
    .update(schema.candidates)
    .set({ status: CANDIDATE_STATUS.DISMISSED })
    .where(and(eq(schema.candidates.userId, user.id), eq(schema.candidates.trackId, trackId)));
  return { ok: true };
});
