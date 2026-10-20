/**
 * Builds a complete, signed .pkpass with throwaway certificates and prints
 * what is inside it. To get a pass an iPhone will install, pass your real
 * Pass Type ID certificate, key and Apple's WWDR certificate instead.
 *
 *   node examples/apple-test-pass.ts
 */
import crypto from "node:crypto";
import fs from "node:fs";
import { buildPassJson, buildPkpass, defaultIconSet, passAuthToken, unzipStored, type CardConfig } from "../src/index.ts";
import { testSigningCerts } from "../tests/helpers.ts";

const card: CardConfig = {
  businessName: "Bloom Bakery",
  cardTitle: "Bloom Club",
  totalStamps: 8,
  rewardLabel: "A free slice of cake",
  brandColor: "#4B1D7A",
  address: "1 Example Street",
  openingHours: "Mon-Sat 08:00-20:00",
  locations: [{ latitude: 44.3302, longitude: 23.7949 }],
};

const serialNumber = crypto.randomUUID();
const passJson = buildPassJson(
  card,
  {
    serialNumber,
    customerName: "Ana Popescu",
    stamps: 3,
    webServiceURL: "https://your-domain.example/api/wallet/apple",
    authenticationToken: passAuthToken(serialNumber, "replace-with-a-dedicated-32-char-secret"),
  },
  { passTypeIdentifier: "pass.com.example.loyalty", teamIdentifier: "ABCDE12345", organizationName: "Bloom Bakery" },
);

const pkpass = buildPkpass(passJson, await defaultIconSet(card.brandColor), testSigningCerts());
fs.mkdirSync("out", { recursive: true });
fs.writeFileSync("out/demo.pkpass", pkpass);

console.log(`out/demo.pkpass  ${pkpass.length} bytes`);
for (const [name, buf] of unzipStored(pkpass)) console.log(`  ${name.padEnd(14)} ${buf.length} bytes`);
console.log("\npass.json:\n" + JSON.stringify(passJson, null, 2));
