import { z } from "zod";
import { authed, body } from "@/lib/api";
import { recordSwipe } from "@/lib/feedback";

const input = z.object({
  trackId: z.uuid(),
  action: z.enum(["like", "dislike", "superlike", "skip"]),
});

export const POST = authed(async ({ req, user }) => {
  const { trackId, action } = await body(req, input);
  return recordSwipe(user.id, trackId, action);
});
