import { authed } from "@/lib/api";
import { recommendations } from "@/lib/serve";

export const GET = authed(async ({ req, user }) => {
  const size = Math.min(60, Math.max(5, Number(req.nextUrl.searchParams.get("size")) || 30));
  return { items: await recommendations(user.id, size) };
});
