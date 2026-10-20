import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import sharp from "sharp";
import {
  assertPublicHttpUrl,
  buildApnsJwt,
  buildPassJson,
  buildPkpass,
  crc32,
  defaultIconSet,
  fetchImage,
  passAuthToken,
  sha1,
  stripSet,
  unzipStored,
  verifyPassAuthHeader,
  WalletError,
  type CardConfig,
} from "../src/index.ts";
import { decodeJwt, testSigningCerts } from "./helpers.ts";

const id = { passTypeIdentifier: "pass.com.example.test", teamIdentifier: "ABCDE12345", organizationName: "Example" };
const cfg: CardConfig = {
  businessName: "Bloom Bakery",
  cardTitle: "Bloom Club",
  totalStamps: 8,
  rewardLabel: "A free cake slice",
  brandColor: "#4B1D7A",
  address: "1 Example St",
  headerField: { label: "Visits", value: "{stamps}" },
  locations: Array.from({ length: 14 }, (_, i) => ({ latitude: 44 + i / 100, longitude: 23.8 })),
};

test("pass.json: counter, live {stamps}, colours, locations capped at 10", () => {
  const pass = buildPassJson(cfg, { serialNumber: "S1", customerName: "Ana", stamps: 3 }, id) as any;
  assert.equal(pass.storeCard.primaryFields[0].value, "3/8");
  assert.match(pass.storeCard.primaryFields[0].changeMessage, /%@/);
  assert.equal(pass.storeCard.headerFields[0].value, "3/8");
  assert.equal(pass.backgroundColor, "rgb(75, 29, 122)");
  assert.equal(pass.locations.length, 10);
  assert.equal(pass.locations[0].relevantText, "You are near Bloom Bakery!");
  assert.equal(pass.webServiceURL, undefined, "no web service without a token");
});

test("pass.json: badge mode for single-stamp cards with a header", () => {
  const badge = buildPassJson({ ...cfg, totalStamps: 1, headerField: { label: "Member", value: "Gold" } },
    { serialNumber: "S2", customerName: "Ana", stamps: 0 }, id) as any;
  assert.deepEqual(badge.storeCard.primaryFields, [{ key: "balance", label: "Member", value: "Gold" }]);
  assert.equal(badge.storeCard.headerFields, undefined);
});

test("auth token: deterministic HMAC, constant-time header check", () => {
  const secret = "a-dedicated-secret-of-32-characters!";
  const t = passAuthToken("S1", secret);
  assert.equal(t, passAuthToken("S1", secret));
  assert.equal(t.length, 32);
  assert.ok(verifyPassAuthHeader(`ApplePass ${t}`, "S1", secret));
  assert.ok(!verifyPassAuthHeader(`ApplePass ${t}`, "S2", secret));
  assert.throws(() => passAuthToken("S1", "short"));
});

test("SSRF guard refuses private, loopback and metadata hosts", async () => {
  for (const url of ["http://127.0.0.1:8080/x.png", "http://169.254.169.254/latest", "http://10.0.0.5/a", "http://192.168.1.2/a",
    "http://172.20.0.1/a", "http://localhost/a", "http://[::1]/a", "file:///etc/passwd"]) {
    assert.throws(() => assertPublicHttpUrl(url), WalletError, url);
  }
  assert.equal(assertPublicHttpUrl("https://cdn.example.com/logo.png").hostname, "cdn.example.com");
  const redirecting = (async () => new Response(null, { status: 302, headers: { location: "http://127.0.0.1/" } })) as unknown as typeof fetch;
  await assert.rejects(fetchImage("https://cdn.example.com/logo.png", redirecting), /redirects/);
});

test("image sets have Apple's exact pixel sizes", async () => {
  const icons = await defaultIconSet();
  assert.deepEqual([...icons.keys()].sort(), ["icon.png", "icon@2x.png", "icon@3x.png", "logo.png", "logo@2x.png", "logo@3x.png"]);
  assert.equal((await sharp(icons.get("icon@3x.png")!).metadata()).width, 87);
  const banner = await sharp({ create: { width: 1600, height: 900, channels: 3, background: "#333" } }).png().toBuffer();
  const strip = await stripSet(banner);
  const meta = await sharp(strip.get("strip@3x.png")!).metadata();
  assert.deepEqual([meta.width, meta.height], [1125, 369]);
});

test("zip: CRC-32 matches the reference value", () => {
  assert.equal(crc32(Buffer.from("123456789")), 0xcbf43926);
});

test(".pkpass: manifest hashes match and the PKCS#7 signature verifies", async () => {
  const certs = testSigningCerts();
  const passJson = buildPassJson(cfg, { serialNumber: crypto.randomUUID(), customerName: "Ana", stamps: 2 }, id);
  const pkpass = buildPkpass(passJson, await defaultIconSet(), certs);

  const files = unzipStored(pkpass);
  assert.ok(files.has("pass.json") && files.has("manifest.json") && files.has("signature") && files.has("icon.png"));
  const manifest = JSON.parse(files.get("manifest.json")!.toString());
  for (const [name, hash] of Object.entries(manifest)) assert.equal(sha1(files.get(name)!), hash, name);

  // Verify the detached CMS signature over manifest.json with OpenSSL (chain trust skipped: test certs).
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pkpass-"));
  fs.writeFileSync(path.join(dir, "manifest.json"), files.get("manifest.json")!);
  fs.writeFileSync(path.join(dir, "signature"), files.get("signature")!);
  try {
    execFileSync("openssl", ["cms", "-verify", "-binary", "-inform", "DER", "-noverify",
      "-in", path.join(dir, "signature"), "-content", path.join(dir, "manifest.json"), "-out", path.join(dir, "out")],
      { stdio: "pipe" });
  } catch (err: any) {
    if (err.code === "ENOENT") return; // OpenSSL not installed: hashes above are still checked
    throw new Error(`signature did not verify: ${err.stderr}`);
  }
});

test("APNs JWT is ES256 in JOSE (r||s) form and verifies", () => {
  const { privateKey, publicKey } = crypto.generateKeyPairSync("ec", { namedCurve: "P-256" });
  const jwt = buildApnsJwt({ keyId: "KEY123", teamId: "TEAM123", privateKeyPem: privateKey.export({ type: "pkcs8", format: "pem" }) as string }, 1700000000);
  const { header, payload, signingInput, signature } = decodeJwt(jwt);
  assert.deepEqual(header, { alg: "ES256", kid: "KEY123" });
  assert.deepEqual(payload, { iss: "TEAM123", iat: 1700000000 });
  assert.equal(signature.length, 64);
  assert.ok(crypto.verify("sha256", Buffer.from(signingInput), { key: publicKey, dsaEncoding: "ieee-p1363" }, signature));
});
