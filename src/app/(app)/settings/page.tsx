import { eq } from "drizzle-orm";
import type { Metadata } from "next";
import { Suspense } from "react";
import { SettingsPanel } from "@/components/settings-panel";
import { PageHeader, PageSkeleton } from "@/components/ui";
import { requireUser } from "@/lib/auth/current";
import { db, schema } from "@/lib/db";

export const metadata: Metadata = { title: "Settings" };

export default function SettingsPage() {
  return (
    <>
      <PageHeader title="Settings" />
      <Suspense fallback={<PageSkeleton />}>
        <Content />
      </Suspense>
    </>
  );
}

async function Content() {
  const user = await requireUser();
  const [account] = await db()
    .select({
      displayName: schema.spotifyAccounts.displayName,
      spotifyUserId: schema.spotifyAccounts.spotifyUserId,
    })
    .from(schema.spotifyAccounts)
    .where(eq(schema.spotifyAccounts.userId, user.id))
    .limit(1);
  return (
    <SettingsPanel
      displayName={user.displayName}
      email={user.email}
      hasPassword={user.hasPassword}
      spotify={account ? (account.displayName ?? account.spotifyUserId) : null}
    />
  );
}
