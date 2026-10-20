import crypto from "node:crypto";
import forge from "node-forge";
import type { PassSigningCerts } from "../src/index.ts";

function makeCert(subjectCN: string, issuer: { cert?: forge.pki.Certificate; key?: forge.pki.rsa.PrivateKey }, isCA: boolean) {
  const keys = forge.pki.rsa.generateKeyPair(2048);
  const cert = forge.pki.createCertificate();
  cert.publicKey = keys.publicKey;
  cert.serialNumber = "0" + crypto.randomBytes(8).toString("hex");
  cert.validity.notBefore = new Date(Date.now() - 60_000);
  cert.validity.notAfter = new Date(Date.now() + 86_400_000);
  cert.setSubject([{ name: "commonName", value: subjectCN }]);
  cert.setIssuer(issuer.cert ? issuer.cert.subject.attributes : [{ name: "commonName", value: subjectCN }]);
  cert.setExtensions([{ name: "basicConstraints", cA: isCA }]);
  cert.sign(issuer.key ?? keys.privateKey, forge.md.sha256.create());
  return { cert, key: keys.privateKey };
}

/**
 * Self-signed stand-ins for Apple's certificates. They produce a structurally
 * valid, verifiable `.pkpass`; a real iPhone will still refuse it because the
 * chain does not end at Apple's root.
 */
export function testSigningCerts(): PassSigningCerts {
  const wwdr = makeCert("Test WWDR (not Apple)", {}, true);
  const leaf = makeCert("Pass Type ID: pass.com.example.test", { cert: wwdr.cert, key: wwdr.key }, false);
  return {
    certificatePem: forge.pki.certificateToPem(leaf.cert),
    privateKeyPem: forge.pki.privateKeyToPem(leaf.key),
    wwdrPem: forge.pki.certificateToPem(wwdr.cert),
  };
}

export function rsaKeyPair() {
  return crypto.generateKeyPairSync("rsa", {
    modulusLength: 2048,
    publicKeyEncoding: { type: "spki", format: "pem" },
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
  });
}

export function decodeJwt(jwt: string) {
  const [h, p, s] = jwt.split(".");
  return {
    header: JSON.parse(Buffer.from(h, "base64url").toString()),
    payload: JSON.parse(Buffer.from(p, "base64url").toString()),
    signingInput: `${h}.${p}`,
    signature: Buffer.from(s, "base64url"),
  };
}
