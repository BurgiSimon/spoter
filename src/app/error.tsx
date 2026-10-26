"use client";

export default function GlobalError({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <main className="flex min-h-[60vh] flex-col items-center justify-center gap-4 px-5 text-center">
      <h1 className="text-2xl font-bold">Something went wrong</h1>
      <p className="text-muted text-sm">The error was logged. Try again in a moment.</p>
      <button
        type="button"
        onClick={reset}
        className="focus-ring bg-brand rounded-full px-5 py-2.5 text-sm font-semibold text-black"
      >
        Try again
      </button>
    </main>
  );
}
