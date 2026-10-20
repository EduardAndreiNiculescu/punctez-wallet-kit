import crypto from "node:crypto";
import { WalletError } from "../types.ts";

export interface ServiceAccount {
  email: string;
  /** PEM private key. Literal `\n` sequences (as stored in env vars) are accepted. */
  privateKeyPem: string;
}

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const SCOPE = "https://www.googleapis.com/auth/wallet_object.issuer";

const b64url = (v: Buffer | string) => Buffer.from(v).toString("base64url");
export const normalizeKey = (pem: string) => pem.replace(/\\n/g, "\n");

/** RS256 JWT signed with `node:crypto`: no `googleapis` SDK for a handful of HTTP calls. */
export function signRs256(claims: Record<string, unknown>, privateKeyPem: string): string {
  const header = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const body = b64url(JSON.stringify(claims));
  const sig = crypto.createSign("RSA-SHA256").update(`${header}.${body}`).sign(normalizeKey(privateKeyPem));
  return `${header}.${body}.${b64url(sig)}`;
}

/**
 * OAuth2 access tokens through the service-account JWT-bearer flow, cached
 * in memory until a minute before expiry. Serverless instances are short
 * lived, so a per-instance cache is enough and saves a round trip per call.
 */
export function createTokenProvider(sa: ServiceAccount, fetchImpl: typeof fetch = fetch): () => Promise<string> {
  let cached: { value: string; expiresAt: number } | null = null;
  return async () => {
    if (cached && cached.expiresAt > Date.now() + 60_000) return cached.value;
    const now = Math.floor(Date.now() / 1000);
    const assertion = signRs256({ iss: sa.email, scope: SCOPE, aud: TOKEN_URL, iat: now, exp: now + 3600 }, sa.privateKeyPem);
    const res = await fetchImpl(TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion }),
    });
    if (!res.ok) throw new WalletError("Google OAuth refused the service account", res.status, await res.text());
    const json = (await res.json()) as { access_token: string; expires_in: number };
    cached = { value: json.access_token, expiresAt: Date.now() + json.expires_in * 1000 };
    return json.access_token;
  };
}

/** "Add to Google Wallet" link for objects that already exist on Google's side. */
export function saveToWalletUrl(sa: ServiceAccount, loyaltyObjectIds: string[]): string {
  const jwt = signRs256(
    {
      iss: sa.email,
      aud: "google",
      typ: "savetowallet",
      iat: Math.floor(Date.now() / 1000),
      payload: { loyaltyObjects: loyaltyObjectIds.map((id) => ({ id })) },
    },
    sa.privateKeyPem,
  );
  return `https://pay.google.com/gp/v/save/${jwt}`;
}
