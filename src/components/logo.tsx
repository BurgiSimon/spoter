export function LogoMark({ className = "size-8" }: { className?: string }) {
  return <img src="/icon.svg" alt="" aria-hidden className={className} />;
}

export function Logo({ className = "" }: { className?: string }) {
  return (
    <span
      className={`inline-flex items-center gap-2 text-lg font-bold tracking-tight ${className}`}
    >
      <LogoMark className="size-8" />
      <span>
        Spot<span className="text-gradient">er</span>
      </span>
    </span>
  );
}
