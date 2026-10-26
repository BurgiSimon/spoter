import { NextResponse } from "next/server";
import { z } from "zod";
import { emailSchema, findUserByEmail, startSession } from "@/lib/auth/accounts";
import { dummyVerify, verifyPassword } from "@/lib/auth/password";
import { rateLimit } from "@/lib/auth/rate-limit";
import { ApiError, body, clientIp, open } from "@/lib/api";

const input = z.object({ email: emailSchema, password: z.string().min(1).max(200) });

export const POST = open(async ({ req }) => {
  const data = await body(req, input);
  const ipOk = await rateLimit(`login-ip:${clientIp(req)}`, 30, 900);
  const emailOk = await rateLimit(`login-email:${data.email}`, 10, 900);
  if (!ipOk || !emailOk)
    throw new ApiError(429, "Too many attempts. Wait a few minutes and try again.");

  const user = await findUserByEmail(data.email);
  if (!user?.passwordHash) {
    await dummyVerify(data.password);
    throw new ApiError(401, "Wrong email or password");
  }
  if (!(await verifyPassword(user.passwordHash, data.password)))
    throw new ApiError(401, "Wrong email or password");
  return startSession(NextResponse.json({ ok: true }), user.id, req.headers.get("user-agent"));
});
