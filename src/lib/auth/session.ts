import { and, eq, gt, lt } from "drizzle-orm";
import { db, schema } from "../db";
import { randomToken, sha256 } from "../crypto";

export const SESSION_COOKIE = "spoter_session";
export const SESSION_TTL_DAYS = 30;
const RENEW_WITHIN_DAYS = 15;
const DAY = 86_400_000;

export interface SessionUser {
  id: string;
  email: string | null;
  displayName: string;
  avatarUrl: string | null;
  hasPassword: boolean;
}

export function sessionCookieOptions(maxAgeSeconds = SESSION_TTL_DAYS * 86_400) {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: (process.env.APP_URL ?? "").startsWith("https://"),
    path: "/",
    maxAge: maxAgeSeconds,
  };
}

export async function createSession(userId: string, userAgent?: string | null): Promise<string> {
  const token = randomToken(32);
  await db()
    .insert(schema.sessions)
    .values({
      id: sha256(token),
      userId,
      expiresAt: new Date(Date.now() + SESSION_TTL_DAYS * DAY),
      userAgent: userAgent?.slice(0, 255) ?? null,
    });
  return token;
}

/** Validates a raw session token; slides the expiry when it is getting close. */
export async function validateSessionToken(token: string): Promise<SessionUser | null> {
  if (!token || token.length > 100) return null;
  const id = sha256(token);
  const [row] = await db()
    .select({
      expiresAt: schema.sessions.expiresAt,
      id: schema.users.id,
      email: schema.users.email,
      displayName: schema.users.displayName,
      avatarUrl: schema.users.avatarUrl,
      passwordHash: schema.users.passwordHash,
    })
    .from(schema.sessions)
    .innerJoin(schema.users, eq(schema.users.id, schema.sessions.userId))
    .where(and(eq(schema.sessions.id, id), gt(schema.sessions.expiresAt, new Date())))
    .limit(1);
  if (!row) return null;

  if (row.expiresAt.getTime() - Date.now() < RENEW_WITHIN_DAYS * DAY) {
    await db()
      .update(schema.sessions)
      .set({ expiresAt: new Date(Date.now() + SESSION_TTL_DAYS * DAY) })
      .where(eq(schema.sessions.id, id));
  }
  return {
    id: row.id,
    email: row.email,
    displayName: row.displayName,
    avatarUrl: row.avatarUrl,
    hasPassword: Boolean(row.passwordHash),
  };
}

export async function invalidateSession(token: string): Promise<void> {
  await db()
    .delete(schema.sessions)
    .where(eq(schema.sessions.id, sha256(token)));
}

export async function invalidateUserSessions(userId: string): Promise<void> {
  await db().delete(schema.sessions).where(eq(schema.sessions.userId, userId));
}

export async function pruneSessions(): Promise<void> {
  await db().delete(schema.sessions).where(lt(schema.sessions.expiresAt, new Date()));
}
