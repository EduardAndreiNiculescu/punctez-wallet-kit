/**
 * Each wallet is single-platform: an Android visitor offered a `.pkpass`
 * just downloads a file. Pick the provider from the User-Agent *before*
 * issuing, never from a fixed per-business setting.
 */
export function detectWalletPlatform(userAgent: string | null | undefined): "apple" | "google" {
  return userAgent && /android/i.test(userAgent) ? "google" : "apple";
}
