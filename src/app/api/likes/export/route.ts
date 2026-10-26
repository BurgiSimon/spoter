import { ApiError, authed } from "@/lib/api";
import { rateLimit } from "@/lib/auth/rate-limit";
import { spotifyEnabled } from "@/lib/env";
import { exportLikes } from "@/lib/spotify/playlist";

export const POST = authed(async ({ user }) => {
  if (!spotifyEnabled()) throw new ApiError(400, "Spotify is not configured on this instance");
  if (!(await rateLimit(`export:${user.id}`, 6, 3600)))
    throw new ApiError(429, "Please wait a bit before exporting again");
  return { added: await exportLikes(user.id) };
});
