import { NextResponse } from "next/server";
import { open } from "@/lib/api";
import { invalidateSession, SESSION_COOKIE } from "@/lib/auth/session";

export const POST = open(async ({ req }) => {
  const token = req.cookies.get(SESSION_COOKIE)?.value;
  if (token) await invalidateSession(token);
  const res = NextResponse.json({ ok: true });
  res.cookies.delete(SESSION_COOKIE);
  return res;
});
