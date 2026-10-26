import { NextResponse, type NextRequest } from "next/server";

const SESSION_COOKIE = "spoter_session";
const APP_PATHS = [
  "/discover",
  "/duel",
  "/rank",
  "/for-you",
  "/likes",
  "/taste",
  "/import",
  "/settings",
];

/**
 * Optimistic auth gate (cookie presence only; every page and API route verifies the
 * session against the database). Also slides the session cookie's lifetime.
 */
export function proxy(req: NextRequest) {
  // Local dev: keep everyone on APP_URL's host (127.0.0.1). Cookies set on "localhost"
  // are invisible on 127.0.0.1, which would break sign-in and the Spotify callback.
  if (process.env.NODE_ENV === "development" && process.env.APP_URL && req.method === "GET") {
    const app = new URL(process.env.APP_URL);
    // nextUrl reports "localhost" in dev whatever was requested; the Host header doesn't.
    const requested = new URL(`http://${req.headers.get("host") ?? "localhost"}`).hostname;
    if (requested === "localhost" && app.hostname !== "localhost") {
      const url = new URL(req.nextUrl.pathname + req.nextUrl.search, app).toString();
      // Not a 3xx: Next relativizes Location headers that point at its own dev server,
      // which would bounce the browser straight back to localhost.
      const safe = url.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
      return new NextResponse(
        `<!doctype html><meta http-equiv="refresh" content="0;url=${safe}"><a href="${safe}">Continue to ${safe}</a>`,
        { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } },
      );
    }
  }
  const token = req.cookies.get(SESSION_COOKIE)?.value;
  const path = req.nextUrl.pathname;
  if (!token && APP_PATHS.some((p) => path === p || path.startsWith(`${p}/`))) {
    const url = new URL("/login", req.url);
    url.searchParams.set("next", path);
    return NextResponse.redirect(url);
  }
  const res = NextResponse.next();
  if (token) {
    res.cookies.set(SESSION_COOKIE, token, {
      httpOnly: true,
      sameSite: "lax",
      // Behind a TLS-terminating proxy the inner request is plain HTTP; trust APP_URL instead.
      secure: (process.env.APP_URL ?? "").startsWith("https://"),
      path: "/",
      maxAge: 30 * 86_400,
    });
  }
  return res;
}

export const config = {
  matcher: ["/((?!api|_next/static|_next/image|icon.svg|favicon.ico|robots.txt).*)"],
};
