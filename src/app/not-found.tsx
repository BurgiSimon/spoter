import Link from "next/link";
import { Logo } from "@/components/logo";

export default function NotFound() {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-4 px-5 text-center">
      <Logo />
      <h1 className="text-2xl font-bold">This page swiped left.</h1>
      <p className="text-muted text-sm">We couldn&apos;t find what you were looking for.</p>
      <Link
        href="/"
        className="focus-ring bg-brand rounded-full px-5 py-2.5 text-sm font-semibold text-black"
      >
        Back home
      </Link>
    </main>
  );
}
