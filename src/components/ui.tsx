import { LoaderCircle } from "lucide-react";
import type { ButtonHTMLAttributes, ReactNode } from "react";

type Variant = "primary" | "secondary" | "ghost" | "danger";
const VARIANTS: Record<Variant, string> = {
  primary: "bg-brand text-black hover:brightness-110",
  secondary: "bg-surface-3 text-ink hover:bg-line",
  ghost: "text-ink-2 hover:bg-surface-2 hover:text-ink",
  danger: "bg-nope/15 text-nope hover:bg-nope/25",
};

export function Button({
  variant = "primary",
  loading,
  className = "",
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; loading?: boolean }) {
  return (
    <button
      {...props}
      disabled={props.disabled || loading}
      className={`focus-ring inline-flex items-center justify-center gap-2 rounded-full px-5 py-2.5 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-50 ${VARIANTS[variant]} ${className}`}
    >
      {loading && <LoaderCircle className="size-4 animate-spin" aria-hidden />}
      {children}
    </button>
  );
}

export function Panel({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <section className={`border-line bg-surface rounded-3xl border p-5 sm:p-6 ${className}`}>
      {children}
    </section>
  );
}

export function PageHeader({
  title,
  subtitle,
  action,
  compact,
}: {
  title: string;
  subtitle?: ReactNode;
  action?: ReactNode;
  /** Hide the subtitle on small screens (full-height pages like Discover). */
  compact?: boolean;
}) {
  return (
    <header
      className={`flex flex-wrap items-end justify-between gap-4 ${compact ? "mb-4 md:mb-6" : "mb-6"}`}
    >
      <div>
        <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">{title}</h1>
        {subtitle && (
          <p
            className={`text-muted mt-1 max-w-2xl text-sm sm:text-base ${compact ? "hidden md:block" : ""}`}
          >
            {subtitle}
          </p>
        )}
      </div>
      {action}
    </header>
  );
}

export function Skeleton({ className = "" }: { className?: string }) {
  return <div className={`bg-surface-2 animate-pulse rounded-2xl ${className}`} />;
}

export function PageSkeleton() {
  return (
    <div className="space-y-4" aria-busy="true" aria-label="Loading">
      <Skeleton className="h-9 w-56" />
      <Skeleton className="h-5 w-80" />
      <Skeleton className="mt-6 h-96 w-full" />
    </div>
  );
}

export function Notice({
  tone = "info",
  children,
}: {
  tone?: "info" | "error" | "success";
  children: ReactNode;
}) {
  const tones = {
    info: "border-super/30 bg-super/10 text-ink-2",
    error: "border-nope/30 bg-nope/10 text-ink",
    success: "border-brand/30 bg-brand/10 text-ink",
  };
  return <div className={`rounded-2xl border px-4 py-3 text-sm ${tones[tone]}`}>{children}</div>;
}
