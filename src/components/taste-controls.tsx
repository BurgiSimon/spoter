"use client";

import { X } from "lucide-react";
import { useRef, useState, type FormEvent } from "react";
import { api } from "@/lib/client/api";
import type { UserSettings } from "@/lib/types";
import { Button, Notice } from "./ui";

export function TasteControls({
  initial,
  blocked,
}: {
  initial: UserSettings;
  blocked: { id: string; name: string }[];
}) {
  const [settings, setSettings] = useState(initial);
  const [artists, setArtists] = useState(blocked);
  const [status, setStatus] = useState<string | null>(null);
  const [tag, setTag] = useState("");
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  function save(patch: Partial<UserSettings>) {
    const next = { ...settings, ...patch };
    setSettings(next);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      api("/api/settings", { method: "PUT", body: patch })
        .then(() => setStatus("Saved"))
        .catch((err: Error) => setStatus(err.message));
    }, 400);
  }

  function addTag(e: FormEvent) {
    e.preventDefault();
    const t = tag.trim().toLowerCase();
    if (!t || settings.blockedTags.includes(t)) return;
    save({ blockedTags: [...settings.blockedTags, t] });
    setTag("");
  }

  async function unblock(id: string) {
    setArtists((a) => a.filter((x) => x.id !== id));
    await api("/api/artists/block", { body: { artistId: id, blocked: false } }).catch(
      () => undefined,
    );
  }

  return (
    <div className="space-y-6">
      <Slider
        label="Adventurousness"
        left="Stay close to what I know"
        right="Surprise me"
        value={settings.adventurousness}
        min={0}
        max={1}
        onChange={(v) => save({ adventurousness: v })}
      />
      <Slider
        label="Popularity"
        left="Underground"
        right="Mainstream"
        value={settings.popularity}
        min={-1}
        max={1}
        onChange={(v) => save({ popularity: v })}
      />
      <div className="grid gap-3 sm:grid-cols-2">
        <Toggle
          label="Include explicit songs"
          checked={settings.allowExplicit}
          onChange={(v) => save({ allowExplicit: v })}
        />
        <Toggle
          label="Deeper cuts from artists I know"
          checked={settings.includeKnownArtists}
          onChange={(v) => save({ includeKnownArtists: v })}
        />
      </div>
      <div>
        <p className="mb-2 text-sm font-medium">Never recommend these tags</p>
        <form onSubmit={addTag} className="flex gap-2">
          <input
            value={tag}
            onChange={(e) => setTag(e.target.value)}
            maxLength={40}
            placeholder="e.g. country"
            className="focus-ring border-line bg-surface-2 placeholder:text-muted w-full max-w-xs rounded-full border px-4 py-2 text-sm"
          />
          <Button type="submit" variant="secondary">
            Add
          </Button>
        </form>
        <Chips
          items={settings.blockedTags.map((t) => ({ id: t, name: t }))}
          onRemove={(id) => save({ blockedTags: settings.blockedTags.filter((x) => x !== id) })}
        />
      </div>
      <div>
        <p className="mb-2 text-sm font-medium">Blocked artists</p>
        {artists.length ? (
          <Chips items={artists} onRemove={unblock} />
        ) : (
          <p className="text-muted text-sm">None. Use “Never this artist” while swiping.</p>
        )}
      </div>
      <Notice>
        Sliders apply instantly. Tag, explicit and artist filters apply to new candidates the next
        time recommendations refresh.
      </Notice>
      {status && (
        <p className="text-muted text-xs" aria-live="polite">
          {status}
        </p>
      )}
    </div>
  );
}

function Slider(props: {
  label: string;
  left: string;
  right: string;
  value: number;
  min: number;
  max: number;
  onChange: (v: number) => void;
}) {
  return (
    <label className="block">
      <span className="text-sm font-medium">{props.label}</span>
      <input
        type="range"
        min={props.min}
        max={props.max}
        step={0.05}
        value={props.value}
        onChange={(e) => props.onChange(Number(e.target.value))}
        className="mt-3 w-full"
      />
      <span className="text-muted mt-1 flex justify-between text-xs">
        <span>{props.left}</span>
        <span>{props.right}</span>
      </span>
    </label>
  );
}

function Toggle({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="border-line bg-surface-2 flex cursor-pointer items-center justify-between gap-3 rounded-2xl border px-4 py-3">
      <span className="text-sm">{label}</span>
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="peer sr-only"
      />
      <span className="bg-surface-3 peer-checked:bg-brand peer-focus-visible:outline-brand relative h-6 w-11 shrink-0 rounded-full transition peer-focus-visible:outline-2 after:absolute after:top-0.5 after:left-0.5 after:size-5 after:rounded-full after:bg-white after:transition peer-checked:after:translate-x-5" />
    </label>
  );
}

function Chips({
  items,
  onRemove,
}: {
  items: { id: string; name: string }[];
  onRemove: (id: string) => void;
}) {
  if (!items.length) return null;
  return (
    <ul className="mt-3 flex flex-wrap gap-2">
      {items.map((i) => (
        <li
          key={i.id}
          className="bg-surface-3 flex items-center gap-1 rounded-full py-1 pr-1 pl-3 text-sm capitalize"
        >
          {i.name}
          <button
            type="button"
            onClick={() => onRemove(i.id)}
            aria-label={`Remove ${i.name}`}
            className="focus-ring text-muted hover:text-ink grid size-6 place-items-center rounded-full"
          >
            <X className="size-3.5" />
          </button>
        </li>
      ))}
    </ul>
  );
}
