"use client";

import { ExternalLink, Pause, Play } from "lucide-react";
import { useAudio } from "./audio";
import type { Card } from "@/lib/client/types";

export function TrackArt({
  card,
  className = "",
}: {
  card: Pick<Card, "image" | "title">;
  className?: string;
}) {
  if (card.image) {
    return (
      <img
        src={card.image}
        alt=""
        loading="lazy"
        className={`bg-surface-3 object-cover ${className}`}
      />
    );
  }
  return (
    <div
      aria-hidden
      className={`bg-brand-gradient grid place-items-center text-2xl font-bold text-black/70 ${className}`}
    >
      {card.title.slice(0, 1).toUpperCase()}
    </div>
  );
}

export function spotifyUrl(card: Pick<Card, "spotifyId" | "artist" | "title">): string {
  return card.spotifyId
    ? `https://open.spotify.com/track/${card.spotifyId}`
    : `https://open.spotify.com/search/${encodeURIComponent(`${card.artist} ${card.title}`)}`;
}

export function SpotifyLink({
  card,
  className = "",
}: {
  card: Pick<Card, "spotifyId" | "artist" | "title">;
  className?: string;
}) {
  return (
    <a
      href={spotifyUrl(card)}
      target="_blank"
      rel="noopener noreferrer"
      className={`focus-ring text-muted hover:text-ink inline-flex items-center gap-1 text-xs ${className}`}
    >
      Open in Spotify <ExternalLink className="size-3" aria-hidden />
    </a>
  );
}

export function PlayButton({
  card,
  size = "md",
}: {
  card: Pick<Card, "id" | "hasPreview" | "title">;
  size?: "sm" | "md" | "lg";
}) {
  const audio = useAudio();
  const active = audio.current === card.id && audio.playing;
  const dims = size === "lg" ? "size-14" : size === "sm" ? "size-8" : "size-11";
  const icon = size === "lg" ? "size-6" : size === "sm" ? "size-3.5" : "size-5";
  if (!card.hasPreview) return null;
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        audio.toggle(card.id);
      }}
      aria-label={active ? `Pause ${card.title}` : `Play preview of ${card.title}`}
      className={`focus-ring relative grid ${dims} shrink-0 place-items-center rounded-full bg-white text-black shadow-lg transition hover:scale-105 active:scale-95`}
    >
      {active ? (
        <Pause className={icon} fill="currentColor" />
      ) : (
        <Play className={`${icon} translate-x-px`} fill="currentColor" />
      )}
      {audio.current === card.id && (
        <svg
          className="pointer-events-none absolute inset-0 -rotate-90"
          viewBox="0 0 36 36"
          aria-hidden
        >
          <circle
            cx="18"
            cy="18"
            r="17"
            fill="none"
            stroke="rgb(30 215 96)"
            strokeWidth="2"
            strokeDasharray={`${audio.progress * 106.8} 106.8`}
          />
        </svg>
      )}
    </button>
  );
}

/** Spotify's embed is the fallback player when Deezer has no preview for a song. */
export function SpotifyEmbed({ spotifyId }: { spotifyId: string }) {
  return (
    <iframe
      title="Spotify player"
      src={`https://open.spotify.com/embed/track/${spotifyId}?theme=0`}
      width="100%"
      height="80"
      loading="lazy"
      allow="autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture"
      className="rounded-xl border-0"
    />
  );
}

export function TagChips({ tags, max = 4 }: { tags: string[]; max?: number }) {
  if (!tags.length) return null;
  return (
    <ul className="flex flex-wrap gap-1.5">
      {tags.slice(0, max).map((t) => (
        <li
          key={t}
          className="bg-surface-3 text-ink-2 rounded-full px-2.5 py-0.5 text-xs capitalize"
        >
          {t}
        </li>
      ))}
    </ul>
  );
}
