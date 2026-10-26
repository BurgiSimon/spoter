import { sql } from "drizzle-orm";
import { db } from "../db";
import { chunk } from "../util";

export interface UserTrackPatch {
  trackId: string;
  sources: number;
  savedAt?: Date | null;
  playlistCount?: number;
  topShort?: number | null;
  topMedium?: number | null;
  topLong?: number | null;
  banned?: boolean;
}

/** Bulk upsert of library facts. Unspecified fields keep their current value. */
export async function upsertUserTracks(userId: string, patches: UserTrackPatch[]): Promise<void> {
  for (const part of chunk(patches, 500)) {
    const values = sql.join(
      part.map(
        (p) =>
          sql`(${userId}::uuid, ${p.trackId}::uuid, ${p.sources}::int, ${p.savedAt ?? null}::timestamptz,
               ${p.playlistCount ?? null}::smallint, ${p.topShort ?? null}::smallint, ${p.topMedium ?? null}::smallint,
               ${p.topLong ?? null}::smallint, ${p.banned ?? null}::boolean)`,
      ),
      sql`, `,
    );
    await db().execute(sql`
      INSERT INTO user_tracks (user_id, track_id, sources, saved_at, playlist_count, top_short, top_medium, top_long, banned)
      SELECT v.user_id, v.track_id, v.sources, v.saved_at, coalesce(v.playlist_count, 0), v.top_short, v.top_medium, v.top_long, coalesce(v.banned, false)
      FROM (VALUES ${values}) AS v(user_id, track_id, sources, saved_at, playlist_count, top_short, top_medium, top_long, banned)
      ON CONFLICT (user_id, track_id) DO UPDATE SET
        sources = user_tracks.sources | excluded.sources,
        saved_at = CASE WHEN excluded.saved_at IS NOT NULL THEN coalesce(user_tracks.saved_at, excluded.saved_at) ELSE user_tracks.saved_at END,
        playlist_count = CASE WHEN excluded.playlist_count > 0 THEN excluded.playlist_count ELSE user_tracks.playlist_count END,
        top_short = coalesce(excluded.top_short, user_tracks.top_short),
        top_medium = coalesce(excluded.top_medium, user_tracks.top_medium),
        top_long = coalesce(excluded.top_long, user_tracks.top_long),
        banned = user_tracks.banned OR excluded.banned,
        updated_at = now()
    `);
  }
}

/** Inserts listening events (idempotent) and recomputes per-track play statistics. */
export async function insertListeningEvents(
  userId: string,
  events: { trackId: string; playedAt: Date; msPlayed: number; skipped: boolean }[],
): Promise<number> {
  let inserted = 0;
  for (const part of chunk(events, 1000)) {
    const values = sql.join(
      part.map(
        (e) =>
          sql`(${userId}::uuid, ${e.trackId}::uuid, ${e.playedAt}::timestamptz, ${e.msPlayed}::int, ${e.skipped}::boolean)`,
      ),
      sql`, `,
    );
    const res = await db().execute(sql`
      INSERT INTO listening_events (user_id, track_id, played_at, ms_played, skipped)
      VALUES ${values}
      ON CONFLICT (user_id, track_id, played_at) DO NOTHING
    `);
    inserted += res.rowCount ?? 0;
  }
  return inserted;
}

export async function recomputePlayStats(userId: string, historySourceBit: number): Promise<void> {
  await db().execute(sql`
    INSERT INTO user_tracks (user_id, track_id, sources, play_count, ms_played, skip_count, first_played_at, last_played_at)
    SELECT user_id, track_id, ${historySourceBit}::int,
           count(*) FILTER (WHERE NOT skipped AND ms_played >= 30000),
           sum(ms_played),
           count(*) FILTER (WHERE skipped OR ms_played < 30000),
           min(played_at), max(played_at)
    FROM listening_events WHERE user_id = ${userId}::uuid
    GROUP BY user_id, track_id
    ON CONFLICT (user_id, track_id) DO UPDATE SET
      sources = user_tracks.sources | excluded.sources,
      play_count = excluded.play_count,
      ms_played = excluded.ms_played,
      skip_count = excluded.skip_count,
      first_played_at = excluded.first_played_at,
      last_played_at = excluded.last_played_at,
      updated_at = now()
  `);
}
