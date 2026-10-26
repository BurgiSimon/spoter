import { gunzipSync, gzipSync } from "node:zlib";
import { ApiError, authed } from "@/lib/api";
import { rateLimit } from "@/lib/auth/rate-limit";
import { db, schema } from "@/lib/db";
import { exportPayloadSchema } from "@/lib/pipeline/ingest";
import { createJob } from "@/lib/pipeline/jobs";
import { enqueueIngest } from "@/lib/queue";

const MAX_UPLOAD_BYTES = 40 * 1024 * 1024;

/**
 * Receives the gzipped JSON produced by the in-browser export parser, validates
 * it and hands it to the worker.
 */
export const POST = authed(async ({ req, user }) => {
  if (!(await rateLimit(`import:${user.id}`, 5, 3600)))
    throw new ApiError(429, "Too many imports, try again later");
  const length = Number(req.headers.get("content-length") ?? 0);
  if (length > MAX_UPLOAD_BYTES) throw new ApiError(413, "Upload too large");
  const buf = Buffer.from(await req.arrayBuffer());
  if (buf.length > MAX_UPLOAD_BYTES) throw new ApiError(413, "Upload too large");

  let json: unknown;
  try {
    json = JSON.parse(gunzipSync(buf, { maxOutputLength: 160 * 1024 * 1024 }).toString("utf8"));
  } catch {
    throw new ApiError(400, "Could not read the upload");
  }
  const payload = exportPayloadSchema.parse(json);
  if (!payload.tracks.length) throw new ApiError(400, "No songs found in these files");

  const jobId = await createJob(user.id, "ingest");
  await db()
    .insert(schema.importPayloads)
    .values({ jobId, data: gzipSync(Buffer.from(JSON.stringify(payload))) });
  await enqueueIngest({ userId: user.id, jobId });
  return { jobId, tracks: payload.tracks.length, plays: payload.plays.length };
});
