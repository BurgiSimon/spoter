"use client";

import { Download, LogOut, Trash } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { api } from "@/lib/client/api";
import { Button, Notice, Panel } from "./ui";

interface Props {
  displayName: string;
  email: string | null;
  hasPassword: boolean;
  spotify: string | null;
}

const field =
  "focus-ring border-line bg-surface-2 placeholder:text-muted w-full rounded-xl border px-4 py-2.5 text-sm";

export function SettingsPanel({ displayName, email, hasPassword, spotify }: Props) {
  const router = useRouter();
  const [msg, setMsg] = useState<Record<string, { tone: "success" | "error"; text: string }>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const say = (key: string, tone: "success" | "error", text: string) =>
    setMsg((m) => ({ ...m, [key]: { tone, text } }));

  async function run(key: string, fn: () => Promise<void>) {
    setBusy(key);
    try {
      await fn();
    } catch (err) {
      say(key, "error", err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setBusy(null);
    }
  }

  function saveName(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const name = String(new FormData(e.currentTarget).get("displayName") ?? "");
    void run("name", async () => {
      await api("/api/account", { method: "PATCH", body: { displayName: name } });
      say("name", "success", "Saved");
      router.refresh();
    });
  }

  function savePassword(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const target = e.currentTarget;
    void run("password", async () => {
      await api("/api/account/password", {
        method: "PUT",
        body: {
          email: form.get("email") || undefined,
          currentPassword: form.get("currentPassword") || undefined,
          newPassword: form.get("newPassword"),
        },
      });
      target.reset();
      say("password", "success", "Password updated. Other devices were signed out.");
      router.refresh();
    });
  }

  return (
    <div className="space-y-6">
      <Panel>
        <h2 className="mb-4 font-semibold">Profile</h2>
        <form onSubmit={saveName} className="flex max-w-md gap-2">
          <input
            name="displayName"
            defaultValue={displayName}
            maxLength={60}
            required
            className={field}
            aria-label="Display name"
          />
          <Button type="submit" variant="secondary" loading={busy === "name"}>
            Save
          </Button>
        </form>
        {msg.name && <p className="text-muted mt-2 text-xs">{msg.name.text}</p>}
      </Panel>

      <Panel>
        <h2 className="mb-1 font-semibold">
          {hasPassword ? "Change password" : "Add email & password"}
        </h2>
        <p className="text-muted mb-4 text-xs">
          {hasPassword
            ? `Signed in as ${email}.`
            : "So you can sign in without Spotify, and disconnect it if you want."}
        </p>
        <form onSubmit={savePassword} className="grid max-w-md gap-3">
          {!hasPassword && (
            <input
              name="email"
              type="email"
              required
              placeholder="Email"
              defaultValue={email ?? ""}
              autoComplete="email"
              className={field}
            />
          )}
          {hasPassword && (
            <input
              name="currentPassword"
              type="password"
              required
              placeholder="Current password"
              autoComplete="current-password"
              className={field}
            />
          )}
          <input
            name="newPassword"
            type="password"
            required
            minLength={10}
            placeholder="New password (10+ characters)"
            autoComplete="new-password"
            className={field}
          />
          <Button type="submit" loading={busy === "password"} className="w-fit">
            Save password
          </Button>
        </form>
        {msg.password && (
          <div className="mt-3">
            <Notice tone={msg.password.tone}>{msg.password.text}</Notice>
          </div>
        )}
      </Panel>

      <Panel>
        <h2 className="mb-1 font-semibold">Spotify</h2>
        <p className="text-muted mb-4 text-sm">
          {spotify ? `Connected as ${spotify}.` : "Not connected."}
        </p>
        {spotify ? (
          <Button
            variant="secondary"
            loading={busy === "spotify"}
            onClick={() =>
              run("spotify", async () => {
                await api("/api/spotify/disconnect", { method: "POST" });
                router.refresh();
              })
            }
          >
            Disconnect Spotify
          </Button>
        ) : (
          <a
            href="/api/auth/spotify/login"
            className="focus-ring rounded-full bg-[#1ed760] px-5 py-2.5 text-sm font-bold text-black"
          >
            Connect Spotify
          </a>
        )}
        {msg.spotify && (
          <div className="mt-3">
            <Notice tone={msg.spotify.tone}>{msg.spotify.text}</Notice>
          </div>
        )}
      </Panel>

      <Panel>
        <h2 className="mb-1 font-semibold">Your data</h2>
        <p className="text-muted mb-4 text-sm">
          Download everything Spoter stores about you, or delete your account for good.
        </p>
        <div className="flex flex-wrap gap-2">
          <a
            href="/api/account/export"
            className="focus-ring bg-surface-3 hover:bg-line inline-flex items-center gap-2 rounded-full px-5 py-2.5 text-sm font-semibold"
          >
            <Download className="size-4" aria-hidden /> Export my data
          </a>
          <Button
            variant="secondary"
            onClick={() =>
              run("logout", async () => {
                await api("/api/auth/logout", { method: "POST" });
                router.replace("/");
                router.refresh();
              })
            }
          >
            <LogOut className="size-4" aria-hidden /> Sign out
          </Button>
          <Button
            variant="danger"
            loading={busy === "delete"}
            onClick={() => {
              const answer = window.prompt(
                "This permanently deletes your account, history and taste model. Type DELETE to confirm.",
              );
              if (answer !== "DELETE") return;
              void run("delete", async () => {
                await api("/api/account", { method: "DELETE", body: { confirm: "DELETE" } });
                router.replace("/");
                router.refresh();
              });
            }}
          >
            <Trash className="size-4" aria-hidden /> Delete account
          </Button>
        </div>
        {msg.delete && (
          <div className="mt-3">
            <Notice tone={msg.delete.tone}>{msg.delete.text}</Notice>
          </div>
        )}
      </Panel>
    </div>
  );
}
