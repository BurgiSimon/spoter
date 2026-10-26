"use client";

import { CircleAlert, Download, LoaderCircle, RefreshCw, Upload } from "lucide-react";
import { useRouter } from "next/navigation";
import { useRef, useState, type DragEvent } from "react";
import { api } from "@/lib/client/api";
import { OAUTH_ERRORS } from "./auth-form";
import { JobProgress, useJobs } from "./job-status";
import { Button, Notice, Panel } from "./ui";

interface Props {
  spotifyEnabled: boolean;
  spotify: { displayName: string | null; lastSyncAt: string | null } | null;
  library: { tracks: number; plays: number };
  error?: string;
  connected?: boolean;
}

type Stage =
  | { kind: "idle" }
  | { kind: "parsing" }
  | { kind: "uploading"; tracks: number; plays: number }
  | { kind: "done"; tracks: number; plays: number }
  | { kind: "error"; message: string };

export function ImportPanel({ spotifyEnabled, spotify, library, error, connected }: Props) {
  const router = useRouter();
  const [stage, setStage] = useState<Stage>({ kind: "idle" });
  const [syncing, setSyncing] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const { jobs, active, poke } = useJobs(() => router.refresh());

  async function handleFiles(list: FileList | File[]) {
    const files = [...list].filter((f) => /\.(zip|json)$/i.test(f.name));
    if (!files.length) {
      setStage({
        kind: "error",
        message: "Choose the .zip you got from Spotify (or the .json files inside it).",
      });
      return;
    }
    setStage({ kind: "parsing" });
    try {
      const inputs = await Promise.all(
        files.map(async (f) => ({ name: f.name, bytes: new Uint8Array(await f.arrayBuffer()) })),
      );
      const worker = new Worker(new URL("../lib/import/export.worker.ts", import.meta.url), {
        type: "module",
      });
      const result = await new Promise<{
        ok: boolean;
        error?: string;
        gz?: Uint8Array;
        stats?: { tracks: number; plays: number; files: number };
      }>((resolve) => {
        worker.onmessage = (e) => resolve(e.data);
        worker.onerror = (e) => resolve({ ok: false, error: e.message });
        worker.postMessage(
          { files: inputs },
          inputs.map((i) => i.bytes.buffer),
        );
      });
      worker.terminate();
      if (!result.ok || !result.gz || !result.stats)
        throw new Error(result.error ?? "Could not read the files");
      if (result.stats.files === 0 || result.stats.tracks === 0)
        throw new Error("No Spotify history, library or playlist files found in that upload.");
      setStage({ kind: "uploading", tracks: result.stats.tracks, plays: result.stats.plays });
      const res = await fetch("/api/import/export", {
        method: "POST",
        headers: { "Content-Type": "application/octet-stream" },
        body: result.gz as BodyInit,
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(data.error ?? `Upload failed (${res.status})`);
      setStage({ kind: "done", tracks: result.stats.tracks, plays: result.stats.plays });
      poke();
      router.refresh();
    } catch (err) {
      setStage({ kind: "error", message: err instanceof Error ? err.message : "Import failed" });
    }
  }

  async function sync() {
    setSyncing(true);
    setNotice(null);
    try {
      const res = await api<{ alreadyRunning: boolean }>("/api/refresh", { method: "POST" });
      setNotice(
        res.alreadyRunning
          ? "A sync is already running."
          : "Sync started. This can take a few minutes the first time.",
      );
      poke();
    } catch (err) {
      setNotice(err instanceof Error ? err.message : "Could not start a sync");
    } finally {
      setSyncing(false);
    }
  }

  function onDrop(e: DragEvent) {
    e.preventDefault();
    setDragging(false);
    void handleFiles(e.dataTransfer.files);
  }

  const lastJob = jobs[0];
  return (
    <div className="space-y-6">
      {error && <Notice tone="error">{OAUTH_ERRORS[error] ?? "Connecting Spotify failed."}</Notice>}
      {connected && <Notice tone="success">Spotify connected! Your library is syncing now.</Notice>}
      {active ? (
        <JobProgress job={active} />
      ) : (
        lastJob?.status === "failed" && (
          <Notice tone="error">
            The last background job failed: {lastJob.error ?? "unknown error"}. You can retry with
            “Sync now”.
          </Notice>
        )
      )}

      <div className="grid gap-4 sm:grid-cols-3">
        <Stat label="Songs in your library" value={library.tracks} />
        <Stat label="Plays imported" value={library.plays} />
        <Stat label="Spotify" value={spotify ? "Connected" : "Not connected"} />
      </div>

      <Panel>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="max-w-xl">
            <h2 className="text-lg font-semibold">Connect Spotify</h2>
            <p className="text-muted mt-1 text-sm">
              Imports your liked songs, your own playlists, your top tracks and artists (4 weeks, 6
              months, all time) and your 50 most recent plays. Super likes go into a private “Spoter
              Discoveries” playlist.
            </p>
            {spotify && (
              <p className="text-ink-2 mt-3 text-sm">
                Connected as <strong>{spotify.displayName ?? "you"}</strong>
                {spotify.lastSyncAt
                  ? ` · last synced ${new Date(spotify.lastSyncAt).toLocaleString()}`
                  : " · first sync pending"}
              </p>
            )}
          </div>
          {spotifyEnabled ? (
            spotify ? (
              <Button
                variant="secondary"
                onClick={sync}
                loading={syncing}
                disabled={Boolean(active)}
              >
                <RefreshCw className="size-4" aria-hidden /> Sync now
              </Button>
            ) : (
              <a
                href="/api/auth/spotify/login"
                className="focus-ring rounded-full bg-[#1ed760] px-5 py-2.5 text-sm font-bold text-black hover:brightness-110"
              >
                Connect Spotify
              </a>
            )
          ) : (
            <span className="text-muted text-sm">
              Spotify login isn&apos;t configured on this server.
            </span>
          )}
        </div>
        {notice && <p className="text-ink-2 mt-4 text-sm">{notice}</p>}
        <p className="text-muted mt-4 flex gap-2 text-xs">
          <CircleAlert className="size-4 shrink-0" aria-hidden />
          Spotify only lets non-approved apps connect up to 5 allow-listed users. If connecting
          fails, the data export below works for everyone and contains far more history.
        </p>
      </Panel>

      <Panel>
        <h2 className="text-lg font-semibold">Upload your Spotify data export</h2>
        <p className="text-muted mt-1 text-sm">
          Your full listening history makes the biggest difference. Request it from{" "}
          <a
            href="https://www.spotify.com/account/privacy/"
            target="_blank"
            rel="noopener noreferrer"
            className="text-ink underline"
          >
            Spotify&apos;s privacy page
          </a>
          : tick <strong>Extended streaming history</strong> (all years, takes up to 30 days) and/or{" "}
          <strong>Account data</strong> (last year plus your library and playlists, about 5 days).
          Then drop the zip here.
        </p>
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
          className={`mt-5 grid place-items-center rounded-2xl border-2 border-dashed px-6 py-10 text-center transition ${
            dragging ? "border-brand bg-brand/5" : "border-line"
          }`}
        >
          {stage.kind === "parsing" || stage.kind === "uploading" ? (
            <div className="flex flex-col items-center gap-3" role="status">
              <LoaderCircle className="text-brand size-8 animate-spin" aria-hidden />
              <p className="text-sm font-medium">
                {stage.kind === "parsing"
                  ? "Reading your files on this device…"
                  : `Uploading ${stage.tracks.toLocaleString()} songs and ${stage.plays.toLocaleString()} plays…`}
              </p>
            </div>
          ) : (
            <div className="flex flex-col items-center gap-3">
              <Upload className="text-muted size-8" aria-hidden />
              <p className="text-sm">
                Drag &amp; drop <code className="text-ink-2">my_spotify_data.zip</code> here
              </p>
              <Button variant="secondary" onClick={() => input.current?.click()}>
                Choose files
              </Button>
              <input
                ref={input}
                type="file"
                accept=".zip,.json,application/zip,application/json"
                multiple
                className="sr-only"
                onChange={(e) => e.target.files && handleFiles(e.target.files)}
              />
            </div>
          )}
        </div>
        {stage.kind === "done" && (
          <div className="mt-4">
            <Notice tone="success">
              Got {stage.tracks.toLocaleString()} songs and {stage.plays.toLocaleString()} plays.
              Spoter is importing them in the background; recommendations update automatically when
              it&apos;s done.
            </Notice>
          </div>
        )}
        {stage.kind === "error" && (
          <div className="mt-4">
            <Notice tone="error">{stage.message}</Notice>
          </div>
        )}
        <p className="text-muted mt-4 flex gap-2 text-xs">
          <Download className="size-4 shrink-0" aria-hidden />
          Files are read in your browser. Only song names, Spotify IDs and play timestamps are
          uploaded. IP addresses, devices and your email stay on your machine.
        </p>
      </Panel>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="border-line bg-surface rounded-2xl border p-4">
      <p className="text-muted text-xs">{label}</p>
      <p className="mt-1 text-2xl font-semibold">
        {typeof value === "number" ? value.toLocaleString() : value}
      </p>
    </div>
  );
}
