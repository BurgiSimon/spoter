"use client";

export class ClientApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly code?: string,
  ) {
    super(message);
  }
}

/** Small fetch wrapper for our JSON API. */
export async function api<T>(
  path: string,
  init: { method?: string; body?: unknown } = {},
): Promise<T> {
  const res = await fetch(path, {
    method: init.method ?? (init.body === undefined ? "GET" : "POST"),
    headers: init.body === undefined ? undefined : { "Content-Type": "application/json" },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
    credentials: "same-origin",
  });
  const data = (await res.json().catch(() => ({}))) as T & { error?: string; code?: string };
  if (!res.ok) {
    if (res.status === 401 && typeof window !== "undefined") {
      // Session expired mid-use: a full navigation also clears client caches.
      window.location.assign(
        new URL(
          `/login?next=${encodeURIComponent(window.location.pathname)}`,
          window.location.origin,
        ),
      );
    }
    throw new ClientApiError(res.status, data.error ?? `Request failed (${res.status})`, data.code);
  }
  return data;
}
