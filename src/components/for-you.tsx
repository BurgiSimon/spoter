"use client";

import { Heart, RefreshCw, X } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/client/api";
import type { DiscoverCard } from "@/lib/client/types";
import { JobProgress, useJobs } from "./job-status";
import { TrackRow } from "./track-row";
import { Button, Notice } from "./ui";

export function ForYou() {
  const [items, setItems] = useState<DiscoverCard[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(
    () =>
      api<{ items: DiscoverCard[] }>("/api/recommendations?size=30").then(
        (res) => setItems(res.items),
        (err: Error) => setError(err.message || "Could not load recommendations"),
      ),
    [],
  );
  const { active, poke } = useJobs(() => void load());

  useEffect(() => {
    void load();
  }, [load]);

  async function decide(card: DiscoverCard, action: "like" | "dislike") {
    setItems((list) => list?.filter((c) => c.id !== card.id) ?? null);
    await api("/api/discover/swipe", { body: { trackId: card.id, action } }).catch((err: Error) =>
      setError(err.message),
    );
  }

  async function refresh() {
    setRefreshing(true);
    try {
      await api("/api/refresh", { method: "POST" });
      poke();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not refresh");
    } finally {
      setRefreshing(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-muted text-sm">
          Ranked by how confident Spoter is that you&apos;ll love them.
        </p>
        <Button
          variant="secondary"
          onClick={refresh}
          loading={refreshing}
          disabled={Boolean(active)}
        >
          <RefreshCw className="size-4" aria-hidden /> Refresh
        </Button>
      </div>
      {active && <JobProgress job={active} />}
      {error && <Notice tone="error">{error}</Notice>}
      {items === null ? (
        <ul className="space-y-3">
          {[0, 1, 2, 3].map((i) => (
            <li key={i} className="bg-surface-2 h-28 animate-pulse rounded-2xl" />
          ))}
        </ul>
      ) : items.length === 0 ? (
        <div className="py-10 text-center">
          <p className="text-muted text-sm">No recommendations yet.</p>
          <Link href="/import" className="text-brand text-sm font-semibold hover:underline">
            Import your music to get started
          </Link>
        </div>
      ) : (
        <ul className="space-y-3">
          {items.map((card) => (
            <TrackRow
              key={card.id}
              card={card}
              meta={
                <span className="bg-brand/15 text-brand shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold">
                  {card.match}%
                </span>
              }
              actions={
                <>
                  <button
                    type="button"
                    aria-label={`Like ${card.title}`}
                    onClick={() => decide(card, "like")}
                    className="focus-ring border-like/40 text-like hover:bg-like/10 grid size-10 place-items-center rounded-full border"
                  >
                    <Heart className="size-4" fill="currentColor" />
                  </button>
                  <button
                    type="button"
                    aria-label={`Not for me: ${card.title}`}
                    onClick={() => decide(card, "dislike")}
                    className="focus-ring border-nope/40 text-nope hover:bg-nope/10 grid size-10 place-items-center rounded-full border"
                  >
                    <X className="size-4" />
                  </button>
                </>
              }
            >
              {card.reasons[0] && <p className="text-ink-2 text-xs">✦ {card.reasons[0]}</p>}
            </TrackRow>
          ))}
        </ul>
      )}
    </div>
  );
}
