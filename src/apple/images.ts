import sharp from "sharp";
import { WalletError } from "../types.ts";

const MAX_ASSET_BYTES = 8 * 1024 * 1024;
/**
 * Caps the *decoded* size. A 500 KB PNG can declare 50,000 x 50,000 px and
 * exhaust the container's RAM during decoding, before any resize happens.
 */
const MAX_INPUT_PIXELS = 4096 * 4096;

/**
 * Logo and banner URLs come from businesses (untrusted) but are fetched
 * server-side, inside the hosting network. Without this guard a URL like
 * `http://169.254.169.254/...` (cloud metadata) or `http://127.0.0.1:<port>`
 * would be requested as if it were an image (SSRF).
 */
export function assertPublicHttpUrl(url: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new WalletError(`Invalid image URL: ${url}`, 400);
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new WalletError(`Unsupported image protocol: ${parsed.protocol}`, 400);
  }
  const host = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  const blocked =
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host === "0.0.0.0" ||
    host === "169.254.169.254" ||
    /^127\./.test(host) ||
    /^10\./.test(host) ||
    /^192\.168\./.test(host) ||
    /^169\.254\./.test(host) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(host) ||
    host === "::1" ||
    /^f[cd][0-9a-f]{2}:/.test(host);
  if (blocked) throw new WalletError(`Image URL refused (private network): ${url}`, 400);
  return parsed;
}

export async function fetchImage(url: string, fetchImpl: typeof fetch = fetch): Promise<Buffer> {
  assertPublicHttpUrl(url);
  // Redirects are not followed: a public URL could bounce to an internal target and bypass the check above.
  const res = await fetchImpl(url, { redirect: "manual" });
  if (res.status >= 300 && res.status < 400) throw new WalletError(`Image at ${url} redirects, refused`, 400);
  if (!res.ok) throw new WalletError(`Could not load image at ${url}`, res.status);
  const declared = Number(res.headers.get("content-length"));
  if (declared > MAX_ASSET_BYTES) throw new WalletError(`Image at ${url} is too large`, 400);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.byteLength > MAX_ASSET_BYTES) throw new WalletError(`Image at ${url} is too large`, 400);
  return buf;
}

const img = (src: Buffer) => sharp(src, { limitInputPixels: MAX_INPUT_PIXELS });

/** `icon.png` must be square: centred cover crop. `logo.png` fits a 50 pt height. */
export async function iconSet(source: Buffer): Promise<Map<string, Buffer>> {
  const specs = [
    ["icon.png", 29], ["icon@2x.png", 58], ["icon@3x.png", 87],
  ] as const;
  const logos = [
    ["logo.png", 50], ["logo@2x.png", 100], ["logo@3x.png", 150],
  ] as const;
  const out = await Promise.all([
    ...specs.map(async ([name, s]) => [name, await img(source).resize(s, s, { fit: "cover" }).png().toBuffer()] as const),
    ...logos.map(async ([name, h]) => [name, await img(source).resize({ height: h, fit: "inside" }).png().toBuffer()] as const),
  ]);
  return new Map(out);
}

/** `strip.png` covers exactly 375 x 123 pt on a storeCard: centred cover crop. */
export async function stripSet(source: Buffer): Promise<Map<string, Buffer>> {
  const specs = [["strip.png", 375, 123], ["strip@2x.png", 750, 246], ["strip@3x.png", 1125, 369]] as const;
  const out = await Promise.all(
    specs.map(async ([name, w, h]) => [name, await img(source).resize(w, h, { fit: "cover" }).png().toBuffer()] as const),
  );
  return new Map(out);
}

/** Neutral default icon (Apple refuses a pass without `icon.png`), rendered from SVG so no binary assets ship. */
export async function defaultIconSet(color = "#6D4AFF"): Promise<Map<string, Buffer>> {
  const svg = Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="300" height="300" viewBox="0 0 300 300">` +
      `<rect width="300" height="300" rx="66" fill="${color}"/>` +
      `<circle cx="150" cy="150" r="86" fill="none" stroke="#fff" stroke-width="18"/>` +
      `<path d="M150 98l15 31 34 5-25 24 6 34-30-16-30 16 6-34-25-24 34-5z" fill="#fff"/></svg>`,
  );
  return iconSet(await sharp(svg).png().toBuffer());
}
