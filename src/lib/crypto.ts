import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";
import { env } from "./env";

function key(): Buffer {
  return Buffer.from(env().ENCRYPTION_KEY, "base64");
}

/** AES-256-GCM. Output: base64url(iv | tag | ciphertext). */
export function encrypt(plaintext: string, k: Buffer = key()): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", k, iv);
  const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), ct]).toString("base64url");
}

export function decrypt(payload: string, k: Buffer = key()): string {
  const buf = Buffer.from(payload, "base64url");
  if (buf.length < 29) throw new Error("ciphertext too short");
  const decipher = createDecipheriv("aes-256-gcm", k, buf.subarray(0, 12));
  decipher.setAuthTag(buf.subarray(12, 28));
  return Buffer.concat([decipher.update(buf.subarray(28)), decipher.final()]).toString("utf8");
}

export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}

export function sha256(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}

/** HMAC-signed value: "<value>.<sig>". Used for short-lived cookies such as OAuth state. */
export function sign(value: string, k: Buffer = key()): string {
  const sig = createHmac("sha256", k).update(value).digest("base64url");
  return `${value}.${sig}`;
}

export function unsign(signed: string, k: Buffer = key()): string | null {
  const idx = signed.lastIndexOf(".");
  if (idx <= 0) return null;
  const value = signed.slice(0, idx);
  const expected = Buffer.from(createHmac("sha256", k).update(value).digest("base64url"));
  const actual = Buffer.from(signed.slice(idx + 1));
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return null;
  return value;
}
