"use client";

import { Equal, ThumbsDown } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "@/lib/client/api";
import type { DuelCard } from "@/lib/client/types";
import { useAudio } from "./audio";
import { PlayButton, SpotifyEmbed, TagChips, TrackArt } from "./track-bits";
import { Button, Notice } from "./ui";

interface Duel {
  mode: "known" | "mixed" | "new";
  a: DuelCard;
  b: DuelCard;
}

const MODE_LABEL: Record<Duel["mode"], string> = {
  known: "Two songs from your library",
  mixed: "A new song vs. one you know",
  new: "Two new songs",
};

export function DuelView() {
  const audio = useAudio();
  const [duel, setDuel] = useState<Duel | null>(null);
  const [loading, setLoading] = useState(true);
  const [empty, setEmpty] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [count, setCount] = useState(0);
  const recent = useRef<string[]>([]);

  const load = useCallback(
    () =>
      api<{ duel: Duel | null }>(`/api/duel?exclude=${recent.current.join(",")}`)
        .then(
          (res) => {
            setDuel(res.duel);
            setEmpty(!res.duel);
            setError(null);
          },
          (err: Error) => setError(err.message || "Could not load a duel"),
        )
        .finally(() => setLoading(false)),
    [],
  );

  const skip = useCallback(() => {
    setLoading(true);
    setDuel(null);
    void load();
  }, [load]);

  useEffect(() => {
    void load();
  }, [load]);

  const answer = useCallback(
    async (outcome: "a" | "b" | "both" | "neither") => {
      if (!duel) return;
      audio.stop();
      recent.current = [duel.a.id, duel.b.id, ...recent.current].slice(0, 12);
      setCount((c) => c + 1);
      setDuel(null);
      try {
        await api("/api/duel", { body: { a: duel.a.id, b: duel.b.id, outcome } });
      } catch (err) {
        setError(err instanceof Error ? err.message : "Could not save your answer");
      }
      void load();
    },
    [duel, audio, load],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!duel) return;
      if (e.key === "ArrowLeft" || e.key === "1") void answer("a");
      else if (e.key === "ArrowRight" || e.key === "2") void answer("b");
      else if (e.key === "ArrowUp") void answer("both");
      else if (e.key === "ArrowDown") void answer("neither");
      else if (e.key.toLowerCase() === "s") skip();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [duel, answer, skip]);

  if (empty && !loading) {
    return (
      <div className="mx-auto max-w-md space-y-4 text-center">
        <h2 className="text-xl font-bold">Not enough songs yet</h2>
        <p className="text-muted text-sm">
          Duels need songs from your library or new candidates. Import your music first.
        </p>
        <Link
          href="/import"
          className="focus-ring bg-brand inline-block rounded-full px-6 py-3 text-sm font-semibold text-black"
        >
          Import your music
        </Link>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl">
      <div className="text-muted mb-4 flex items-center justify-between text-sm">
        <span>{duel ? MODE_LABEL[duel.mode] : " "}</span>
        {count > 0 && <span>{count} answered</span>}
      </div>
      <div className="grid grid-cols-2 gap-3 sm:gap-6">
        <AnimatePresence mode="popLayout">
          {duel
            ? [duel.a, duel.b].map((card, i) => (
                <motion.div
                  key={card.id}
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, scale: 0.95 }}
                  transition={{ duration: 0.25, delay: i * 0.05 }}
                >
                  <DuelSide
                    card={card}
                    onPick={() => answer(i === 0 ? "a" : "b")}
                    keyHint={i === 0 ? "←" : "→"}
                  />
                </motion.div>
              ))
            : [0, 1].map((i) => (
                <div key={i} className="bg-surface-2 aspect-[3/4.3] animate-pulse rounded-3xl" />
              ))}
        </AnimatePresence>
      </div>
      <div className="mt-6 flex flex-wrap justify-center gap-2">
        <Button variant="secondary" onClick={() => answer("both")} disabled={!duel}>
          <Equal className="size-4" aria-hidden /> Both great
        </Button>
        <Button variant="secondary" onClick={() => answer("neither")} disabled={!duel}>
          <ThumbsDown className="size-4" aria-hidden /> Neither
        </Button>
        <Button variant="ghost" onClick={skip} disabled={loading}>
          Skip
        </Button>
      </div>
      <p className="text-muted mt-4 hidden text-center text-xs sm:block">
        ← / → pick · ↑ both · ↓ neither · S skip
      </p>
      {error && (
        <div className="mt-4">
          <Notice tone="error">{error}</Notice>
        </div>
      )}
    </div>
  );
}

function DuelSide({
  card,
  onPick,
  keyHint,
}: {
  card: DuelCard;
  onPick: () => void;
  keyHint: string;
}) {
  return (
    <div className="border-line bg-surface hover:border-brand/60 group flex h-full flex-col overflow-hidden rounded-3xl border transition">
      <div className="relative">
        <TrackArt card={card} className="aspect-square w-full" />
        <div className="absolute right-3 bottom-3">
          <PlayButton card={card} />
        </div>
        {card.known && (
          <span className="absolute top-3 left-3 rounded-full bg-black/60 px-2.5 py-1 text-[11px] font-semibold text-white backdrop-blur">
            In your library
          </span>
        )}
      </div>
      <div className="flex flex-1 flex-col gap-2 p-3 sm:p-4">
        <div className="min-w-0">
          <h3 className="truncate font-semibold">{card.title}</h3>
          <p className="text-muted truncate text-sm">
            {card.artist}
            {card.year ? ` · ${card.year}` : ""}
          </p>
        </div>
        <div className="hidden sm:block">
          <TagChips tags={card.tags} max={3} />
        </div>
        {!card.hasPreview && card.spotifyId && <SpotifyEmbed spotifyId={card.spotifyId} />}
        <button
          type="button"
          onClick={onPick}
          className="focus-ring bg-surface-3 group-hover:bg-brand mt-auto rounded-full py-2.5 text-sm font-semibold transition group-hover:text-black"
        >
          This one{" "}
          <span className="text-muted hidden group-hover:text-black/60 sm:inline">({keyHint})</span>
        </button>
      </div>
    </div>
  );
}
