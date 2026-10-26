import { eq } from "drizzle-orm";
import { ApiError, authed } from "@/lib/api";
import { db, schema } from "@/lib/db";

export const POST = authed(async ({ user }) => {
  if (!user.hasPassword) {
    throw new ApiError(
      400,
      "Set an email and password first, otherwise you could not sign in again",
    );
  }
  await db().delete(schema.spotifyAccounts).where(eq(schema.spotifyAccounts.userId, user.id));
  return { ok: true };
});
