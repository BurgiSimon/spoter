import { Activity, Flame, ListOrdered, ShieldCheck, Sparkles, Swords, Upload } from "lucide-react";
import Link from "next/link";
import { Logo } from "@/components/logo";

const FEATURES = [
  {
    icon: Upload,
    title: "Bring your whole history",
    body: "Connect Spotify for your liked songs, playlists and top tracks, or upload your Spotify data export to use years of listening history.",
  },
  {
    icon: Flame,
    title: "Swipe to discover",
    body: "Hear a 30-second preview, swipe right to keep it, left to pass. Every swipe updates your taste model immediately.",
  },
  {
    icon: Swords,
    title: "This or that",
    body: "Pick the better of two songs. Spoter chooses the pairs it is least sure about, so each answer teaches it the most.",
  },
  {
    icon: ListOrdered,
    title: "Rank your favourites",
    body: "Drag five of your own songs into order. Spoter learns which songs you love, not just which ones you play a lot.",
  },
  {
    icon: Sparkles,
    title: "Recommendations that explain themselves",
    body: "Every pick comes with its reasons, for example “Fans of Slowdive listen to this” or “Matches your taste in dream pop”.",
  },
  {
    icon: Activity,
    title: "See your taste",
    body: "Your tags, eras and artists, plus what Spoter has learned you like or avoid. Tune how adventurous it should be.",
  },
];

export default function Landing() {
  return (
    <div className="relative overflow-hidden">
      <div
        aria-hidden
        className="pointer-events-none absolute -top-40 left-1/2 h-[36rem] w-[60rem] -translate-x-1/2 rounded-full opacity-25 blur-3xl"
        style={{
          background:
            "radial-gradient(closest-side, #1ed760, transparent), radial-gradient(closest-side, #ff4d8d, transparent)",
        }}
      />
      <header className="relative mx-auto flex max-w-6xl items-center justify-between px-5 py-5">
        <Logo />
        <nav className="flex items-center gap-2 text-sm font-semibold">
          <Link
            href="/login"
            className="focus-ring text-ink-2 hover:text-ink rounded-full px-4 py-2"
          >
            Sign in
          </Link>
          <Link
            href="/register"
            className="focus-ring bg-ink text-bg rounded-full px-4 py-2 hover:opacity-90"
          >
            Get started
          </Link>
        </nav>
      </header>

      <main className="relative mx-auto max-w-6xl px-5">
        <section className="grid items-center gap-12 py-14 md:grid-cols-2 md:py-24">
          <div>
            <p className="text-brand mb-4 text-sm font-semibold tracking-wide uppercase">
              Spotify × Tinder
            </p>
            <h1 className="text-4xl leading-[1.05] font-extrabold tracking-tight sm:text-6xl">
              Find music you&apos;ll <span className="text-gradient">actually love.</span>
            </h1>
            <p className="text-ink-2 mt-6 max-w-lg text-lg">
              Spoter reads your Spotify library and listening history, then learns more from every
              swipe, duel and ranking. The more you play, the better it knows your taste.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Link
                href="/register"
                className="focus-ring bg-brand rounded-full px-6 py-3 font-semibold text-black hover:brightness-110"
              >
                Start matching
              </Link>
              <a
                href="/source"
                className="focus-ring border-line text-ink-2 hover:text-ink rounded-full border px-6 py-3 font-semibold"
              >
                View the source
              </a>
            </div>
          </div>
          <HeroCards />
        </section>

        <section aria-labelledby="how" className="py-12">
          <h2 id="how" className="mb-8 text-2xl font-bold tracking-tight sm:text-3xl">
            Four ways to teach it your taste
          </h2>
          <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {FEATURES.map(({ icon: Icon, title, body }) => (
              <li key={title} className="border-line bg-surface rounded-3xl border p-6">
                <Icon className="text-brand mb-4 size-6" aria-hidden />
                <h3 className="font-semibold">{title}</h3>
                <p className="text-muted mt-2 text-sm leading-relaxed">{body}</p>
              </li>
            ))}
          </ul>
        </section>

        <section className="border-line bg-surface my-12 grid gap-6 rounded-3xl border p-8 md:grid-cols-[auto_1fr] md:items-center">
          <ShieldCheck className="text-brand size-10" aria-hidden />
          <div>
            <h2 className="text-xl font-bold">Your data stays yours</h2>
            <p className="text-muted mt-2 text-sm leading-relaxed">
              Spotify export files are parsed in your browser, so IP addresses and device details
              never leave your machine. Spotify tokens are encrypted at rest. You can export or
              permanently delete everything with one click. Spoter is open source under the
              AGPL-3.0.
            </p>
          </div>
        </section>
      </main>

      <footer className="border-line text-muted relative mt-10 border-t">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4 px-5 py-6 text-xs">
          <span>
            © 2026 Spoter contributors ·{" "}
            <a href="/source" className="hover:text-ink underline">
              Source code (AGPL-3.0)
            </a>
          </span>
          <span>Not affiliated with Spotify or Tinder. Previews provided by Deezer.</span>
        </div>
      </footer>
    </div>
  );
}

function HeroCards() {
  return (
    <div aria-hidden className="relative mx-auto h-[26rem] w-full max-w-sm">
      <div className="bg-surface-2 border-line absolute inset-x-6 top-6 bottom-0 rotate-6 rounded-[2rem] border" />
      <div className="bg-surface-3 border-line absolute inset-x-3 top-3 bottom-3 -rotate-3 rounded-[2rem] border" />
      <div className="border-line bg-surface glow absolute inset-0 flex flex-col overflow-hidden rounded-[2rem] border">
        <div className="bg-brand-gradient relative flex-1">
          <div className="absolute top-4 left-4 rounded-full bg-black/40 px-3 py-1 text-xs font-semibold text-white backdrop-blur">
            94% match
          </div>
          <div className="absolute inset-0 grid place-items-center">
            <div className="flex items-end gap-1.5">
              {[18, 34, 52, 30, 44, 24, 12].map((h, i) => (
                <span
                  key={i}
                  className="w-2.5 rounded-full bg-black/60"
                  style={{ height: h * 1.6 }}
                />
              ))}
            </div>
          </div>
        </div>
        <div className="space-y-2 p-5">
          <p className="text-lg font-bold">When the Sun Hits</p>
          <p className="text-muted text-sm">Slowdive · 1993</p>
          <p className="text-ink-2 text-xs">Matches your taste in shoegaze, dream pop</p>
        </div>
      </div>
    </div>
  );
}
