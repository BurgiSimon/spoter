import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";
import { authed } from "@/lib/api";
import { db, schema } from "@/lib/db";
import { deezerTrackFresh } from "@/lib/providers/deezer";

// Deezer preview URLs are signed and expire, so we resolve a fresh one per play.
const memo = new Map<number, { url: string; until: number }>();

export const GET = authed<{ trackId: string }>(async ({ params }) => {
  const trackId = z.uuid().parse(params.trackId);
  const [row] = await db()
    .select({ deezerId: schema.tracks.deezerId })
    .from(schema.tracks)
    .where(eq(schema.tracks.id, trackId))
    .limit(1);
  if (!row?.deezerId) return NextResponse.json({ error: "No preview" }, { status: 404 });

  let hit = memo.get(row.deezerId);
  if (!hit || hit.until < Date.now()) {
    const track = await deezerTrackFresh(row.deezerId);
    if (!track?.preview) {
      await db()
        .update(schema.tracks)
        .set({ previewable: false })
        .where(eq(schema.tracks.id, trackId));
      return NextResponse.json({ error: "No preview" }, { status: 404 });
    }
    const exp = Number(/exp=(\d+)/.exec(track.preview)?.[1]) * 1000;
    hit = {
      url: track.preview,
      until: (Number.isFinite(exp) && exp > 0 ? exp : Date.now() + 600_000) - 60_000,
    };
    memo.set(row.deezerId, hit);
    if (memo.size > 5000) memo.delete(memo.keys().next().value!);
  }
  return NextResponse.redirect(hit.url, {
    status: 302,
    headers: { "Cache-Control": "private, max-age=60" },
  });
});
