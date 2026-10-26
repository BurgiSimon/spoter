import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";
import { emailSchema, findUserByEmail, passwordSchema, startSession } from "@/lib/auth/accounts";
import { hashPassword, verifyPassword } from "@/lib/auth/password";
import { rateLimit } from "@/lib/auth/rate-limit";
import { invalidateUserSessions } from "@/lib/auth/session";
import { ApiError, authed, body } from "@/lib/api";
import { db, schema } from "@/lib/db";

const input = z.object({
  email: emailSchema.optional(),
  currentPassword: z.string().max(200).optional(),
  newPassword: passwordSchema,
});

/** Set or change email + password (Spotify-only accounts use this to add a password login). */
export const PUT = authed(async ({ req, user }) => {
  if (!(await rateLimit(`password:${user.id}`, 10, 3600)))
    throw new ApiError(429, "Too many attempts");
  const data = await body(req, input);
  const [row] = await db().select().from(schema.users).where(eq(schema.users.id, user.id)).limit(1);
  if (!row) throw new ApiError(404, "Account not found");
  if (row.passwordHash) {
    if (!data.currentPassword || !(await verifyPassword(row.passwordHash, data.currentPassword)))
      throw new ApiError(401, "Your current password is wrong");
  }
  const email = data.email ?? row.email;
  if (!email) throw new ApiError(400, "Add an email address to sign in with");
  if (email !== row.email) {
    const taken = await findUserByEmail(email);
    if (taken && taken.id !== user.id)
      throw new ApiError(409, "That email is already used by another account");
  }
  await db()
    .update(schema.users)
    .set({ email, passwordHash: await hashPassword(data.newPassword) })
    .where(eq(schema.users.id, user.id));
  // Sign out every other device, keep this one signed in with a fresh session.
  await invalidateUserSessions(user.id);
  return startSession(NextResponse.json({ ok: true }), user.id, req.headers.get("user-agent"));
});
