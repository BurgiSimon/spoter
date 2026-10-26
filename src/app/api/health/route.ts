import { sql } from "drizzle-orm";
import { connection } from "next/server";
import { db } from "@/lib/db";

export async function GET() {
  await connection();
  try {
    await db().execute(sql`SELECT 1`);
    return Response.json({ ok: true });
  } catch {
    return Response.json({ ok: false }, { status: 503 });
  }
}
