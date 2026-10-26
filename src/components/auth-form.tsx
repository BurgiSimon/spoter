"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { api } from "@/lib/client/api";
import { Button, Notice } from "./ui";

export const OAUTH_ERRORS: Record<string, string> = {
  spotify_disabled:
    "Spotify login is not configured on this server. Use email and password, or ask the admin.",
  spotify_denied: "You cancelled the Spotify login.",
  oauth_state: "The login link expired. Please try again.",
  spotify_token: "Spotify did not return a refresh token. Please try again.",
  spotify_not_allowlisted:
    "This Spoter instance runs in Spotify's Development Mode, which only allows users the admin has added in the Spotify Developer Dashboard. Ask the admin to add you, or create an account with email and upload your Spotify data export instead.",
  spotify_in_use: "That Spotify account is already linked to another Spoter account.",
  spotify_error: "Something went wrong talking to Spotify. Please try again.",
};

/** Only same-origin paths: "//evil.com" or "/\\evil.com" would otherwise leave the site. */
function safeNext(next: string | undefined): string | null {
  if (!next) return null;
  try {
    const url = new URL(next, window.location.origin);
    return url.origin === window.location.origin ? `${url.pathname}${url.search}` : null;
  } catch {
    return null;
  }
}

function SpotifyButton({ enabled }: { enabled: boolean }) {
  if (!enabled) return null;
  return (
    <>
      <a
        href="/api/auth/spotify/login"
        className="focus-ring flex w-full items-center justify-center gap-3 rounded-full bg-[#1ed760] px-5 py-3 text-sm font-bold text-black transition hover:brightness-110"
      >
        <svg viewBox="0 0 24 24" className="size-5" aria-hidden fill="currentColor">
          <path d="M12 0a12 12 0 1 0 0 24 12 12 0 0 0 0-24Zm5.5 17.3a.75.75 0 0 1-1 .25c-2.9-1.77-6.5-2.17-10.8-1.19a.75.75 0 1 1-.33-1.46c4.67-1.07 8.68-.61 11.89 1.36.35.22.46.68.24 1.04Zm1.47-3.27a.94.94 0 0 1-1.29.31c-3.3-2.03-8.35-2.62-12.26-1.43a.94.94 0 1 1-.55-1.8c4.47-1.35 10.02-.7 13.79 1.63.44.27.58.85.31 1.29Zm.13-3.4C15.15 8.28 8.6 8.07 4.8 9.22a1.13 1.13 0 1 1-.65-2.16c4.36-1.32 11.6-1.07 16.16 1.64a1.13 1.13 0 0 1-1.21 1.93Z" />
        </svg>
        Continue with Spotify
      </a>
      <div className="text-muted my-6 flex items-center gap-3 text-xs">
        <span className="bg-line h-px flex-1" />
        or with email
        <span className="bg-line h-px flex-1" />
      </div>
    </>
  );
}

export function AuthForm({
  mode,
  error,
  next,
  spotify,
  registrationOpen,
}: {
  mode: "login" | "register";
  error?: string;
  next?: string;
  spotify: boolean;
  registrationOpen: boolean;
}) {
  const router = useRouter();
  const [message, setMessage] = useState<string | null>(
    error ? (OAUTH_ERRORS[error] ?? "Login failed.") : null,
  );
  const [loading, setLoading] = useState(false);

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    setLoading(true);
    setMessage(null);
    try {
      await api(`/api/auth/${mode}`, {
        body: {
          email: form.get("email"),
          password: form.get("password"),
          ...(mode === "register" ? { displayName: form.get("displayName") } : {}),
        },
      });
      const target = safeNext(next) ?? (mode === "register" ? "/import" : "/discover");
      router.replace(target);
      router.refresh();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Something went wrong");
      setLoading(false);
    }
  }

  const field =
    "focus-ring border-line bg-surface-2 placeholder:text-muted w-full rounded-xl border px-4 py-3 text-sm outline-none focus:border-brand";

  return (
    <div className="w-full max-w-sm">
      <h1 className="mb-2 text-2xl font-bold tracking-tight">
        {mode === "login" ? "Welcome back" : "Create your account"}
      </h1>
      <p className="text-muted mb-8 text-sm">
        {mode === "login"
          ? "Sign in to keep training your taste."
          : "It takes a minute. Bring your Spotify library or data export next."}
      </p>
      {message && (
        <div className="mb-6">
          <Notice tone="error">{message}</Notice>
        </div>
      )}
      <SpotifyButton enabled={spotify} />
      {mode === "register" && !registrationOpen ? (
        <Notice>Registration with email is closed on this instance.</Notice>
      ) : (
        <form method="post" onSubmit={submit} className="space-y-3">
          {mode === "register" && (
            <label className="block">
              <span className="sr-only">Name</span>
              <input
                name="displayName"
                required
                maxLength={60}
                placeholder="Your name"
                autoComplete="name"
                className={field}
              />
            </label>
          )}
          <label className="block">
            <span className="sr-only">Email</span>
            <input
              name="email"
              type="email"
              required
              placeholder="Email"
              autoComplete="email"
              className={field}
            />
          </label>
          <label className="block">
            <span className="sr-only">Password</span>
            <input
              name="password"
              type="password"
              required
              minLength={mode === "register" ? 10 : 1}
              placeholder={mode === "register" ? "Password (10+ characters)" : "Password"}
              autoComplete={mode === "register" ? "new-password" : "current-password"}
              className={field}
            />
          </label>
          <Button type="submit" loading={loading} className="w-full py-3">
            {mode === "login" ? "Sign in" : "Create account"}
          </Button>
        </form>
      )}
      <p className="text-muted mt-6 text-center text-sm">
        {mode === "login" ? (
          <>
            New here?{" "}
            <Link href="/register" className="text-ink font-semibold hover:underline">
              Create an account
            </Link>
          </>
        ) : (
          <>
            Already have an account?{" "}
            <Link href="/login" className="text-ink font-semibold hover:underline">
              Sign in
            </Link>
          </>
        )}
      </p>
    </div>
  );
}
