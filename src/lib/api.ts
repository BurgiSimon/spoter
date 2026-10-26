import { eq, lt, or, isNull, and } from "drizzle-orm";
import { unstable_rethrow } from "next/navigation";
import { connection, NextResponse, type NextRequest } from "next/server";
import { ZodError, type ZodType } from "zod";
import { SESSION_COOKIE, validateSessionToken, type SessionUser } from "./auth/session";
import { db, schema } from "./db";
import { env } from "./env";
import { logger } from "./logger";
import { SpotifyNotConnectedError } from "./spotify/client";

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly code?: string,
  ) {
    super(message);
  }
}

export function clientIp(req: NextRequest): string {
  return (
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    req.headers.get("x-real-ip") ||
    "unknown"
  );
}

/** CSRF defence for cookie-authenticated mutations: the request must come from our own origin. */
function assertSameOrigin(req: NextRequest): void {
  if (req.method === "GET" || req.method === "HEAD") return;
  const origin = req.headers.get("origin");
  const allowed = new Set([new URL(env().APP_URL).origin, req.nextUrl.origin]);
  if (!origin || !allowed.has(origin)) throw new ApiError(403, "Cross-origin request rejected");
}

export async function sessionUser(req: NextRequest): Promise<SessionUser | null> {
  const token = req.cookies.get(SESSION_COOKIE)?.value;
  return token ? validateSessionToken(token) : null;
}

async function touch(userId: string): Promise<void> {
  const hourAgo = new Date(Date.now() - 3_600_000);
  await db()
    .update(schema.users)
    .set({ lastActiveAt: new Date() })
    .where(
      and(
        eq(schema.users.id, userId),
        or(isNull(schema.users.lastActiveAt), lt(schema.users.lastActiveAt, hourAgo)),
      ),
    );
}

type Ctx<P> = { req: NextRequest; params: P };
type AuthedCtx<P> = Ctx<P> & { user: SessionUser };

function handleError(err: unknown, req: NextRequest): NextResponse {
  // Let Next.js handle its own control-flow errors (redirects, prerender bail-outs).
  unstable_rethrow(err);
  if (err instanceof ApiError)
    return NextResponse.json({ error: err.message, code: err.code }, { status: err.status });
  if (err instanceof ZodError)
    return NextResponse.json(
      { error: "Invalid request", issues: err.issues.slice(0, 5) },
      { status: 400 },
    );
  if (err instanceof SpotifyNotConnectedError)
    return NextResponse.json(
      { error: "Connect Spotify first", code: "spotify_not_connected" },
      { status: 409 },
    );
  logger.error({ err, path: req.nextUrl.pathname }, "unhandled API error");
  return NextResponse.json({ error: "Something went wrong" }, { status: 500 });
}

function wrap<P>(fn: (req: NextRequest, params: P) => Promise<Response | unknown>) {
  return async (req: NextRequest, ctx: { params: Promise<P> }) => {
    // Every API route is per-request; never let the build prerender one.
    await connection();
    try {
      const result = await fn(req, await ctx.params);
      if (result instanceof Response) return result;
      return NextResponse.json(result ?? { ok: true });
    } catch (err) {
      return handleError(err, req);
    }
  };
}

/** Route handler for signed-in users. */
export function authed<P = Record<string, never>>(
  fn: (ctx: AuthedCtx<P>) => Promise<Response | unknown>,
) {
  return wrap<P>(async (req, params) => {
    assertSameOrigin(req);
    const user = await sessionUser(req);
    if (!user) throw new ApiError(401, "Please sign in", "unauthenticated");
    void touch(user.id).catch(() => undefined);
    return fn({ req, params, user });
  });
}

/** Route handler that does not require a session. */
export function open<P = Record<string, never>>(fn: (ctx: Ctx<P>) => Promise<Response | unknown>) {
  return wrap<P>(async (req, params) => {
    assertSameOrigin(req);
    return fn({ req, params });
  });
}

export async function body<T>(req: NextRequest, schema: ZodType<T>): Promise<T> {
  let json: unknown;
  try {
    json = await req.json();
  } catch {
    throw new ApiError(400, "Expected a JSON body");
  }
  return schema.parse(json);
}
