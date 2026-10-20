import assert from "node:assert/strict";
import crypto from "node:crypto";
import { test } from "node:test";
import {
  detectWalletPlatform,
  googleId,
  GoogleWalletClient,
  loyaltyClassPayload,
  loyaltyObjectPayload,
  saveToWalletUrl,
  signRs256,
  WalletError,
  type CardConfig,
} from "../src/index.ts";
import { decodeJwt, rsaKeyPair } from "./helpers.ts";

const { privateKey, publicKey } = rsaKeyPair();
const sa = { email: "signer@example-project.iam.gserviceaccount.com", privateKeyPem: privateKey };
const cfg: CardConfig = {
  businessName: "Bloom Bakery",
  cardTitle: "Bloom Club",
  totalStamps: 8,
  brandColor: "#4B1D7A",
  phone: "+40700000000",
  rewardLabel: "Happy birthday {name}, the cake is on us",
  auxiliaryField: { label: "Visits", value: "{stamps}" },
};

test("ids are sanitised and prefixed with the issuer", () => {
  assert.equal(googleId("3388000000000000000", "business_1a2b-3c"), "3388000000000000000.business_1a2b-3c");
  assert.equal(googleId("1", "a b/c"), "1.a_b_c");
});

test("class payload: fallback logo, review status, links; {name} reward stays off the shared class", () => {
  const c = loyaltyClassPayload(cfg, "1.business_x", { defaultLogoUrl: "https://example.com/logo.png" }) as any;
  assert.equal(c.programLogo.sourceUri.uri, "https://example.com/logo.png");
  assert.equal(c.reviewStatus, "UNDER_REVIEW");
  assert.equal(c.linksModuleData.uris[0].uri, "tel:+40700000000");
  assert.equal(c.textModulesData, undefined);
});

test("object payload: QR, short code, live counter, personalised reward", () => {
  const o = loyaltyObjectPayload({ issuerId: "1", classId: "1.business_x", fullName: "Ana", stamps: 3, codePrefix: "BLOOM", cfg }) as any;
  assert.match(o.id, /^1\.customer_[0-9a-f]{32}$/);
  assert.equal(o.barcode.value, o.id);
  assert.match(o.barcode.alternateText, /^BLOOM-[0-9A-F]{6}$/);
  assert.equal(o.loyaltyPoints.balance.int, 3);
  assert.equal(o.secondaryLoyaltyPoints.balance.string, "3");
  assert.equal(o.textModulesData[0].body, "Happy birthday Ana, the cake is on us");
});

test("save link JWT is RS256-signed and verifiable", () => {
  const url = saveToWalletUrl(sa, ["1.customer_abc"]);
  assert.ok(url.startsWith("https://pay.google.com/gp/v/save/"));
  const { header, payload, signingInput, signature } = decodeJwt(url.split("/save/")[1]);
  assert.equal(header.alg, "RS256");
  assert.equal(payload.typ, "savetowallet");
  assert.deepEqual(payload.payload.loyaltyObjects, [{ id: "1.customer_abc" }]);
  assert.ok(crypto.verify("RSA-SHA256", Buffer.from(signingInput), publicKey, signature));
  // keys stored in env vars with literal \n still work
  assert.ok(signRs256({ a: 1 }, privateKey.replace(/\n/g, "\\n")));
});

/** Fake Google: token endpoint + a scripted sequence of API responses. */
function fakeFetch(script: Array<{ status: number; body?: unknown; headers?: Record<string, string> }>) {
  const calls: Array<{ url: string; method: string; body?: any }> = [];
  const impl = (async (url: string, init: RequestInit = {}) => {
    if (String(url).includes("oauth2.googleapis.com")) {
      return new Response(JSON.stringify({ access_token: "tok", expires_in: 3600 }), { status: 200 });
    }
    calls.push({ url: String(url), method: init.method ?? "GET", body: init.body ? JSON.parse(String(init.body)) : undefined });
    const next = script.shift() ?? { status: 200, body: {} };
    return new Response(next.body === undefined ? "" : JSON.stringify(next.body), { status: next.status, headers: next.headers });
  }) as unknown as typeof fetch;
  return { impl, calls };
}

test("client retries 503 with Retry-After, then succeeds", async () => {
  const waits: number[] = [];
  const { impl, calls } = fakeFetch([{ status: 503, headers: { "retry-after": "2" } }, { status: 200, body: { loyaltyPoints: { balance: { int: 4 } } } }]);
  const client = new GoogleWalletClient({ serviceAccount: sa, fetchImpl: impl, sleep: async (ms) => void waits.push(ms) });
  assert.equal(await client.getStamps("1.customer_a"), 4);
  assert.deepEqual(waits, [2000]);
  assert.equal(calls.length, 2);
});

test("client gives up after maxAttempts and surfaces the error body", async () => {
  const { impl } = fakeFetch([{ status: 503 }, { status: 503 }, { status: 503, body: { error: "busy" } }]);
  const client = new GoogleWalletClient({ serviceAccount: sa, fetchImpl: impl, sleep: async () => {} });
  await assert.rejects(client.getStamps("x"), (e: unknown) => e instanceof WalletError && e.status === 503);
});

test("upsertClass falls back to PATCH on 409", async () => {
  const { impl, calls } = fakeFetch([{ status: 409, body: { error: "exists" } }, { status: 200, body: {} }]);
  const client = new GoogleWalletClient({ serviceAccount: sa, fetchImpl: impl, sleep: async () => {} });
  await client.upsertClass({ id: "1.business_x" });
  assert.deepEqual(calls.map((c) => c.method), ["POST", "PATCH"]);
  assert.ok(calls[1].url.endsWith("/loyaltyClass/1.business_x"));
});

test("addStamp reads, increments and reports completion", async () => {
  const { impl, calls } = fakeFetch([{ status: 200, body: { loyaltyPoints: { balance: { int: 7 } } } }, { status: 200, body: {} }]);
  const client = new GoogleWalletClient({ serviceAccount: sa, fetchImpl: impl, sleep: async () => {} });
  assert.deepEqual(await client.addStamp("o", 8), { before: 7, after: 8, completed: true });
  assert.equal(calls[1].body.loyaltyPoints.balance.int, 8);
});

test("platform detection", () => {
  assert.equal(detectWalletPlatform("Mozilla/5.0 (Linux; Android 14) Chrome/126"), "google");
  assert.equal(detectWalletPlatform("Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)"), "apple");
  assert.equal(detectWalletPlatform(null), "apple");
});
