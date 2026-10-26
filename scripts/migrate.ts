import path from "node:path";
import { fileURLToPath } from "node:url";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import pg from "pg";
import { PgBoss } from "pg-boss";
import { ensureQueues } from "../src/lib/queue";

// Bundled to dist/migrate.mjs for the Docker image; migrations are copied next to it.
const here = path.dirname(fileURLToPath(import.meta.url));
const migrationsFolder = process.env.MIGRATIONS_DIR ?? path.resolve(here, "../drizzle");

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is required");
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    await migrate(drizzle({ client }), { migrationsFolder });
    console.log(`migrations applied from ${migrationsFolder}`);
  } finally {
    await client.end();
  }
  // Install / upgrade the job queue schema so the web app can enqueue before the worker starts.
  const boss = new PgBoss({ connectionString: url, max: 2, supervise: false, schedule: false });
  await boss.start();
  await ensureQueues(boss);
  await boss.stop({ graceful: false });
  console.log("job queues ready");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
