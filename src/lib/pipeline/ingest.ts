import { gunzipSync } from "node:zlib";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { Catalog } from "../catalog";
import { db, schema } from "../db";
import { TRACK_SOURCE } from "../types";
import { mapLimit } from "../util";
import type { JobReporter } from "./jobs";
import {
  insertListeningEvents,
  recomputePlayStats,
  upsertUserTracks,
  type UserTrackPatch,
} from "./library";

export const MAX_EXPORT_TRACKS = 150_000;
export const MAX_EXPORT_PLAYS = 2_000_000;

export const exportPayloadSchema = z.object({
  tracks: z
    .array(
      z.object({
        id: z
          .string()
          .regex(/^[A-Za-z0-9]{22}$/)
          .optional(),
        title: z.string().min(1).max(300),
        artist: z.string().min(1).max(300),
        album: z.string().max(300).optional(),
      }),
    )
    .max(MAX_EXPORT_TRACKS),
  plays: z
    .array(
      z.tuple([
        z.number().int().nonnegative(),
        z.number().int(),
        z.number().int().nonnegative(),
        z.union([z.literal(0), z.literal(1)]),
      ]),
    )
    .max(MAX_EXPORT_PLAYS),
  library: z.array(z.number().int().nonnegative()).max(MAX_EXPORT_TRACKS),
  banned: z.array(z.number().int().nonnegative()).max(MAX_EXPORT_TRACKS),
  playlists: z
    .array(
      z.object({
        name: z.string().max(300),
        items: z.array(z.number().int().nonnegative()).max(20_000),
      }),
    )
    .max(2_000),
});
export type ExportPayload = z.infer<typeof exportPayloadSchema>;

/** Worker side of the data-export upload: resolve tracks, store plays, update library facts. */
export async function ingestExport(
  userId: string,
  jobId: string,
  report: JobReporter,
): Promise<void> {
  const [row] = await db()
    .select()
    .from(schema.importPayloads)
    .where(eq(schema.importPayloads.jobId, jobId))
    .limit(1);
  if (!row) throw new Error("Upload not found (it may have been processed already)");
  const payload = exportPayloadSchema.parse(JSON.parse(gunzipSync(row.data).toString("utf8")));

  // Resolve every referenced track; even songs you only ever skipped are a (negative) signal.
  const relevant = new Set<number>([...payload.library, ...payload.banned]);
  for (const p of payload.playlists) for (const i of p.items) relevant.add(i);
  for (const [idx] of payload.plays) relevant.add(idx);

  const catalog = new Catalog();
  const indices = [...relevant].filter((i) => i < payload.tracks.length);
  const ids = new Map<number, string>();
  let done = 0;
  await mapLimit(indices, 8, async (i) => {
    const t = payload.tracks[i]!;
    ids.set(
      i,
      await catalog.track({
        title: t.title,
        artist: { name: t.artist },
        spotifyId: t.id ?? null,
        albumName: t.album ?? null,
      }),
    );
    if (++done % 200 === 0) await report.progress("Matching your songs", done, indices.length);
  });
  report.count("tracks", ids.size);

  await report.progress("Importing listening history", 0, payload.plays.length, undefined, true);
  const events = [];
  for (const [idx, ts, ms, skipped] of payload.plays) {
    const trackId = ids.get(idx);
    if (trackId)
      events.push({ trackId, playedAt: new Date(ts * 1000), msPlayed: ms, skipped: skipped === 1 });
  }
  const inserted = await insertListeningEvents(userId, events);
  report.count("plays", inserted);
  await recomputePlayStats(userId, TRACK_SOURCE.HISTORY);

  const patches = new Map<string, UserTrackPatch>();
  const now = new Date();
  for (const idx of payload.library) {
    const id = ids.get(idx);
    if (id) patches.set(id, { trackId: id, sources: TRACK_SOURCE.EXPORT_LIBRARY, savedAt: now });
  }
  const playlistCounts = new Map<string, number>();
  for (const p of payload.playlists)
    for (const idx of new Set(p.items)) {
      const id = ids.get(idx);
      if (id) playlistCounts.set(id, (playlistCounts.get(id) ?? 0) + 1);
    }
  for (const [id, count] of playlistCounts) {
    const prev = patches.get(id);
    patches.set(id, {
      ...prev,
      trackId: id,
      sources: (prev?.sources ?? 0) | TRACK_SOURCE.PLAYLIST,
      playlistCount: count,
    });
  }
  for (const idx of payload.banned) {
    const id = ids.get(idx);
    if (id)
      patches.set(id, {
        ...patches.get(id),
        trackId: id,
        sources: patches.get(id)?.sources ?? 0,
        banned: true,
      });
  }
  await upsertUserTracks(userId, [...patches.values()]);
  report.count("librarySongs", payload.library.length);
  report.count("playlists", payload.playlists.length);

  await db().delete(schema.importPayloads).where(eq(schema.importPayloads.jobId, jobId));
}
