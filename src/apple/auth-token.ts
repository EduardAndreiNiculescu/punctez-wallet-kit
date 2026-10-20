import crypto from "node:crypto";

/**
 * Per-pass authentication token for the PassKit web service, derived
 * deterministically from the serial number with an HMAC instead of being
 * stored: it can be recomputed both when the pass is generated and when the
 * phone calls back, with no database write in between.
 *
 * Use a dedicated secret. The token sits in plain text on every phone that
 * has the card, so it must never be derived from a database master key.
 */
export function passAuthToken(serialNumber: string, secret: string): string {
  if (!secret || secret.length < 16) throw new Error("passAuthToken needs a dedicated secret of at least 16 characters");
  return crypto.createHmac("sha256", secret).update(serialNumber).digest("hex").slice(0, 32);
}

/** Constant-time check of the `Authorization: ApplePass <token>` header iOS sends. */
export function verifyPassAuthHeader(header: string | null | undefined, serialNumber: string, secret: string): boolean {
  const token = header?.startsWith("ApplePass ") ? header.slice(10) : "";
  const expected = passAuthToken(serialNumber, secret);
  return token.length === expected.length && crypto.timingSafeEqual(Buffer.from(token), Buffer.from(expected));
}
