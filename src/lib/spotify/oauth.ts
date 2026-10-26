import { createHash } from "node:crypto";
import { env } from "../env";
import { fetchJson } from "../providers/http";
import { randomToken } from "../crypto";

export const OAUTH_COOKIE = "spoter_oauth";

export const SPOTIFY_SCOPES = [
  "user-library-read",
  "user-library-modify",
  "user-top-read",
  "user-read-recently-played",
  "user-follow-read",
  "playlist-read-private",
  "playlist-read-collaborative",
  "playlist-modify-private",
  "playlist-modify-public",
];

export interface TokenResponse {
  access_token: string;
  token_type: string;
  scope: string;
  expires_in: number;
  refresh_token?: string;
}

export function redirectUri(): string {
  return new URL("/api/auth/spotify/callback", env().APP_URL).toString();
}

export function createPkcePair(): { verifier: string; challenge: string } {
  const verifier = randomToken(48);
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  return { verifier, challenge };
}

export function authorizeUrl(state: string, challenge: string): string {
  const e = env();
  const params = new URLSearchParams({
    client_id: e.SPOTIFY_CLIENT_ID ?? "",
    response_type: "code",
    redirect_uri: redirectUri(),
    scope: SPOTIFY_SCOPES.join(" "),
    state,
    code_challenge_method: "S256",
    code_challenge: challenge,
  });
  return `https://accounts.spotify.com/authorize?${params}`;
}

function basicAuth(): string {
  const e = env();
  return Buffer.from(`${e.SPOTIFY_CLIENT_ID}:${e.SPOTIFY_CLIENT_SECRET}`).toString("base64");
}

function tokenRequest(body: Record<string, string>): Promise<TokenResponse> {
  return fetchJson<TokenResponse>("https://accounts.spotify.com/api/token", {
    method: "POST",
    headers: {
      Authorization: `Basic ${basicAuth()}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams(body).toString(),
    retries: 2,
  });
}

export function exchangeCode(code: string, verifier: string): Promise<TokenResponse> {
  return tokenRequest({
    grant_type: "authorization_code",
    code,
    redirect_uri: redirectUri(),
    code_verifier: verifier,
  });
}

export function refreshToken(refresh: string): Promise<TokenResponse> {
  return tokenRequest({ grant_type: "refresh_token", refresh_token: refresh });
}

let appToken: { token: string; expiresAt: number } | undefined;

/** Client-credentials token for catalog lookups that are not tied to a user. */
export async function appAccessToken(): Promise<string> {
  if (appToken && appToken.expiresAt > Date.now() + 60_000) return appToken.token;
  const res = await tokenRequest({ grant_type: "client_credentials" });
  appToken = { token: res.access_token, expiresAt: Date.now() + res.expires_in * 1000 };
  return res.access_token;
}
