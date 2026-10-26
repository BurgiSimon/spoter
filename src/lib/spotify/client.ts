import { eq } from "drizzle-orm";
import { decrypt, encrypt } from "../crypto";
import { db, schema } from "../db";
import { HttpError, RateLimiter, fetchJson } from "../providers/http";
import { appAccessToken, refreshToken } from "./oauth";
import type {
  CursorPaging,
  Paging,
  SpotifyArtist,
  SpotifyMe,
  SpotifyPlaylist,
  SpotifyTrack,
} from "./types";

const API = "https://api.spotify.com/v1";
// Spotify's limit is a rolling 30 s window per app; dev-mode apps should stay gentle.
const limiter = new RateLimiter(5, 10);

export class SpotifyNotConnectedError extends Error {
  constructor() {
    super("Spotify is not connected");
  }
}

/** Spotify Web API client bound to one user's tokens; refreshes and persists them as needed. */
export class SpotifyClient {
  private constructor(
    private readonly userId: string,
    private accessToken: string,
    private refresh: string,
    private expiresAt: Date,
    readonly spotifyUserId: string,
  ) {}

  static async forUser(userId: string): Promise<SpotifyClient> {
    const [row] = await db()
      .select()
      .from(schema.spotifyAccounts)
      .where(eq(schema.spotifyAccounts.userId, userId))
      .limit(1);
    if (!row) throw new SpotifyNotConnectedError();
    return new SpotifyClient(
      userId,
      decrypt(row.accessTokenEnc),
      decrypt(row.refreshTokenEnc),
      row.expiresAt,
      row.spotifyUserId,
    );
  }

  private async token(force = false): Promise<string> {
    if (!force && this.expiresAt.getTime() - Date.now() > 60_000) return this.accessToken;
    const res = await refreshToken(this.refresh);
    this.accessToken = res.access_token;
    if (res.refresh_token) this.refresh = res.refresh_token;
    this.expiresAt = new Date(Date.now() + res.expires_in * 1000);
    await db()
      .update(schema.spotifyAccounts)
      .set({
        accessTokenEnc: encrypt(this.accessToken),
        refreshTokenEnc: encrypt(this.refresh),
        expiresAt: this.expiresAt,
        scope: res.scope,
      })
      .where(eq(schema.spotifyAccounts.userId, this.userId));
    return this.accessToken;
  }

  async request<T>(pathOrUrl: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
    const url = pathOrUrl.startsWith("http") ? pathOrUrl : `${API}${pathOrUrl}`;
    const send = async (force: boolean) =>
      fetchJson<T>(url, {
        limiter,
        method: init.method,
        body: init.body === undefined ? undefined : JSON.stringify(init.body),
        headers: {
          Authorization: `Bearer ${await this.token(force)}`,
          ...(init.body === undefined ? {} : { "Content-Type": "application/json" }),
        },
      });
    try {
      return await send(false);
    } catch (err) {
      if (err instanceof HttpError && err.status === 401) return send(true);
      throw err;
    }
  }

  async *paginate<T>(path: string): AsyncGenerator<T[]> {
    let next: string | null = path;
    while (next) {
      const page: Paging<T> = await this.request<Paging<T>>(next);
      yield page.items;
      next = page.next;
    }
  }

  me(): Promise<SpotifyMe> {
    return this.request<SpotifyMe>("/me");
  }

  savedTracks(): AsyncGenerator<{ added_at: string; track: SpotifyTrack }[]> {
    return this.paginate("/me/tracks?limit=50");
  }

  playlists(): AsyncGenerator<SpotifyPlaylist[]> {
    return this.paginate("/me/playlists?limit=50");
  }

  /** Only works for playlists the user owns or collaborates on (Feb 2026 API change). */
  playlistItems(id: string): AsyncGenerator<{ added_at: string; item: SpotifyTrack | null }[]> {
    return this.paginate(`/playlists/${id}/items?limit=50`);
  }

  async top<T extends "tracks" | "artists">(
    type: T,
    range: "short_term" | "medium_term" | "long_term",
  ): Promise<(T extends "tracks" ? SpotifyTrack : SpotifyArtist)[]> {
    const page = await this.request<Paging<T extends "tracks" ? SpotifyTrack : SpotifyArtist>>(
      `/me/top/${type}?limit=50&time_range=${range}`,
    );
    return page.items;
  }

  async recentlyPlayed(): Promise<{ played_at: string; track: SpotifyTrack }[]> {
    const page = await this.request<CursorPaging<{ played_at: string; track: SpotifyTrack }>>(
      "/me/player/recently-played?limit=50",
    );
    return page.items;
  }

  async followedArtists(): Promise<SpotifyArtist[]> {
    const out: SpotifyArtist[] = [];
    let next: string | null = "/me/following?type=artist&limit=50";
    while (next) {
      const res: { artists: CursorPaging<SpotifyArtist> } = await this.request(next);
      out.push(...res.artists.items);
      next = res.artists.next;
    }
    return out;
  }

  createPlaylist(name: string, description: string): Promise<SpotifyPlaylist> {
    return this.request<SpotifyPlaylist>("/me/playlists", {
      method: "POST",
      body: { name, description, public: false },
    });
  }

  async addToPlaylist(playlistId: string, uris: string[]): Promise<void> {
    for (let i = 0; i < uris.length; i += 100) {
      await this.request(`/playlists/${playlistId}/items`, {
        method: "POST",
        body: { uris: uris.slice(i, i + 100) },
      });
    }
  }

  async saveToLibrary(uris: string[]): Promise<void> {
    for (let i = 0; i < uris.length; i += 40) {
      const chunk = uris.slice(i, i + 40).join(",");
      await this.request(`/me/library?uris=${encodeURIComponent(chunk)}`, { method: "PUT" });
    }
  }
}

/** Catalog search with the app token (dev mode caps `limit` at 10). */
export async function searchSpotifyTrack(query: string): Promise<SpotifyTrack[]> {
  const token = await appAccessToken();
  const res = await fetchJson<{ tracks: Paging<SpotifyTrack> }>(
    `${API}/search?type=track&limit=5&q=${encodeURIComponent(query)}`,
    { limiter, headers: { Authorization: `Bearer ${token}` } },
  );
  return res.tracks.items;
}
