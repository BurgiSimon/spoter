import { authed } from "@/lib/api";
import { discoverBatch } from "@/lib/serve";

export const GET = authed(async ({ req, user }) => {
  const size = Math.min(20, Math.max(1, Number(req.nextUrl.searchParams.get("size")) || 10));
  return discoverBatch(user.id, size);
});
