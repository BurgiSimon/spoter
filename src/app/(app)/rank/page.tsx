import type { Metadata } from "next";
import { Suspense } from "react";
import { RankView } from "@/components/rank-view";
import { PageHeader, PageSkeleton } from "@/components/ui";
import { requireUser } from "@/lib/auth/current";

export const metadata: Metadata = { title: "Rank" };

export default function RankPage() {
  return (
    <>
      <PageHeader
        title="Rank your songs"
        subtitle="Put five songs from your library in order. Spoter learns which songs you truly love, not just the ones you play most."
      />
      <Suspense fallback={<PageSkeleton />}>
        <Rank />
      </Suspense>
    </>
  );
}

async function Rank() {
  await requireUser();
  return <RankView />;
}
