"use client";

import { Star, Trash } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { api, ClientApiError } from "@/lib/client/api";
import type { Card } from "@/lib/client/types";
import { TrackRow } from "./track-row";
import { Button, Notice } from "./ui";

interface Liked extends Card {
  superliked: boolean;
  likedAt: string | null;
}

export function LikesList({ spotifyConnected }: { spotifyConnected: boolean }) {
  const [items, setItems] = useState<Liked[] | null>(null);
  const [message, setMessage] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  const [exporting, setExporting] = useState(false);

  const load = useCallback(
    () =>
      api<{ items: Liked[] }>("/api/likes").then(
        (res) => setItems(res.items),
        (err: Error) => setMessage({ tone: "error", text: err.message }),
      ),
    [],
  );
  useEffect(() => {
    void load();
  }, [load]);

  async function exportAll() {
    setExporting(true);
    setMessage(null);
    try {
      const res = await api<{ added: number }>("/api/likes/export", { method: "POST" });
      setMessage({
        tone: "success",
        text: res.added
          ? `Added ${res.added} songs to your “Spoter Discoveries” playlist.`
          : "Everything is already on your playlist.",
      });
    } catch (err) {
      const text =
        err instanceof ClientApiError && err.code === "spotify_not_connected"
          ? "Connect Spotify on the Import page to export playlists."
          : err instanceof Error
            ? err.message
            : "Export failed";
      setMessage({ tone: "error", text });
    } finally {
      setExporting(false);
    }
  }

  async function remove(card: Liked) {
    setItems((list) => list?.filter((c) => c.id !== card.id) ?? null);
    await api("/api/likes", { method: "DELETE", body: { trackId: card.id } }).catch(() => load());
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-muted text-sm">
          {items ? `${items.length} songs you matched with` : " "}
        </p>
        {spotifyConnected && (
          <Button onClick={exportAll} loading={exporting} disabled={!items?.length}>
            Save to Spotify playlist
          </Button>
        )}
      </div>
      {message && <Notice tone={message.tone}>{message.text}</Notice>}
      {items === null ? (
        <ul className="space-y-3">
          {[0, 1, 2].map((i) => (
            <li key={i} className="bg-surface-2 h-28 animate-pulse rounded-2xl" />
          ))}
        </ul>
      ) : items.length === 0 ? (
        <p className="text-muted py-10 text-center text-sm">
          No likes yet. Head to Discover and start swiping!
        </p>
      ) : (
        <ul className="space-y-3">
          {items.map((card) => (
            <TrackRow
              key={card.id}
              card={card}
              meta={
                card.superliked ? (
                  <Star
                    className="text-super size-4 shrink-0"
                    fill="currentColor"
                    aria-label="Super liked"
                  />
                ) : null
              }
              actions={
                <button
                  type="button"
                  aria-label={`Remove ${card.title} from likes`}
                  onClick={() => remove(card)}
                  className="focus-ring text-muted hover:text-nope grid size-10 place-items-center rounded-full"
                >
                  <Trash className="size-4" />
                </button>
              }
            />
          ))}
        </ul>
      )}
    </div>
  );
}
