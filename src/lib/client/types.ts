export interface Card {
  id: string;
  title: string;
  artist: string;
  album: string | null;
  image: string | null;
  year: number | null;
  durationMs: number | null;
  explicit: boolean;
  spotifyId: string | null;
  hasPreview: boolean;
  tags: string[];
}

export interface DiscoverCard extends Card {
  match: number;
  confidence: number;
  reasons: string[];
}

export interface DuelCard extends Card {
  known: boolean;
}

export interface Job {
  id: string;
  kind: "pipeline" | "ingest";
  status: "queued" | "running" | "done" | "failed";
  progress: { step: string; done: number; total: number; message?: string } | null;
  stats: Record<string, number> | null;
  error: string | null;
  createdAt: string;
  finishedAt: string | null;
}
