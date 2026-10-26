# Local development

This guide gets Spoter running on your machine with hot reload, a local database and,
optionally, your real Spotify account.

## 1. Install the tools

| Tool           | Version        | Install                                                                                   |
| -------------- | -------------- | ----------------------------------------------------------------------------------------- |
| Node.js        | 22.12 or newer | [nodejs.org](https://nodejs.org/) (LTS), or `nvm install 22`                              |
| pnpm           | 10             | `corepack enable` (ships with Node), then pnpm is available                               |
| Docker Desktop | any recent     | [docker.com](https://www.docker.com/products/docker-desktop/), only used for the database |
| Git            | any            | [git-scm.com](https://git-scm.com/)                                                       |

Don't want Docker? Any Postgres 14+ works. Point `DATABASE_URL` in `.env` at it.

## 2. Clone, install, set up

```bash
git clone https://github.com/BurgiSimon/spoter.git
cd spoter
pnpm install
pnpm dev:setup
```

`pnpm dev:setup` is safe to run again at any time. It:

1. creates `.env` from `.env.example` and generates an `ENCRYPTION_KEY`,
2. starts a Postgres container on `127.0.0.1:5433` (via `docker-compose.dev.yml`) if no database
   is reachable,
3. applies all migrations, including the job queue tables.

## 3. Run it

```bash
pnpm dev:all
```

This starts two processes side by side:

- **web**: the Next.js dev server with hot reload, on **http://127.0.0.1:3000**
- **worker**: the background job runner (imports, enrichment, recommendations), which restarts
  when you edit its code

Open **http://127.0.0.1:3000**, not `localhost`. Spotify only accepts `127.0.0.1` for local
redirect URIs, and cookies are per host. In development, `localhost` redirects to `127.0.0.1`
automatically.

## 4. Get music in

You need a library before Spoter can recommend anything. Pick one of these:

### a) Demo data (instant)

```bash
pnpm demo:export
```

This writes `spoter-demo-export.zip`, a fake Spotify export with about 25 indie and dream-pop
songs and 860 plays. Create an account in the app, go to **Import & sync**, and drop the zip
there. The worker imports it and shows its progress. The first recommendations appear after
about 1–3 minutes, and the full set after about 7.

### b) Your own Spotify data export (best results, takes days)

Request it at [spotify.com/account/privacy](https://www.spotify.com/account/privacy/). Tick
**Extended streaming history** (all years, up to 30 days) and/or **Account data** (about 5 days).
When the email arrives, upload the zip on **Import & sync**.

### c) Connect Spotify directly (needs a Spotify app)

1. Open the [Spotify Developer Dashboard](https://developer.spotify.com/dashboard) and choose
   **Create app**.
   - **Redirect URI:** `http://127.0.0.1:3000/api/auth/spotify/callback`
   - **Which API/SDKs:** tick **Web API**
2. Open the app's **Settings** and copy the **Client ID** and **Client secret** into `.env`:
   ```env
   SPOTIFY_CLIENT_ID=...
   SPOTIFY_CLIENT_SECRET=...
   ```
3. Under **User Management**, add the Spotify account email of everyone who should be able to
   log in (up to 5). The app owner needs **Spotify Premium**, which Spotify requires for
   Development Mode apps.
4. Restart `pnpm dev:all`, then use **Continue with Spotify** on the login page.

## 5. Optional: Last.fm key (better recommendations)

Create a free API account at [last.fm/api/account/create](https://www.last.fm/api/account/create).
Any app name works, and the callback URL can stay empty. Put the key in `.env`:

```env
LASTFM_API_KEY=...
```

Restart the worker. It adds track-level tags, "similar tracks" and tag charts. Without the key,
Spoter uses MusicBrainz, ListenBrainz and Deezer, which work but are less precise.

## Everyday commands

| Command                                                                           | What it does                                                                                 |
| --------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| `pnpm dev:all`                                                                    | Web + worker with hot reload                                                                 |
| `pnpm dev` / `pnpm dev:worker`                                                    | The two processes separately                                                                 |
| `pnpm dev:db`                                                                     | Start only the dev database container                                                        |
| `pnpm db:migrate`                                                                 | Apply new migrations                                                                         |
| `pnpm db:generate --name <change>`                                                | Create a migration after editing `src/lib/db/schema.ts`                                      |
| `pnpm db:studio`                                                                  | Browse the database in Drizzle Studio                                                        |
| `pnpm lint && pnpm typecheck && pnpm test`                                        | The checks CI runs                                                                           |
| `TEST_DATABASE_URL=postgres://spoter:spoter@127.0.0.1:5433/spoter_test pnpm test` | Also run the Postgres integration tests (create the `spoter_test` database first, see below) |

Create the test database once:

```bash
docker compose -f docker-compose.dev.yml exec db createdb -U spoter spoter_test
```

## Troubleshooting

| Problem                                             | Fix                                                                                                                                    |
| --------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| Buttons do nothing, or the page looks unstyled      | The app's JavaScript didn't load. Use http://127.0.0.1:3000, make sure nothing else uses port 3000, and check the terminal for errors. |
| `Spotify login is not configured`                   | `SPOTIFY_CLIENT_ID` or `SPOTIFY_CLIENT_SECRET` is missing in `.env`. Restart after editing.                                            |
| Spotify says _INVALID_CLIENT: Invalid redirect URI_ | The redirect URI in the dashboard must be exactly `http://127.0.0.1:3000/api/auth/spotify/callback`.                                   |
| _only allows users the admin has added_             | Add your Spotify email under **User Management** in the Spotify dashboard.                                                             |
| Import stays at "Waiting for a worker…"             | The worker isn't running. Start it with `pnpm dev:all` or `pnpm dev:worker`.                                                           |
| `Cannot connect to DATABASE_URL`                    | Start Docker Desktop, then `pnpm dev:db` (or re-run `pnpm dev:setup`).                                                                 |
| Port 5433 is taken                                  | Run `SPOTER_DB_PORT=5434 pnpm dev:db` and change the port in `DATABASE_URL`.                                                           |
| Start completely fresh                              | `docker compose -f docker-compose.dev.yml down -v`, then `pnpm dev:setup`.                                                             |
