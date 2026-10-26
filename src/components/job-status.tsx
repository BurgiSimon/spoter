"use client";

import { LoaderCircle } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "@/lib/client/api";
import type { Job } from "@/lib/client/types";

/** Polls background jobs and calls `onFinished` when one completes. `poke()` polls right away. */
export function useJobs(onFinished?: (job: Job) => void) {
  const [jobs, setJobs] = useState<Job[]>([]);
  const seen = useRef(new Map<string, Job["status"]>());
  const callback = useRef(onFinished);
  const tickRef = useRef<() => void>(() => undefined);
  useEffect(() => {
    callback.current = onFinished;
  });

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    let alive = true;
    const tick = async () => {
      clearTimeout(timer);
      try {
        const res = await api<{ jobs: Job[] }>("/api/jobs");
        if (!alive) return;
        setJobs(res.jobs);
        for (const j of res.jobs) {
          const prev = seen.current.get(j.id);
          if (prev && prev !== j.status && (j.status === "done" || j.status === "failed"))
            callback.current?.(j);
          seen.current.set(j.id, j.status);
        }
        const busy = res.jobs.some((j) => j.status === "queued" || j.status === "running");
        timer = setTimeout(tick, busy ? 2500 : 15000);
      } catch {
        timer = setTimeout(tick, 15000);
      }
    };
    tickRef.current = () => void tick();
    void tick();
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, []);

  const poke = useCallback(() => tickRef.current(), []);
  const active = jobs.find((j) => j.status === "queued" || j.status === "running");
  return { jobs, active, poke };
}

export function JobProgress({ job }: { job: Job }) {
  const pct =
    job.progress && job.progress.total > 0
      ? Math.min(100, (job.progress.done / job.progress.total) * 100)
      : null;
  return (
    <div className="border-line bg-surface rounded-2xl border p-4" role="status" aria-live="polite">
      <div className="flex items-center gap-3">
        <LoaderCircle className="text-brand size-5 shrink-0 animate-spin" aria-hidden />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold">
            {job.status === "queued" ? "Waiting for a worker…" : (job.progress?.step ?? "Working…")}
          </p>
          {job.progress?.message && (
            <p className="text-muted truncate text-xs">{job.progress.message}</p>
          )}
        </div>
        {pct !== null && (
          <span className="text-muted text-xs tabular-nums">{Math.round(pct)}%</span>
        )}
      </div>
      <div className="bg-surface-3 mt-3 h-1.5 overflow-hidden rounded-full">
        <div
          className={`bg-brand h-full rounded-full transition-all duration-500 ${pct === null ? "w-1/3 animate-pulse" : ""}`}
          style={pct === null ? undefined : { width: `${Math.max(pct, 3)}%` }}
        />
      </div>
    </div>
  );
}
