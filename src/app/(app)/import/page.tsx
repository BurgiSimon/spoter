import { eq, sql } from "drizzle-orm";
import type { Metadata } from "next";
import { Suspense } from "react";
import { ImportPanel } from "@/components/import-panel";
import { PageHeader, PageSkeleton } from "@/components/ui";
import { requireUser } from "@/lib/auth/current";
import { db, schema } from "@/lib/db";
import { spotifyEnabled } from "@/lib/env";

export const metadata: Metadata = { title: "Import & sync" };

export default function ImportPage({ searchParams }: PageProps<"/import">) {
  return (
    <>
      <PageHeader
        title="Import & sync"
        subtitle="The more Spoter knows about what you already love, the better its first recommendations."
      />
      <Suspense fallback={<PageSkeleton />}>
        <Content searchParams={searchParams} />
      </Suspense>
    </>
  );
}

async function Content({ searchParams }: { searchParams: PageProps<"/import">["searchParams"] }) {
  const [user, params] = await Promise.all([requireUser(), searchParams]);
  const [account] = await db()
    .select({
      displayName: schema.spotifyAccounts.displayName,
      lastSyncAt: schema.spotifyAccounts.lastSyncAt,
    })
    .from(schema.spotifyAccounts)
    .where(eq(schema.spotifyAccounts.userId, user.id))
    .limit(1);
  const [counts] = (
    await db().execute<{ tracks: number; plays: number }>(sql`
      SELECT (SELECT count(*)::int FROM user_tracks WHERE user_id = ${user.id}::uuid) AS tracks,
             (SELECT count(*)::int FROM listening_events WHERE user_id = ${user.id}::uuid) AS plays
    `)
  ).rows;
  const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
  return (
    <ImportPanel
      spotifyEnabled={spotifyEnabled()}
      spotify={
        account
          ? {
              displayName: account.displayName,
              lastSyncAt: account.lastSyncAt?.toISOString() ?? null,
            }
          : null
      }
      library={{ tracks: counts?.tracks ?? 0, plays: counts?.plays ?? 0 }}
      error={first(params.error)}
      connected={first(params.connected) === "1"}
    />
  );
}
