import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";
import { ApiError, authed, body } from "@/lib/api";
import { SESSION_COOKIE } from "@/lib/auth/session";
import { db, schema } from "@/lib/db";

const input = z.object({ confirm: z.literal("DELETE") });

/** Permanently deletes the account and every row that belongs to it (cascades). */
export const DELETE = authed(async ({ req, user }) => {
  const parsed = input.safeParse(await req.json().catch(() => null));
  if (!parsed.success)
    throw new ApiError(400, 'Send { "confirm": "DELETE" } to delete your account');
  await db().delete(schema.users).where(eq(schema.users.id, user.id));
  const res = NextResponse.json({ ok: true });
  res.cookies.delete(SESSION_COOKIE);
  return res;
});

const profileInput = z.object({ displayName: z.string().trim().min(1).max(60) });

export const PATCH = authed(async ({ req, user }) => {
  const { displayName } = await body(req, profileInput);
  await db().update(schema.users).set({ displayName }).where(eq(schema.users.id, user.id));
  return { ok: true };
});
