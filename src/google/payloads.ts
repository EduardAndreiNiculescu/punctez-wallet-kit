import crypto from "node:crypto";
import { DEFAULT_LABELS, MAX_LOCATIONS, personalise, type CardConfig, type Labels } from "../types.ts";

/** Google ids: issuer id + "." + letters, digits, `_`, `.` or `-`. */
export function googleId(issuerId: string, suffix: string): string {
  return `${issuerId}.${suffix.replace(/[^A-Za-z0-9._-]/g, "_")}`;
}

/**
 * One LoyaltyClass per business. A single issuer account serves every
 * business: Google separates tenants by class, not by per-business keys.
 */
export function loyaltyClassPayload(
  cfg: CardConfig,
  classId: string,
  opts: { defaultLogoUrl: string; labels?: Labels },
): Record<string, unknown> {
  const L = opts.labels ?? DEFAULT_LABELS;
  const payload: Record<string, unknown> = {
    id: classId,
    issuerName: cfg.businessName,
    programName: cfg.cardTitle,
    // Google refuses a class without programLogo, hence the fallback.
    programLogo: { sourceUri: { uri: cfg.logoUrl ?? opts.defaultLogoUrl } },
    hexBackgroundColor: cfg.brandColor,
    // The only value accepted on write; "APPROVED" returns 400. Google promotes it after review.
    reviewStatus: "UNDER_REVIEW",
  };
  if (cfg.heroImageUrl) payload.heroImage = { sourceUri: { uri: cfg.heroImageUrl } };

  const links = [
    cfg.phone ? { uri: `tel:${cfg.phone}`, description: L.call, id: "call" } : null,
    cfg.websiteUrl ? { uri: cfg.websiteUrl, description: L.website, id: "website" } : null,
  ].filter(Boolean);
  if (links.length) payload.linksModuleData = { uris: links };

  const modules = [
    cfg.rewardLabel && !cfg.rewardLabel.includes("{name}") ? { id: "reward", header: L.reward, body: cfg.rewardLabel } : null,
    cfg.address ? { id: "address", header: L.address, body: cfg.address } : null,
    cfg.openingHours ? { id: "hours", header: L.hours, body: cfg.openingHours } : null,
  ].filter(Boolean);
  if (modules.length) payload.textModulesData = modules;

  const locations = (cfg.locations ?? []).slice(0, MAX_LOCATIONS);
  if (locations.length) payload.locations = locations.map(({ latitude, longitude }) => ({ latitude, longitude }));
  return payload;
}

export interface LoyaltyObjectInput {
  issuerId: string;
  classId: string;
  fullName: string;
  stamps?: number;
  /** Shown under the QR instead of the raw object id. */
  codePrefix?: string;
  cfg: Pick<CardConfig, "rewardLabel" | "auxiliaryField">;
  labels?: Labels;
}

export function loyaltyObjectPayload(input: LoyaltyObjectInput): Record<string, unknown> {
  const L = input.labels ?? DEFAULT_LABELS;
  const suffix = crypto.randomUUID().replace(/-/g, "");
  const id = googleId(input.issuerId, `customer_${suffix}`);
  const payload: Record<string, unknown> = {
    id,
    classId: input.classId,
    state: "ACTIVE",
    accountName: input.fullName,
    accountId: id,
    loyaltyPoints: { balance: { int: input.stamps ?? 0 }, label: L.stamps },
    barcode: { type: "QR_CODE", value: id, alternateText: `${input.codePrefix ?? "CARD"}-${suffix.slice(0, 6).toUpperCase()}` },
  };
  const aux = input.cfg.auxiliaryField;
  if (aux?.value) {
    payload.secondaryLoyaltyPoints = { balance: { string: aux.value === "{stamps}" ? String(input.stamps ?? 0) : aux.value }, label: aux.label };
  }
  // A `{name}` reward is per customer, so it goes on the object, not the shared class.
  if (input.cfg.rewardLabel?.includes("{name}")) {
    payload.textModulesData = [{ id: "reward_personal", header: L.reward, body: personalise(input.cfg.rewardLabel, input.fullName) }];
  }
  return payload;
}

/** A new entry in `messages` is what triggers a visible notification; a balance-only PATCH stays silent. */
export function messagePatch(header: string, body: string, idPrefix = "msg"): Record<string, unknown> {
  return { messages: [{ header, body, id: `${idPrefix}_${Date.now()}`, messageType: "TEXT" }] };
}
