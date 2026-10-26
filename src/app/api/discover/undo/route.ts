import { authed } from "@/lib/api";
import { undoLastSwipe } from "@/lib/feedback";

export const POST = authed(async ({ user }) => ({ trackId: await undoLastSwipe(user.id) }));
