import { eq } from "drizzle-orm";
import { authed, body } from "@/lib/api";
import { db, schema } from "@/lib/db";
import { getSettings, settingsSchema } from "@/lib/settings";

export const GET = authed(async ({ user }) => ({ settings: await getSettings(user.id) }));

export const PUT = authed(async ({ req, user }) => {
  const settings = await body(req, settingsSchema.partial());
  const merged = { ...(await getSettings(user.id)), ...settings };
  await db().update(schema.users).set({ settings: merged }).where(eq(schema.users.id, user.id));
  return { settings: merged };
});
