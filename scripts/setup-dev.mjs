#!/usr/bin/env node
// One-shot local setup: creates .env, makes sure Postgres is reachable (starting the
// dev container when Docker is available) and applies migrations. Safe to re-run.
import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { copyFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import pg from "pg";

const DEV_DATABASE_URL = "postgres://spoter:spoter@127.0.0.1:5433/spoter";
const isWindows = process.platform === "win32";
const ok = (msg) => console.log(`  \x1b[32m✓\x1b[0m ${msg}`);
const info = (msg) => console.log(`  \x1b[36m•\x1b[0m ${msg}`);
const fail = (msg) => {
  console.error(`\n  \x1b[31m✗ ${msg}\x1b[0m\n`);
  process.exit(1);
};

console.log("\nSetting up Spoter for local development\n");

// 1. Node version
const [major, minor] = process.versions.node.split(".").map(Number);
if (major < 22 || (major === 22 && minor < 12))
  fail(`Node 22.12+ is required (you have ${process.versions.node}).`);
ok(`Node ${process.versions.node}`);

// 2. .env
if (!existsSync(".env")) {
  copyFileSync(".env.example", ".env");
  info("created .env from .env.example");
}
let env = readFileSync(".env", "utf8");
const get = (key) => new RegExp(`^${key}=(.*)$`, "m").exec(env)?.[1]?.trim() ?? "";
const set = (key, value) => {
  const line = `${key}=${value}`;
  env = new RegExp(`^${key}=.*$`, "m").test(env)
    ? env.replace(new RegExp(`^${key}=.*$`, "m"), line)
    : `${env.trimEnd()}\n${line}\n`;
};
if (!get("ENCRYPTION_KEY")) {
  set("ENCRYPTION_KEY", randomBytes(32).toString("base64"));
  info("generated ENCRYPTION_KEY");
}
if (!get("APP_URL")) set("APP_URL", "http://127.0.0.1:3000");
if (!get("DATABASE_URL")) set("DATABASE_URL", DEV_DATABASE_URL);
writeFileSync(".env", env);
ok(".env ready");

// 3. Postgres
const databaseUrl = get("DATABASE_URL");
async function reachable() {
  const client = new pg.Client({ connectionString: databaseUrl, connectionTimeoutMillis: 2000 });
  try {
    await client.connect();
    await client.query("SELECT 1");
    return true;
  } catch {
    return false;
  } finally {
    await client.end().catch(() => {});
  }
}

if (await reachable()) {
  ok(`Postgres reachable at ${new URL(databaseUrl).host}`);
} else {
  const usesDevContainer = databaseUrl === DEV_DATABASE_URL;
  const docker = spawnSync("docker", ["info"], { stdio: "ignore", shell: isWindows });
  if (!usesDevContainer || docker.status !== 0) {
    fail(
      usesDevContainer
        ? "Postgres is not running and Docker is not available.\n    Start Docker Desktop and re-run `pnpm dev:setup`, or point DATABASE_URL in .env to your own Postgres 14+."
        : `Cannot connect to DATABASE_URL (${new URL(databaseUrl).host}). Is that Postgres running?`,
    );
  }
  info("starting the dev database container (docker-compose.dev.yml)…");
  const up = spawnSync("docker", ["compose", "-f", "docker-compose.dev.yml", "up", "-d"], {
    stdio: "inherit",
    shell: isWindows,
  });
  if (up.status !== 0) fail("`docker compose up` failed, see the output above.");
  let ready = false;
  for (let i = 0; i < 45 && !ready; i++) {
    ready = await reachable();
    if (!ready) await new Promise((r) => setTimeout(r, 1000));
  }
  if (!ready)
    fail(
      "The database container did not become ready in time. Check `docker compose -f docker-compose.dev.yml logs`.",
    );
  ok("Postgres container is up on 127.0.0.1:5433");
}

// 4. Migrations (tables + job queue)
const migrate = spawnSync("pnpm", ["db:migrate"], { stdio: "inherit", shell: isWindows });
if (migrate.status !== 0) fail("Migrations failed, see the output above.");
ok("database migrated");

// 5. Summary
const missing = [];
if (!get("LASTFM_API_KEY"))
  missing.push("LASTFM_API_KEY (better recommendations): https://www.last.fm/api/account/create");
if (!get("SPOTIFY_CLIENT_ID") || !get("SPOTIFY_CLIENT_SECRET"))
  missing.push(
    "SPOTIFY_CLIENT_ID / SPOTIFY_CLIENT_SECRET (Spotify login & sync): see docs/LOCAL_DEVELOPMENT.md",
  );

console.log(`
All set! Start the app with:

    pnpm dev:all

then open \x1b[1mhttp://127.0.0.1:3000\x1b[0m (use 127.0.0.1, not localhost).
No Spotify export yet? \`pnpm demo:export\` creates a sample one to upload.`);
if (missing.length)
  console.log(
    `\nOptional, add to .env when you have them:\n${missing.map((m) => `  - ${m}`).join("\n")}`,
  );
console.log("");
