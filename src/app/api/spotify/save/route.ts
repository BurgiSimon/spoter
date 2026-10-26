import { z } from "zod";
import { authed, body } from "@/lib/api";
import { saveToSpotifyLibrary } from "@/lib/spotify/playlist";

const input = z.object({ trackIds: z.array(z.uuid()).min(1).max(50) });

export const POST = authed(async ({ req, user }) => {
  const { trackIds } = await body(req, input);
  return { saved: await saveToSpotifyLibrary(user.id, trackIds) };
});
