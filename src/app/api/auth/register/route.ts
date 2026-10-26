import { NextResponse } from "next/server";
import { z } from "zod";
import { emailSchema, findUserByEmail, passwordSchema, startSession } from "@/lib/auth/accounts";
import { hashPassword } from "@/lib/auth/password";
import { rateLimit } from "@/lib/auth/rate-limit";
import { ApiError, body, clientIp, open } from "@/lib/api";
import { db, schema } from "@/lib/db";
import { env } from "@/lib/env";

const input = z.object({
  email: emailSchema,
  password: passwordSchema,
  displayName: z.string().trim().min(1).max(60),
});

export const POST = open(async ({ req }) => {
  if (!env().ALLOW_REGISTRATION) throw new ApiError(403, "Registration is closed on this instance");
  if (!(await rateLimit(`register:${clientIp(req)}`, 10, 3600)))
    throw new ApiError(429, "Too many sign-ups, try again later");
  const data = await body(req, input);
  if (await findUserByEmail(data.email))
    throw new ApiError(409, "An account with this email already exists");
  const [user] = await db()
    .insert(schema.users)
    .values({
      email: data.email,
      passwordHash: await hashPassword(data.password),
      displayName: data.displayName,
    })
    .returning({ id: schema.users.id });
  return startSession(NextResponse.json({ ok: true }), user!.id, req.headers.get("user-agent"));
});
