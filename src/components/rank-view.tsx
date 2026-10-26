"use client";

import { GripVertical, Trophy } from "lucide-react";
import { Reorder, useDragControls } from "motion/react";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "@/lib/client/api";
import type { Card } from "@/lib/client/types";
import { useAudio } from "./audio";
import { PlayButton, TrackArt } from "./track-bits";
import { Button, Notice, Panel } from "./ui";

interface Rated extends Card {
  rating: number;
  sigma: number;
  comparisons: number;
}

export function RankView() {
  const audio = useAudio();
  const [items, setItems] = useState<Card[] | null>(null);
  const [top, setTop] = useState<Rated[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [rounds, setRounds] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const seen = useRef<string[]>([]);

  const load = useCallback(
    () =>
      api<{ set: Card[] | null; top: Rated[] }>(`/api/rank?exclude=${seen.current.join(",")}`)
        .then(
          (res) => {
            setItems(res.set);
            setTop(res.top);
            setError(null);
          },
          (err: Error) => setError(err.message || "Could not load songs"),
        )
        .finally(() => setLoading(false)),
    [],
  );

  useEffect(() => {
    void load();
  }, [load]);

  async function submit() {
    if (!items) return;
    setSaving(true);
    audio.stop();
    try {
      await api("/api/rank", { body: { ordered: items.map((i) => i.id) } });
      seen.current = [...items.map((i) => i.id), ...seen.current].slice(0, 40);
      setRounds((r) => r + 1);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save the ranking");
    } finally {
      setSaving(false);
    }
  }

  if (!loading && !items) {
    return (
      <div className="mx-auto max-w-md space-y-4 text-center">
        <h2 className="text-xl font-bold">Your library is still empty</h2>
        <p className="text-muted text-sm">
          Ranking works on songs you already know. Import your music to get started.
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
    <div className="grid gap-6 lg:grid-cols-[1fr_20rem]">
      <div>
        <p className="text-muted mb-3 text-sm">
          Drag to order, favourite on top. {rounds > 0 && <span>· {rounds} rounds done</span>}
        </p>
        {items ? (
          <Reorder.Group axis="y" values={items} onReorder={setItems} className="space-y-2">
            {items.map((item, i) => (
              <RankRow key={item.id} item={item} position={i + 1} />
            ))}
          </Reorder.Group>
        ) : (
          <div className="space-y-2">
            {[0, 1, 2, 3, 4].map((i) => (
              <div key={i} className="bg-surface-2 h-[4.5rem] animate-pulse rounded-2xl" />
            ))}
          </div>
        )}
        <div className="mt-5 flex gap-2">
          <Button onClick={submit} loading={saving} disabled={!items || loading}>
            Save this order
          </Button>
          <Button
            variant="ghost"
            onClick={() => {
              setLoading(true);
              void load();
            }}
            disabled={loading || saving}
          >
            Different songs
          </Button>
        </div>
        {error && (
          <div className="mt-4">
            <Notice tone="error">{error}</Notice>
          </div>
        )}
      </div>
      <Panel className="h-fit">
        <h2 className="mb-1 flex items-center gap-2 font-semibold">
          <Trophy className="text-brand size-4" aria-hidden /> Your all-time top
        </h2>
        <p className="text-muted mb-4 text-xs">
          From your duels and rankings: confident favourites first.
        </p>
        {top.length === 0 ? (
          <p className="text-muted text-sm">Rank a few rounds to see your true favourites here.</p>
        ) : (
          <ol className="space-y-2.5">
            {top.map((t, i) => (
              <li key={t.id} className="flex items-center gap-3">
                <span className="text-muted w-5 text-right text-xs tabular-nums">{i + 1}</span>
                <TrackArt card={t} className="size-9 shrink-0 rounded-md" />
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{t.title}</p>
                  <p className="text-muted truncate text-xs">{t.artist}</p>
                </div>
              </li>
            ))}
          </ol>
        )}
      </Panel>
    </div>
  );
}

function RankRow({ item, position }: { item: Card; position: number }) {
  const controls = useDragControls();
  return (
    <Reorder.Item
      value={item}
      dragListener={false}
      dragControls={controls}
      className="border-line bg-surface flex items-center gap-3 rounded-2xl border p-2.5 pr-3 select-none"
      whileDrag={{ scale: 1.02, boxShadow: "0 20px 40px -12px rgb(0 0 0 / 0.6)" }}
    >
      <button
        type="button"
        aria-label={`Drag ${item.title}`}
        onPointerDown={(e) => controls.start(e)}
        className="focus-ring text-muted hover:text-ink cursor-grab touch-none rounded p-1 active:cursor-grabbing"
      >
        <GripVertical className="size-5" aria-hidden />
      </button>
      <span className="text-muted w-4 text-center text-sm font-semibold tabular-nums">
        {position}
      </span>
      <TrackArt card={item} className="size-12 shrink-0 rounded-lg" />
      <div className="min-w-0 flex-1">
        <p className="truncate font-medium">{item.title}</p>
        <p className="text-muted truncate text-sm">{item.artist}</p>
      </div>
      <PlayButton card={item} size="sm" />
    </Reorder.Item>
  );
}
