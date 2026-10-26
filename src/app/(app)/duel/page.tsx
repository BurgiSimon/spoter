import type { Metadata } from "next";
import { Suspense } from "react";
import { DuelView } from "@/components/duel-view";
import { PageHeader, PageSkeleton } from "@/components/ui";
import { requireUser } from "@/lib/auth/current";

export const metadata: Metadata = { title: "Duel" };

export default function DuelPage() {
  return (
    <>
      <PageHeader
        title="This or that"
        subtitle="Which do you prefer? Spoter picks the pairs it is least sure about, so every answer counts."
      />
      <Suspense fallback={<PageSkeleton />}>
        <Duel />
      </Suspense>
    </>
  );
}

async function Duel() {
  await requireUser();
  return <DuelView />;
}
