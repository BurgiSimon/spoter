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
