/**
 * Prints the LoyaltyClass + LoyaltyObject a business and a customer would
 * get, and a signed "Add to Google Wallet" link, without calling Google.
 * With a real service account, send the payloads through GoogleWalletClient.
 *
 *   node examples/google-dry-run.ts
 */
import { googleId, loyaltyClassPayload, loyaltyObjectPayload, saveToWalletUrl, type CardConfig } from "../src/index.ts";
import { rsaKeyPair } from "../tests/helpers.ts";

const issuerId = "3388000000000000000"; // yours, from the Google Pay & Wallet console
const serviceAccount = { email: "signer@your-project.iam.gserviceaccount.com", privateKeyPem: rsaKeyPair().privateKey };

const card: CardConfig = {
  businessName: "Bloom Bakery",
  cardTitle: "Bloom Club",
  totalStamps: 8,
  brandColor: "#4B1D7A",
  phone: "+40700000000",
  websiteUrl: "https://bloom.example",
  rewardLabel: "Happy birthday {name}! Your slice is on us.",
};

const classId = googleId(issuerId, "business_bloom");
const klass = loyaltyClassPayload(card, classId, { defaultLogoUrl: "https://your-domain.example/logo.png" });
const object = loyaltyObjectPayload({ issuerId, classId, fullName: "Ana Popescu", stamps: 3, codePrefix: "BLOOM", cfg: card });

console.log("LoyaltyClass:\n" + JSON.stringify(klass, null, 2));
console.log("\nLoyaltyObject:\n" + JSON.stringify(object, null, 2));
console.log("\nSave link:\n" + saveToWalletUrl(serviceAccount, [String(object.id)]).slice(0, 90) + "...");
