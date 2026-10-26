import type { Metadata } from "next";
import { Suspense } from "react";
import { ForYou } from "@/components/for-you";
import { PageHeader, PageSkeleton } from "@/components/ui";
import { requireUser } from "@/lib/auth/current";

export const metadata: Metadata = { title: "For you" };

export default function ForYouPage() {
  return (
    <>
      <PageHeader
        title="For you"
        subtitle="Your best matches right now, each with the reasons behind it."
      />
      <Suspense fallback={<PageSkeleton />}>
        <Content />
      </Suspense>
    </>
  );
}

async function Content() {
  await requireUser();
  return <ForYou />;
}
