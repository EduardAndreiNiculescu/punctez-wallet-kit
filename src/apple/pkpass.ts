import crypto from "node:crypto";
import forge from "node-forge";
import { WalletError } from "../types.ts";
import { zipStored } from "./zip.ts";

export interface PassSigningCerts {
  /** Pass Type ID certificate (PEM), exported from the .p12 Apple gives you. */
  certificatePem: string;
  /** Its private key (PEM). */
  privateKeyPem: string;
  /** Apple WWDR intermediate certificate (PEM). */
  wwdrPem: string;
}

/** SHA-1: required by the PassKit `manifest.json` spec (not SHA-256). */
export function sha1(buf: Buffer): string {
  return crypto.createHash("sha1").update(buf).digest("hex");
}

/**
 * Detached PKCS#7 signature over `manifest.json`, with the Pass Type ID
 * certificate plus the WWDR chain: exactly what iOS verifies on install.
 * `node:crypto` only does raw signatures, not CMS/PKCS#7 envelopes, hence forge.
 */
export function signManifest(manifest: Buffer, certs: PassSigningCerts, signingTime = new Date()): Buffer {
  const cert = forge.pki.certificateFromPem(certs.certificatePem);
  const wwdr = forge.pki.certificateFromPem(certs.wwdrPem);
  const key = forge.pki.privateKeyFromPem(certs.privateKeyPem);

  const p7 = forge.pkcs7.createSignedData();
  p7.content = forge.util.createBuffer(manifest.toString("binary"));
  p7.addCertificate(cert);
  p7.addCertificate(wwdr);
  p7.addSigner({
    key,
    certificate: cert,
    digestAlgorithm: forge.pki.oids.sha256,
    authenticatedAttributes: [
      { type: forge.pki.oids.contentType, value: forge.pki.oids.data },
      { type: forge.pki.oids.messageDigest },
      // forge accepts a Date here at runtime even though its types say string.
      { type: forge.pki.oids.signingTime, value: signingTime as unknown as string },
    ],
  });
  p7.sign({ detached: true });
  return Buffer.from(forge.asn1.toDer(p7.toAsn1()).getBytes(), "binary");
}

/**
 * Assembles a `.pkpass`: `pass.json`, every image, `manifest.json` (SHA-1 of
 * each file) and `signature`, zipped uncompressed.
 */
export function buildPkpass(passJson: Record<string, unknown>, images: Map<string, Buffer>, certs: PassSigningCerts): Buffer {
  if (!images.has("icon.png")) throw new WalletError("A pass needs icon.png or iOS refuses to install it", 400);
  const passBuf = Buffer.from(JSON.stringify(passJson), "utf8");

  const manifest: Record<string, string> = { "pass.json": sha1(passBuf) };
  for (const [name, buf] of images) manifest[name] = sha1(buf);
  const manifestBuf = Buffer.from(JSON.stringify(manifest), "utf8");

  return zipStored([
    { name: "pass.json", data: passBuf },
    { name: "manifest.json", data: manifestBuf },
    { name: "signature", data: signManifest(manifestBuf, certs) },
    ...[...images].map(([name, data]) => ({ name, data })),
  ]);
}
