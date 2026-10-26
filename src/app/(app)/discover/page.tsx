import type { Metadata } from "next";
import { Suspense } from "react";
import { SwipeDeck } from "@/components/swipe-deck";
import { PageHeader, PageSkeleton } from "@/components/ui";
import { requireUser } from "@/lib/auth/current";

export const metadata: Metadata = { title: "Discover" };

export default function DiscoverPage() {
  return (
    <>
      <PageHeader
        compact
        title="Discover"
        subtitle="Swipe right on songs you like. Every swipe sharpens your recommendations."
      />
      <Suspense fallback={<PageSkeleton />}>
        <Discover />
      </Suspense>
    </>
  );
}

async function Discover() {
  await requireUser();
  return <SwipeDeck />;
}
