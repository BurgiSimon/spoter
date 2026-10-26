import { eq } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "./db";
import { DEFAULT_SETTINGS, type UserSettings } from "./types";

export const settingsSchema = z.object({
  adventurousness: z.number().min(0).max(1),
  popularity: z.number().min(-1).max(1),
  allowExplicit: z.boolean(),
  includeKnownArtists: z.boolean(),
  blockedTags: z.array(z.string().min(1).max(40)).max(100),
});

export function resolveSettings(stored: Partial<UserSettings> | null | undefined): UserSettings {
  const merged = { ...DEFAULT_SETTINGS, ...(stored ?? {}) };
  const parsed = settingsSchema.safeParse(merged);
  return parsed.success ? parsed.data : DEFAULT_SETTINGS;
}

export async function getSettings(userId: string): Promise<UserSettings> {
  const [row] = await db()
    .select({ settings: schema.users.settings })
    .from(schema.users)
    .where(eq(schema.users.id, userId))
    .limit(1);
  return resolveSettings(row?.settings);
}
