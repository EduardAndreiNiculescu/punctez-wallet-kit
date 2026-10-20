import crypto from "node:crypto";
import http2 from "node:http2";

export interface ApnsCredentials {
  /** Key ID of the .p8 auth key. */
  keyId: string;
  teamId: string;
  /** Contents of the .p8 file (PEM, EC P-256). */
  privateKeyPem: string;
}

/** ES256 provider token for APNs (token-based auth, recommended by Apple over push certificates). */
export function buildApnsJwt(creds: ApnsCredentials, issuedAt = Math.floor(Date.now() / 1000)): string {
  const header = Buffer.from(JSON.stringify({ alg: "ES256", kid: creds.keyId })).toString("base64url");
  const claims = Buffer.from(JSON.stringify({ iss: creds.teamId, iat: issuedAt })).toString("base64url");
  const signature = crypto
    .createSign("SHA256")
    .update(`${header}.${claims}`)
    // JWS wants the raw r||s signature, not DER.
    .sign({ key: creds.privateKeyPem, dsaEncoding: "ieee-p1363" });
  return `${header}.${claims}.${signature.toString("base64url")}`;
}

export interface PushResult {
  pushToken: string;
  status: number;
  body: string;
}

/**
 * Tells every registered device to re-download a pass. The push is empty:
 * iOS then calls your PassKit web service for the fresh `pass.json`.
 *
 * `api.push.apple.com` is HTTP/2 only. Node's `fetch` does not negotiate
 * HTTP/2 to arbitrary hosts, so every push silently failed with
 * `HTTPParserError` until this switched to `node:http2`. One session is
 * multiplexed across all devices instead of a TLS handshake per push.
 */
export async function pushPassUpdate(
  pushTokens: string[],
  passTypeIdentifier: string,
  creds: ApnsCredentials,
  host = "https://api.push.apple.com",
): Promise<PushResult[]> {
  if (!pushTokens.length) return [];
  const jwt = buildApnsJwt(creds);
  const session = http2.connect(host);
  session.on("error", () => {});
  try {
    return await Promise.all(
      pushTokens.map(
        (pushToken) =>
          new Promise<PushResult>((resolve) => {
            const req = session.request({
              ":method": "POST",
              ":path": `/3/device/${pushToken}`,
              authorization: `bearer ${jwt}`,
              "apns-topic": passTypeIdentifier,
              "apns-push-type": "background",
              "apns-priority": "5",
            });
            let status = 0;
            let body = "";
            req.setEncoding("utf8");
            req.on("response", (h) => (status = Number(h[":status"])));
            req.on("data", (c: string) => (body += c));
            req.on("end", () => resolve({ pushToken, status, body }));
            req.on("error", (err) => resolve({ pushToken, status: 0, body: String(err) }));
            req.end("{}");
          }),
      ),
    );
  } finally {
    session.close();
  }
}
