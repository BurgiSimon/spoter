"use client";

import {
  Activity,
  Flame,
  Heart,
  ListOrdered,
  Settings,
  Sparkles,
  Swords,
  Upload,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Logo } from "./logo";

export const NAV = [
  { href: "/discover", label: "Discover", icon: Flame, primary: true },
  { href: "/duel", label: "Duel", icon: Swords, primary: true },
  { href: "/rank", label: "Rank", icon: ListOrdered, primary: true },
  { href: "/for-you", label: "For you", icon: Sparkles, primary: true },
  { href: "/likes", label: "Likes", icon: Heart, primary: true },
  { href: "/taste", label: "Your taste", icon: Activity, primary: false },
  { href: "/import", label: "Import & sync", icon: Upload, primary: false },
  { href: "/settings", label: "Settings", icon: Settings, primary: false },
] as const;

export function SideNav() {
  const path = usePathname();
  return (
    <nav
      aria-label="Main"
      className="border-line sticky top-0 hidden h-dvh w-60 shrink-0 flex-col border-r px-3 py-5 md:flex"
    >
      <Link href="/discover" className="focus-ring mb-8 rounded-lg px-3">
        <Logo />
      </Link>
      <ul className="space-y-1">
        {NAV.map(({ href, label, icon: Icon }) => {
          const active = path === href || path.startsWith(`${href}/`);
          return (
            <li key={href}>
              <Link
                href={href}
                aria-current={active ? "page" : undefined}
                className={`focus-ring flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition ${
                  active ? "bg-surface-2 text-ink" : "text-muted hover:bg-surface hover:text-ink"
                }`}
              >
                <Icon className={`size-5 ${active ? "text-brand" : ""}`} aria-hidden />
                {label}
              </Link>
            </li>
          );
        })}
      </ul>
      <a
        href="/source"
        className="focus-ring text-muted hover:text-ink mt-auto rounded px-3 text-xs"
      >
        Open source · AGPL-3.0
      </a>
    </nav>
  );
}

export function BottomNav() {
  const path = usePathname();
  const items = NAV.filter((n) => n.primary);
  return (
    <nav
      aria-label="Main"
      className="border-line bg-bg/90 fixed inset-x-0 bottom-0 z-40 border-t pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden"
    >
      <ul className="grid grid-cols-5">
        {items.map(({ href, label, icon: Icon }) => {
          const active = path === href || path.startsWith(`${href}/`);
          return (
            <li key={href}>
              <Link
                href={href}
                aria-current={active ? "page" : undefined}
                className={`focus-ring flex flex-col items-center gap-1 py-2.5 text-[11px] font-medium ${active ? "text-ink" : "text-muted"}`}
              >
                <Icon className={`size-5 ${active ? "text-brand" : ""}`} aria-hidden />
                {label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

export function MobileTopBar() {
  const path = usePathname();
  const secondary = NAV.filter((n) => !n.primary);
  return (
    <header className="border-line flex items-center justify-between border-b px-4 py-3 md:hidden">
      <Link href="/discover" className="focus-ring rounded-lg">
        <Logo />
      </Link>
      <div className="flex items-center gap-1">
        {secondary.map(({ href, label, icon: Icon }) => (
          <Link
            key={href}
            href={href}
            aria-label={label}
            className={`focus-ring grid size-10 place-items-center rounded-full ${path.startsWith(href) ? "bg-surface-2 text-ink" : "text-muted"}`}
          >
            <Icon className="size-5" aria-hidden />
          </Link>
        ))}
      </div>
    </header>
  );
}
