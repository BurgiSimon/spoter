import { eq } from "drizzle-orm";
import type { Metadata } from "next";
import { Suspense } from "react";
import { LikesList } from "@/components/likes-list";
import { PageHeader, PageSkeleton } from "@/components/ui";
import { requireUser } from "@/lib/auth/current";
import { db, schema } from "@/lib/db";

export const metadata: Metadata = { title: "Likes" };

export default function LikesPage() {
  return (
    <>
      <PageHeader
        title="Your matches"
        subtitle="Everything you liked on Spoter. Send them to a Spotify playlist in one tap."
      />
      <Suspense fallback={<PageSkeleton />}>
        <Content />
      </Suspense>
    </>
  );
}

async function Content() {
  const user = await requireUser();
  const [account] = await db()
    .select({ id: schema.spotifyAccounts.userId })
    .from(schema.spotifyAccounts)
    .where(eq(schema.spotifyAccounts.userId, user.id))
    .limit(1);
  return <LikesList spotifyConnected={Boolean(account)} />;
}
