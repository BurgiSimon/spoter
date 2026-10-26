"use client";

import type { ReactNode } from "react";
import type { Card } from "@/lib/client/types";
import { PlayButton, SpotifyLink, TagChips, TrackArt } from "./track-bits";

export function TrackRow({
  card,
  meta,
  actions,
  children,
}: {
  card: Card;
  meta?: ReactNode;
  actions?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <li className="border-line bg-surface flex gap-3 rounded-2xl border p-3 sm:gap-4 sm:p-4">
      <div className="relative shrink-0">
        <TrackArt card={card} className="size-16 rounded-xl sm:size-20" />
        <div className="absolute -right-2 -bottom-2">
          <PlayButton card={card} size="sm" />
        </div>
      </div>
      <div className="min-w-0 flex-1 space-y-1.5">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="truncate font-semibold">{card.title}</p>
            <p className="text-muted truncate text-sm">
              {card.artist}
              {card.year ? ` · ${card.year}` : ""}
            </p>
          </div>
          {meta}
        </div>
        {children}
        <div className="flex flex-wrap items-center justify-between gap-2">
          <TagChips tags={card.tags} max={3} />
          <SpotifyLink card={card} />
        </div>
      </div>
      {actions && <div className="flex shrink-0 flex-col justify-center gap-2">{actions}</div>}
    </li>
  );
}
