import type { Metadata } from "next";
import { Suspense } from "react";
import { AuthPage } from "@/components/auth-page";
import { Skeleton } from "@/components/ui";

export const metadata: Metadata = { title: "Sign in" };

export default function LoginPage({ searchParams }: PageProps<"/login">) {
  return (
    <Suspense fallback={<Skeleton className="h-96 w-full max-w-sm" />}>
      <AuthPage mode="login" searchParams={searchParams} />
    </Suspense>
  );
}
