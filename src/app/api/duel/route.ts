import { z } from "zod";
import { authed, body } from "@/lib/api";
import { recordDuel } from "@/lib/feedback";
import { nextDuel } from "@/lib/serve";

export const GET = authed(async ({ req, user }) => {
  const exclude = (req.nextUrl.searchParams.get("exclude") ?? "")
    .split(",")
    .filter(Boolean)
    .slice(0, 20);
  return { duel: await nextDuel(user.id, exclude) };
});

const input = z.object({
  a: z.uuid(),
  b: z.uuid(),
  outcome: z.enum(["a", "b", "both", "neither"]),
});

export const POST = authed(async ({ req, user }) => {
  const { a, b, outcome } = await body(req, input);
  await recordDuel(user.id, a, b, outcome);
  return { ok: true };
});
