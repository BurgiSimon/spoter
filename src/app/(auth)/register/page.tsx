import type { Metadata } from "next";
import { Suspense } from "react";
import { AuthPage } from "@/components/auth-page";
import { Skeleton } from "@/components/ui";

export const metadata: Metadata = { title: "Create account" };

export default function RegisterPage({ searchParams }: PageProps<"/register">) {
  return (
    <Suspense fallback={<Skeleton className="h-96 w-full max-w-sm" />}>
      <AuthPage mode="register" searchParams={searchParams} />
    </Suspense>
  );
}
