import { connection, NextResponse, type NextRequest } from "next/server";
import { sessionUser } from "@/lib/api";
import { randomToken, sign } from "@/lib/crypto";
import { env, spotifyEnabled } from "@/lib/env";
import { authorizeUrl, createPkcePair, OAUTH_COOKIE } from "@/lib/spotify/oauth";

export async function GET(req: NextRequest) {
  await connection();
  const appUrl = env().APP_URL;
  if (!spotifyEnabled())
    return NextResponse.redirect(new URL("/login?error=spotify_disabled", appUrl));
  const user = await sessionUser(req);
  const state = randomToken(24);
  const { verifier, challenge } = createPkcePair();
  const payload = JSON.stringify({ state, verifier, link: user?.id ?? null, at: Date.now() });
  const res = NextResponse.redirect(authorizeUrl(state, challenge));
  res.cookies.set(OAUTH_COOKIE, sign(Buffer.from(payload).toString("base64url")), {
    httpOnly: true,
    sameSite: "lax",
    secure: appUrl.startsWith("https://"),
    path: "/api/auth/spotify",
    maxAge: 600,
  });
  return res;
}
