import { hash, verify } from "@node-rs/argon2";

// OWASP-recommended argon2id parameters (19 MiB, 2 iterations).
const OPTIONS = { memoryCost: 19_456, timeCost: 2, parallelism: 1, outputLen: 32 } as const;

export function hashPassword(password: string): Promise<string> {
  return hash(password, OPTIONS);
}

export async function verifyPassword(passwordHash: string, password: string): Promise<boolean> {
  try {
    return await verify(passwordHash, password);
  } catch {
    return false;
  }
}

/** Burns the same work as a real check so unknown emails don't answer faster. */
let dummyHash: Promise<string> | undefined;
export async function dummyVerify(password: string): Promise<void> {
  dummyHash ??= hashPassword("spoter-dummy-password");
  await verifyPassword(await dummyHash, password);
}
