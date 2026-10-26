import { z } from "zod";

const schema = z.object({
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
  APP_URL: z.url().default("http://127.0.0.1:3000"),
  // 32 random bytes, base64 encoded. Generate with: openssl rand -base64 32
  ENCRYPTION_KEY: z
    .string()
    .refine(
      (v) => Buffer.from(v, "base64").length === 32,
      "ENCRYPTION_KEY must be 32 bytes, base64",
    ),
  SPOTIFY_CLIENT_ID: z.string().optional(),
  SPOTIFY_CLIENT_SECRET: z.string().optional(),
  LASTFM_API_KEY: z.string().optional(),
  ALLOW_REGISTRATION: z
    .enum(["true", "false"])
    .default("true")
    .transform((v) => v === "true"),
  WORKER_CONCURRENCY: z.coerce.number().int().min(1).max(16).default(2),
  LOG_LEVEL: z.enum(["trace", "debug", "info", "warn", "error", "fatal"]).default("info"),
});

export type Env = z.infer<typeof schema>;

let cached: Env | undefined;

/**
 * Parsed environment. Validated lazily so that `next build` does not need
 * runtime secrets; the first request (or worker start) fails fast instead.
 */
export function env(): Env {
  if (cached) return cached;
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  ${i.path.join(".")}: ${i.message}`).join("\n");
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  cached = parsed.data;
  return cached;
}

export function spotifyEnabled(): boolean {
  const e = env();
  return Boolean(e.SPOTIFY_CLIENT_ID && e.SPOTIFY_CLIENT_SECRET);
}

export function lastfmEnabled(): boolean {
  return Boolean(env().LASTFM_API_KEY);
}
