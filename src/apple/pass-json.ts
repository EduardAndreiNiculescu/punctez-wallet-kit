import { DEFAULT_LABELS, MAX_LOCATIONS, type CardConfig, type Labels } from "../types.ts";

export interface ApplePassIdentity {
  passTypeIdentifier: string;
  teamIdentifier: string;
  organizationName: string;
}

export interface ApplePassInput {
  serialNumber: string;
  customerName: string;
  stamps: number;
  /** PassKit web service base URL (without `/v1`: iOS appends it) and the per-pass token. */
  webServiceURL?: string;
  authenticationToken?: string;
  /** Last broadcast, shown on the back of the pass. */
  message?: string;
  labels?: Labels;
}

export function hexToRgb(hex: string, fallback = "rgb(12, 12, 14)"): string {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  if (!m) return fallback;
  return `rgb(${parseInt(m[1], 16)}, ${parseInt(m[2], 16)}, ${parseInt(m[3], 16)})`;
}

/**
 * Builds `pass.json` for a PassKit `storeCard`.
 *
 * Notes from production:
 * - `changeMessage` only shows a visible update banner on *front* fields
 *   (primary/secondary/auxiliary/header), never on back fields, so the stamp
 *   counter lives in `primaryFields`.
 * - `{stamps}` in a header/auxiliary value renders the live counter.
 * - With `totalStamps <= 1` and a header field the card is a membership
 *   badge: "0/1 stamps" would be meaningless, so the header becomes primary.
 */
export function buildPassJson(cfg: CardConfig, input: ApplePassInput, id: ApplePassIdentity): Record<string, unknown> {
  const L = input.labels ?? DEFAULT_LABELS;
  const counter = `${input.stamps}/${cfg.totalStamps}`;
  const resolve = (value: string) => (value === "{stamps}" ? counter : value);
  const badgeMode = cfg.totalStamps <= 1 && Boolean(cfg.headerField);

  const primaryFields = badgeMode
    ? [{ key: "balance", label: cfg.headerField!.label, value: resolve(cfg.headerField!.value) }]
    : [{ key: "balance", label: L.stamps, value: counter, changeMessage: L.newStamp }];
  const headerFields = cfg.headerField && !badgeMode
    ? [{ key: "header1", label: cfg.headerField.label, value: resolve(cfg.headerField.value) }]
    : undefined;
  const auxiliaryFields = cfg.auxiliaryField
    ? [{
        key: "aux1",
        label: cfg.auxiliaryField.label,
        value: resolve(cfg.auxiliaryField.value),
        ...(cfg.auxiliaryField.value === "{stamps}" ? { changeMessage: "%@" } : {}),
      }]
    : undefined;

  const backFields: Array<Record<string, string>> = [];
  if (cfg.rewardLabel) backFields.push({ key: "reward", label: L.reward, value: cfg.rewardLabel });
  if (cfg.address) backFields.push({ key: "address", label: L.address, value: cfg.address });
  if (cfg.openingHours) backFields.push({ key: "hours", label: L.hours, value: cfg.openingHours });
  if (input.message) backFields.push({ key: "news", label: cfg.businessName, value: input.message, changeMessage: "%@" });

  const pass: Record<string, unknown> = {
    formatVersion: 1,
    passTypeIdentifier: id.passTypeIdentifier,
    teamIdentifier: id.teamIdentifier,
    organizationName: id.organizationName,
    serialNumber: input.serialNumber,
    description: L.description(cfg.businessName),
    logoText: cfg.businessName,
    storeCard: {
      headerFields,
      primaryFields,
      secondaryFields: [{ key: "name", label: L.member, value: input.customerName }],
      auxiliaryFields,
      backFields,
    },
    barcodes: [{ message: input.serialNumber, format: "PKBarcodeFormatQR", messageEncoding: "iso-8859-1" }],
    backgroundColor: hexToRgb(cfg.brandColor),
    foregroundColor: hexToRgb(cfg.fontColor ?? "#FFFFFF"),
    labelColor: hexToRgb(cfg.labelColor ?? cfg.fontColor ?? "#FFFFFF"),
  };

  if (input.webServiceURL && input.authenticationToken) {
    pass.webServiceURL = input.webServiceURL;
    pass.authenticationToken = input.authenticationToken;
  }
  if (cfg.sharingProhibited) pass.sharingProhibited = true;
  if (cfg.expirationDate) pass.expirationDate = `${cfg.expirationDate}T23:59:59+00:00`;

  // iOS raises the lock-screen notification by itself from these, with no push from us.
  const locations = (cfg.locations ?? []).slice(0, MAX_LOCATIONS);
  if (locations.length) {
    pass.locations = locations.map((p) => ({
      latitude: p.latitude,
      longitude: p.longitude,
      relevantText: p.message ?? L.nearby(cfg.businessName),
    }));
  }
  return pass;
}
