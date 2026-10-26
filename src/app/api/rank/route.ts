import { z } from "zod";
import { authed, body } from "@/lib/api";
import { recordRanking } from "@/lib/feedback";
import { nextRankSet, topRated } from "@/lib/serve";

export const GET = authed(async ({ req, user }) => {
  const exclude = (req.nextUrl.searchParams.get("exclude") ?? "")
    .split(",")
    .filter(Boolean)
    .slice(0, 50);
  const [set, top] = await Promise.all([nextRankSet(user.id, 5, exclude), topRated(user.id, 10)]);
  return { set, top };
});

const input = z.object({ ordered: z.array(z.uuid()).min(2).max(8) });

export const POST = authed(async ({ req, user }) => {
  const { ordered } = await body(req, input);
  if (new Set(ordered).size !== ordered.length)
    return Response.json({ error: "Duplicate songs" }, { status: 400 });
  await recordRanking(user.id, ordered);
  return { ok: true };
});
