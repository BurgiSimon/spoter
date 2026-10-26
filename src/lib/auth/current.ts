import "server-only";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { cache } from "react";
import { SESSION_COOKIE, validateSessionToken, type SessionUser } from "./session";

/** Data Access Layer entry point: the signed-in user for this request, or null. */
export const getCurrentUser = cache(async (): Promise<SessionUser | null> => {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  // Session checks compare against the current time and hit the database: request time only.
  await connection();
  if (!token) return null;
  return validateSessionToken(token);
});

export async function requireUser(): Promise<SessionUser> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  return user;
}
