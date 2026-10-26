import { eq, sql } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";
import { db, schema } from "../db";
import { createSession, SESSION_COOKIE, sessionCookieOptions } from "./session";

export const emailSchema = z
  .email()
  .max(254)
  .transform((e) => e.trim().toLowerCase());
export const passwordSchema = z
  .string()
  .min(10, "Use at least 10 characters")
  .max(200, "That password is too long");

export async function findUserByEmail(email: string) {
  const [row] = await db()
    .select()
    .from(schema.users)
    .where(sql`lower(${schema.users.email}) = ${email.toLowerCase()}`)
    .limit(1);
  return row;
}

export async function startSession(
  res: NextResponse,
  userId: string,
  userAgent: string | null,
): Promise<NextResponse> {
  const token = await createSession(userId, userAgent);
  res.cookies.set(SESSION_COOKIE, token, sessionCookieOptions());
  await db()
    .update(schema.users)
    .set({ lastActiveAt: new Date() })
    .where(eq(schema.users.id, userId));
  return res;
}
