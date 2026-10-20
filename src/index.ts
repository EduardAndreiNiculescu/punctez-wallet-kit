export * from "./types.ts";
export { detectWalletPlatform } from "./platform.ts";

export { buildPassJson, hexToRgb, type ApplePassIdentity, type ApplePassInput } from "./apple/pass-json.ts";
export { buildPkpass, signManifest, sha1, type PassSigningCerts } from "./apple/pkpass.ts";
export { assertPublicHttpUrl, fetchImage, iconSet, stripSet, defaultIconSet } from "./apple/images.ts";
export { passAuthToken, verifyPassAuthHeader } from "./apple/auth-token.ts";
export { buildApnsJwt, pushPassUpdate, type ApnsCredentials, type PushResult } from "./apple/apns.ts";
export { zipStored, unzipStored, crc32 } from "./apple/zip.ts";

export { signRs256, createTokenProvider, saveToWalletUrl, type ServiceAccount } from "./google/jwt.ts";
export { googleId, loyaltyClassPayload, loyaltyObjectPayload, messagePatch, type LoyaltyObjectInput } from "./google/payloads.ts";
export { GoogleWalletClient, backoffMs, type GoogleWalletClientOptions } from "./google/client.ts";
