import { eq } from "drizzle-orm";
import { connection, NextResponse, type NextRequest } from "next/server";
import { startSession } from "@/lib/auth/accounts";
import { sessionUser } from "@/lib/api";
import { encrypt, unsign } from "@/lib/crypto";
import { db, schema } from "@/lib/db";
import { env } from "@/lib/env";
import { logger } from "@/lib/logger";
import { createJob } from "@/lib/pipeline/jobs";
import { HttpError, fetchJson } from "@/lib/providers/http";
import { enqueuePipeline } from "@/lib/queue";
import { exchangeCode, OAUTH_COOKIE } from "@/lib/spotify/oauth";
import type { SpotifyMe } from "@/lib/spotify/types";

function fail(code: string, linking: boolean) {
  const target = linking ? `/import?error=${code}` : `/login?error=${code}`;
  const res = NextResponse.redirect(new URL(target, env().APP_URL));
  res.cookies.delete({ name: OAUTH_COOKIE, path: "/api/auth/spotify" });
  return res;
}

export async function GET(req: NextRequest) {
  await connection();
  const raw = req.cookies.get(OAUTH_COOKIE)?.value;
  const unsigned = raw ? unsign(raw) : null;
  if (!unsigned) return fail("oauth_state", false);
  const saved = JSON.parse(Buffer.from(unsigned, "base64url").toString()) as {
    state: string;
    verifier: string;
    link: string | null;
    at: number;
  };
  const linking = Boolean(saved.link);
  const params = req.nextUrl.searchParams;
  if (params.get("error")) return fail("spotify_denied", linking);
  if (params.get("state") !== saved.state || Date.now() - saved.at > 600_000)
    return fail("oauth_state", linking);
  const code = params.get("code");
  if (!code) return fail("oauth_state", linking);

  try {
    const tokens = await exchangeCode(code, saved.verifier);
    if (!tokens.refresh_token) return fail("spotify_token", linking);
    let me: SpotifyMe;
    try {
      me = await fetchJson<SpotifyMe>("https://api.spotify.com/v1/me", {
        headers: { Authorization: `Bearer ${tokens.access_token}` },
        retries: 1,
      });
    } catch (err) {
      // Development Mode apps reject users who are not allow-listed in the dashboard.
      if (err instanceof HttpError && err.status === 403)
        return fail("spotify_not_allowlisted", linking);
      throw err;
    }

    const current = await sessionUser(req);
    if (linking && current?.id !== saved.link) return fail("oauth_state", linking);
    const [existing] = await db()
      .select({ userId: schema.spotifyAccounts.userId })
      .from(schema.spotifyAccounts)
      .where(eq(schema.spotifyAccounts.spotifyUserId, me.id))
      .limit(1);

    let userId: string;
    if (current && linking) {
      if (existing && existing.userId !== current.id) return fail("spotify_in_use", true);
      userId = current.id;
    } else if (existing) {
      userId = existing.userId;
    } else {
      const [created] = await db()
        .insert(schema.users)
        .values({
          displayName: me.display_name || "Music lover",
          avatarUrl: me.images?.[0]?.url ?? null,
        })
        .returning({ id: schema.users.id });
      userId = created!.id;
    }

    const account = {
      spotifyUserId: me.id,
      displayName: me.display_name,
      accessTokenEnc: encrypt(tokens.access_token),
      refreshTokenEnc: encrypt(tokens.refresh_token),
      expiresAt: new Date(Date.now() + tokens.expires_in * 1000),
      scope: tokens.scope,
    };
    await db()
      .insert(schema.spotifyAccounts)
      .values({ userId, ...account })
      .onConflictDoUpdate({ target: schema.spotifyAccounts.userId, set: account });

    const jobId = await createJob(userId, "pipeline");
    await enqueuePipeline({ userId, jobId, sync: true });

    const res = NextResponse.redirect(
      new URL(linking ? "/import?connected=1" : "/discover", env().APP_URL),
    );
    res.cookies.delete({ name: OAUTH_COOKIE, path: "/api/auth/spotify" });
    if (!current || current.id !== userId)
      await startSession(res, userId, req.headers.get("user-agent"));
    return res;
  } catch (err) {
    logger.error({ err }, "spotify oauth callback failed");
    return fail("spotify_error", linking);
  }
}
