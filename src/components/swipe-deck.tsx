"use client";

import { Ban, Heart, Info, RefreshCw, SkipForward, Star, Undo2, X } from "lucide-react";
import { AnimatePresence, motion, useMotionValue, useTransform, animate } from "motion/react";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "@/lib/client/api";
import type { DiscoverCard } from "@/lib/client/types";
import { useAudio } from "./audio";
import { JobProgress, useJobs } from "./job-status";
import { PlayButton, SpotifyEmbed, SpotifyLink, TagChips, TrackArt } from "./track-bits";
import { Button, Notice } from "./ui";

type Action = "like" | "dislike" | "superlike" | "skip";
const THRESHOLD = 110;

export function SwipeDeck() {
  const audio = useAudio();
  const [queue, setQueue] = useState<DiscoverCard[]>([]);
  const [history, setHistory] = useState<DiscoverCard[]>([]);
  const [loading, setLoading] = useState(true);
  const [poolSize, setPoolSize] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [started, setStarted] = useState(false);
  const [exit, setExit] = useState<Action>("like");
  const [count, setCount] = useState(0);
  const fetching = useRef(false);

  const load = useCallback(() => {
    if (fetching.current) return Promise.resolve();
    fetching.current = true;
    return api<{ cards: DiscoverCard[]; poolSize: number }>("/api/discover?size=10")
      .then(
        (res) => {
          setPoolSize(res.poolSize);
          setQueue((q) => {
            const ids = new Set(q.map((c) => c.id));
            return [...q, ...res.cards.filter((c) => !ids.has(c.id))];
          });
          setError(null);
        },
        (err: Error) => setError(err.message || "Could not load songs"),
      )
      .finally(() => {
        fetching.current = false;
        setLoading(false);
      });
  }, []);

  const { active, poke } = useJobs(() => {
    if (queue.length < 4) void load();
  });

  useEffect(() => {
    void load();
  }, [load]);

  const top = queue[0];

  // Autoplay the top card once the user has interacted (browser autoplay policy).
  useEffect(() => {
    if (started && top?.hasPreview) audio.play(top.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [started, top?.id]);

  const decide = useCallback(
    (action: Action) => {
      if (!top) return;
      setExit(action);
      setStarted(true);
      setHistory((h) => [top, ...h].slice(0, 20));
      setQueue((q) => q.slice(1));
      setCount((c) => c + 1);
      api("/api/discover/swipe", { body: { trackId: top.id, action } }).catch((err: Error) =>
        setError(err.message),
      );
      if (queue.length <= 4) void load();
    },
    [top, queue.length, load],
  );

  const undo = useCallback(async () => {
    const last = history[0];
    if (!last) return;
    try {
      await api("/api/discover/undo", { method: "POST" });
      setHistory((h) => h.slice(1));
      setQueue((q) => [last, ...q.filter((c) => c.id !== last.id)]);
      setCount((c) => Math.max(0, c - 1));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Undo failed");
    }
  }, [history]);

  const blockArtist = useCallback(async () => {
    if (!top) return;
    await api("/api/artists/block", { body: { trackId: top.id, blocked: true } }).catch(
      () => undefined,
    );
    decide("dislike");
  }, [top, decide]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.key === "ArrowRight") decide("like");
      else if (e.key === "ArrowLeft") decide("dislike");
      else if (e.key === "ArrowUp") decide("superlike");
      else if (e.key === "ArrowDown") decide("skip");
      else if (e.key === "Backspace" || e.key.toLowerCase() === "z") void undo();
      else if (e.key === " " && top) {
        e.preventDefault();
        setStarted(true);
        audio.toggle(top.id);
      } else return;
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [decide, undo, top, audio]);

  if (loading) return <DeckSkeleton />;

  if (!top) {
    return (
      <div className="mx-auto max-w-md space-y-4 text-center">
        {active ? (
          <>
            <h2 className="text-xl font-bold">Finding your first matches…</h2>
            <p className="text-muted text-sm">
              Spoter is analysing your library and exploring artists near your taste. The first
              songs usually show up within a couple of minutes.
            </p>
            <JobProgress job={active} />
          </>
        ) : poolSize === 0 && count === 0 ? (
          <>
            <h2 className="text-xl font-bold">Nothing to swipe yet</h2>
            <p className="text-muted text-sm">
              Connect Spotify or upload your Spotify data export so Spoter can learn your taste.
            </p>
            <Link
              href="/import"
              className="focus-ring bg-brand inline-block rounded-full px-6 py-3 text-sm font-semibold text-black"
            >
              Import your music
            </Link>
          </>
        ) : (
          <>
            <h2 className="text-xl font-bold">You&apos;ve seen everything for now 🎧</h2>
            <p className="text-muted text-sm">
              Generate a fresh batch based on everything you just taught Spoter.
            </p>
            <Button
              onClick={() =>
                api("/api/refresh", { method: "POST" }).then(poke, (err: Error) =>
                  setError(err.message),
                )
              }
              className="mx-auto"
            >
              <RefreshCw className="size-4" aria-hidden /> Find more songs
            </Button>
          </>
        )}
        {error && <Notice tone="error">{error}</Notice>}
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-md">
      {active && (
        <div className="mb-4">
          <JobProgress job={active} />
        </div>
      )}
      <div className="relative h-[calc(100dvh-24rem)] max-h-[40rem] min-h-[22rem] w-full md:h-[calc(100dvh-19rem)]">
        <AnimatePresence custom={exit}>
          {queue
            .slice(0, 3)
            .reverse()
            .map((card, i, arr) => {
              const depth = arr.length - 1 - i;
              return depth === 0 ? (
                <SwipeCard
                  key={card.id}
                  card={card}
                  onDecide={decide}
                  onStart={() => setStarted(true)}
                />
              ) : (
                <motion.div
                  key={card.id}
                  className="border-line bg-surface absolute inset-0 overflow-hidden rounded-[2rem] border"
                  initial={false}
                  animate={{ scale: 1 - depth * 0.04, y: depth * 14, opacity: 1 - depth * 0.25 }}
                  transition={{ type: "spring", stiffness: 260, damping: 30 }}
                  aria-hidden
                >
                  <TrackArt card={card} className="h-3/5 w-full" />
                </motion.div>
              );
            })}
        </AnimatePresence>
        {!started && top.hasPreview && (
          <button
            type="button"
            onClick={() => {
              setStarted(true);
              audio.play(top.id);
            }}
            className="focus-ring absolute top-[29%] left-1/2 z-30 -translate-x-1/2 -translate-y-1/2 rounded-full bg-black/70 px-5 py-2.5 text-sm font-semibold whitespace-nowrap text-white shadow-lg backdrop-blur"
          >
            ▶ Tap to start listening
          </button>
        )}
      </div>

      <div className="mt-5 flex items-center justify-center gap-3 sm:gap-4">
        <RoundButton label="Undo (Z)" onClick={undo} disabled={!history.length} size="sm">
          <Undo2 className="size-5" />
        </RoundButton>
        <RoundButton label="Nope (←)" onClick={() => decide("dislike")} tone="nope">
          <X className="size-7" strokeWidth={2.5} />
        </RoundButton>
        <RoundButton
          label="Super like: adds it to your Spotify playlist (↑)"
          onClick={() => decide("superlike")}
          tone="super"
          size="sm"
        >
          <Star className="size-5" fill="currentColor" />
        </RoundButton>
        <RoundButton label="Like (→)" onClick={() => decide("like")} tone="like">
          <Heart className="size-7" fill="currentColor" />
        </RoundButton>
        <RoundButton label="Skip for now (↓)" onClick={() => decide("skip")} size="sm">
          <SkipForward className="size-5" />
        </RoundButton>
      </div>

      <div className="text-muted mt-4 flex flex-wrap items-center justify-center gap-x-4 gap-y-2 text-xs">
        <span className="hidden sm:inline">
          ← nope · → like · ↑ super like · ↓ skip · space play · Z undo
        </span>
        <button
          type="button"
          onClick={blockArtist}
          className="focus-ring hover:text-ink inline-flex items-center gap-1 rounded"
        >
          <Ban className="size-3.5" aria-hidden /> Never this artist
        </button>
        {count > 0 && <span>{count} rated this session</span>}
      </div>
      {error && (
        <div className="mt-4">
          <Notice tone="error">{error}</Notice>
        </div>
      )}
    </div>
  );
}

function SwipeCard({
  card,
  onDecide,
  onStart,
}: {
  card: DiscoverCard;
  onDecide: (a: Action) => void;
  onStart: () => void;
}) {
  const x = useMotionValue(0);
  const y = useMotionValue(0);
  const rotate = useTransform(x, [-240, 240], [-14, 14]);
  const likeOpacity = useTransform(x, [30, THRESHOLD], [0, 1]);
  const nopeOpacity = useTransform(x, [-THRESHOLD, -30], [1, 0]);
  const superOpacity = useTransform(y, [-THRESHOLD, -30], [1, 0]);
  const [showWhy, setShowWhy] = useState(false);

  return (
    <motion.article
      aria-label={`${card.title} by ${card.artist}`}
      className="border-line bg-surface absolute inset-0 z-20 flex cursor-grab touch-none flex-col overflow-hidden rounded-[2rem] border shadow-2xl active:cursor-grabbing"
      style={{ x, y, rotate }}
      drag
      dragSnapToOrigin
      dragElastic={0.9}
      onDragStart={onStart}
      onDragEnd={(
        _,
        info: { offset: { x: number; y: number }; velocity: { x: number; y: number } },
      ) => {
        const { offset, velocity } = info;
        if (offset.y < -THRESHOLD && Math.abs(offset.x) < THRESHOLD) onDecide("superlike");
        else if (offset.x > THRESHOLD || velocity.x > 800) onDecide("like");
        else if (offset.x < -THRESHOLD || velocity.x < -800) onDecide("dislike");
        else {
          void animate(x, 0);
          void animate(y, 0);
        }
      }}
      initial={{ scale: 0.96, y: 14, opacity: 0.8 }}
      animate={{ scale: 1, y: 0, opacity: 1 }}
      variants={{
        exit: (action: Action) => ({
          x: action === "like" ? 600 : action === "dislike" ? -600 : 0,
          y: action === "superlike" ? -700 : action === "skip" ? 500 : 0,
          opacity: 0,
          rotate: action === "like" ? 20 : action === "dislike" ? -20 : 0,
          transition: { duration: 0.3 },
        }),
      }}
      exit="exit"
    >
      <div className="relative h-[58%] shrink-0">
        <TrackArt card={card} className="pointer-events-none h-full w-full select-none" />
        <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-black/30" />
        <div className="absolute top-4 left-4 rounded-full bg-black/50 px-3 py-1 text-xs font-semibold text-white backdrop-blur">
          {card.match}% match
        </div>
        <motion.div
          style={{ opacity: likeOpacity }}
          className="border-like text-like absolute top-6 right-6 rotate-12 rounded-lg border-4 px-3 py-1 text-2xl font-black"
        >
          LIKE
        </motion.div>
        <motion.div
          style={{ opacity: nopeOpacity }}
          className="border-nope text-nope absolute top-6 left-6 -rotate-12 rounded-lg border-4 px-3 py-1 text-2xl font-black"
        >
          NOPE
        </motion.div>
        <motion.div
          style={{ opacity: superOpacity }}
          className="border-super text-super absolute bottom-20 left-1/2 -translate-x-1/2 rounded-lg border-4 px-3 py-1 text-2xl font-black"
        >
          SUPER
        </motion.div>
        <div className="absolute right-4 bottom-4 left-4 flex items-end justify-between gap-3">
          <div className="min-w-0 text-white">
            <h2 className="truncate text-2xl leading-tight font-bold">{card.title}</h2>
            <p className="truncate text-sm text-white/80">
              {card.artist}
              {card.year ? ` · ${card.year}` : ""}
              {card.explicit ? " · 🅴" : ""}
            </p>
          </div>
          <PlayButton card={card} size="lg" />
        </div>
      </div>
      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-5">
        <TagChips tags={card.tags} />
        {!card.hasPreview && card.spotifyId && <SpotifyEmbed spotifyId={card.spotifyId} />}
        <ul className="text-ink-2 space-y-1.5 text-sm">
          {card.reasons.slice(0, showWhy ? 3 : 1).map((r) => (
            <li key={r} className="flex gap-2">
              <span className="text-brand">✦</span>
              {r}
            </li>
          ))}
        </ul>
        <div className="mt-auto flex items-center justify-between">
          {card.reasons.length > 1 && (
            <button
              type="button"
              onPointerDown={(e) => e.stopPropagation()}
              onClick={() => setShowWhy((v) => !v)}
              className="focus-ring text-muted hover:text-ink inline-flex items-center gap-1 rounded text-xs"
            >
              <Info className="size-3.5" aria-hidden /> {showWhy ? "Less" : "Why this song?"}
            </button>
          )}
          <span className="text-muted text-xs" title="How sure Spoter is about this prediction">
            {card.confidence}% sure
          </span>
          <span onPointerDown={(e) => e.stopPropagation()}>
            <SpotifyLink card={card} />
          </span>
        </div>
      </div>
    </motion.article>
  );
}

function RoundButton({
  label,
  onClick,
  disabled,
  tone,
  size = "md",
  children,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  tone?: "like" | "nope" | "super";
  size?: "sm" | "md";
  children: React.ReactNode;
}) {
  const tones = {
    like: "text-like hover:bg-like/10 border-like/40",
    nope: "text-nope hover:bg-nope/10 border-nope/40",
    super: "text-super hover:bg-super/10 border-super/40",
  };
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      disabled={disabled}
      className={`focus-ring bg-surface grid place-items-center rounded-full border shadow-lg transition hover:scale-105 active:scale-95 disabled:opacity-40 ${
        size === "md" ? "size-14 sm:size-16" : "size-11 sm:size-12"
      } ${tone ? tones[tone] : "border-line text-ink-2 hover:bg-surface-2"}`}
    >
      {children}
    </button>
  );
}

function DeckSkeleton() {
  return (
    <div className="mx-auto w-full max-w-md" aria-busy="true" aria-label="Loading songs">
      <div className="bg-surface-2 h-[calc(100dvh-24rem)] max-h-[40rem] min-h-[22rem] w-full animate-pulse rounded-[2rem] md:h-[calc(100dvh-19rem)]" />
      <div className="mt-6 flex justify-center gap-4">
        {[48, 64, 48, 64, 48].map((s, i) => (
          <div
            key={i}
            className="bg-surface-2 animate-pulse rounded-full"
            style={{ width: s, height: s }}
          />
        ))}
      </div>
    </div>
  );
}
