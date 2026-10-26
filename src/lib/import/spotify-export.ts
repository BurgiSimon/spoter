/**
 * Parser for Spotify's privacy data exports. Runs in the browser so the raw files
 * (which contain IP addresses and device info) never leave the user's machine;
 * only track names, URIs and play timestamps are uploaded.
 *
 * Supported files:
 *  - Extended streaming history: Streaming_History_Audio_*.json (endsong_*.json in older exports)
 *  - Account data history: StreamingHistory_music_*.json / StreamingHistory*.json
 *  - YourLibrary.json (saved tracks, banned tracks)
 *  - Playlist*.json (your playlists)
 */
import { unzipSync, strFromU8 } from "fflate";
import { songKey } from "../normalize";

export interface ExportTrack {
  /** Spotify track id when known. */
  id?: string;
  title: string;
  artist: string;
  album?: string;
}

/** [trackIndex, unixSeconds, msPlayed, skipped(0|1)] */
export type ExportPlay = [number, number, number, 0 | 1];

export interface ParsedExport {
  tracks: ExportTrack[];
  plays: ExportPlay[];
  library: number[];
  banned: number[];
  playlists: { name: string; items: number[] }[];
  stats: { files: number; plays: number; skippedNonMusic: number; tracks: number };
}

interface Builder {
  tracks: ExportTrack[];
  index: Map<string, number>;
  byName: Map<string, number>;
  plays: ExportPlay[];
  library: Set<number>;
  banned: Set<number>;
  playlists: { name: string; items: number[] }[];
  files: number;
  skippedNonMusic: number;
}

const trackIdFromUri = (uri: unknown): string | undefined => {
  if (typeof uri !== "string") return undefined;
  const m =
    /^spotify:track:([A-Za-z0-9]{22})$/.exec(uri) ??
    /open\.spotify\.com\/track\/([A-Za-z0-9]{22})/.exec(uri);
  return m?.[1];
};

function ref(b: Builder, t: ExportTrack): number {
  const nameKey = songKey(t.artist, t.title);
  const key = t.id ? `id:${t.id}` : `n:${nameKey}`;
  let idx = b.index.get(key);
  if (idx === undefined) {
    // Same song seen by name only (or by name before its id was known): merge.
    const byName = b.byName.get(nameKey);
    if (byName !== undefined && (!t.id || !b.tracks[byName]!.id)) idx = byName;
  }
  if (idx === undefined) {
    idx = b.tracks.length;
    b.tracks.push(t);
    b.index.set(key, idx);
    if (!b.byName.has(nameKey)) b.byName.set(nameKey, idx);
  } else if (t.id && !b.tracks[idx]!.id) {
    b.tracks[idx]!.id = t.id;
    b.index.set(key, idx);
  }
  return idx;
}

function str(v: unknown): string | undefined {
  return typeof v === "string" && v.trim() ? v.trim() : undefined;
}

function parseTime(v: unknown): number | null {
  if (typeof v !== "string") return null;
  // "2023-01-01T12:34:56Z" or "2023-01-01 12:34" (account data, UTC)
  const iso = v.includes("T") ? v : `${v.replace(" ", "T")}${v.length <= 16 ? ":00" : ""}Z`;
  const t = Date.parse(iso);
  return Number.isFinite(t) ? Math.floor(t / 1000) : null;
}

function handleJson(b: Builder, name: string, data: unknown): void {
  const base = name.split("/").pop()!.toLowerCase();

  if (Array.isArray(data)) {
    if (/streaming_history_video/.test(base) || /podcast/.test(base)) {
      b.skippedNonMusic += data.length;
      return;
    }
    let used = false;
    for (const row of data as Record<string, unknown>[]) {
      if (!row || typeof row !== "object") continue;
      // Extended streaming history
      if ("ms_played" in row && "ts" in row) {
        used = true;
        const title = str(row.master_metadata_track_name);
        const artist = str(row.master_metadata_album_artist_name);
        if (!title || !artist) {
          b.skippedNonMusic++;
          continue;
        }
        const ts = parseTime(row.ts);
        const ms = Number(row.ms_played) || 0;
        if (ts === null || ms <= 0) continue;
        const idx = ref(b, {
          id: trackIdFromUri(row.spotify_track_uri),
          title,
          artist,
          album: str(row.master_metadata_album_album_name),
        });
        const skipped = row.skipped === true || ms < 30_000 ? 1 : 0;
        // Extended history timestamps mark the end of playback.
        b.plays.push([idx, ts - Math.round(ms / 1000), ms, skipped]);
        continue;
      }
      // Account data streaming history
      if ("msPlayed" in row && "trackName" in row) {
        used = true;
        const title = str(row.trackName);
        const artist = str(row.artistName);
        if (!title || !artist || title === "Unknown Track") {
          b.skippedNonMusic++;
          continue;
        }
        const ts = parseTime(row.endTime);
        const ms = Number(row.msPlayed) || 0;
        if (ts === null || ms <= 0) continue;
        const idx = ref(b, { title, artist });
        b.plays.push([idx, ts - Math.round(ms / 1000), ms, ms < 30_000 ? 1 : 0]);
      }
    }
    if (used) b.files++;
    return;
  }

  if (data && typeof data === "object") {
    const obj = data as Record<string, unknown>;
    // YourLibrary.json
    if (
      Array.isArray(obj.tracks) &&
      (base.includes("library") || "albums" in obj || "artists" in obj)
    ) {
      b.files++;
      for (const t of obj.tracks as Record<string, unknown>[]) {
        const title = str(t.track);
        const artist = str(t.artist);
        if (!title || !artist) continue;
        b.library.add(ref(b, { id: trackIdFromUri(t.uri), title, artist, album: str(t.album) }));
      }
      for (const key of ["bannedTracks", "banned"]) {
        const list = obj[key];
        if (!Array.isArray(list)) continue;
        for (const t of list as Record<string, unknown>[]) {
          const title = str(t.track);
          const artist = str(t.artist);
          if (title && artist) b.banned.add(ref(b, { id: trackIdFromUri(t.uri), title, artist }));
        }
      }
      return;
    }
    // Playlist1.json
    if (Array.isArray(obj.playlists)) {
      b.files++;
      for (const p of obj.playlists as Record<string, unknown>[]) {
        const items: number[] = [];
        for (const item of (Array.isArray(p.items) ? p.items : []) as Record<string, unknown>[]) {
          const t = item.track as Record<string, unknown> | null;
          if (!t) continue;
          const title = str(t.trackName);
          const artist = str(t.artistName);
          if (!title || !artist) continue;
          items.push(
            ref(b, { id: trackIdFromUri(t.trackUri), title, artist, album: str(t.albumName) }),
          );
        }
        if (items.length)
          b.playlists.push({ name: str(p.name) ?? "Playlist", items: [...new Set(items)] });
      }
    }
  }
}

const RELEVANT = /(streaming_?history|endsong|yourlibrary|playlist).*\.json$/i;

export interface InputFile {
  name: string;
  bytes: Uint8Array;
}

/** Accepts .zip archives and/or individual .json files from the export. */
export function parseSpotifyExport(files: InputFile[]): ParsedExport {
  const b: Builder = {
    tracks: [],
    index: new Map(),
    byName: new Map(),
    plays: [],
    library: new Set(),
    banned: new Set(),
    playlists: [],
    files: 0,
    skippedNonMusic: 0,
  };
  for (const file of files) {
    if (file.name.toLowerCase().endsWith(".zip")) {
      const entries = unzipSync(file.bytes, { filter: (f) => RELEVANT.test(f.name) });
      for (const [name, bytes] of Object.entries(entries)) parseFile(b, name, bytes);
    } else if (file.name.toLowerCase().endsWith(".json")) {
      parseFile(b, file.name, file.bytes);
    }
  }
  b.plays.sort((x, y) => x[1] - y[1]);
  return {
    tracks: b.tracks,
    plays: b.plays,
    library: [...b.library],
    banned: [...b.banned],
    playlists: b.playlists,
    stats: {
      files: b.files,
      plays: b.plays.length,
      skippedNonMusic: b.skippedNonMusic,
      tracks: b.tracks.length,
    },
  };
}

function parseFile(b: Builder, name: string, bytes: Uint8Array): void {
  try {
    handleJson(b, name, JSON.parse(strFromU8(bytes)));
  } catch {
    // Not JSON we understand; ignore the file.
  }
}
