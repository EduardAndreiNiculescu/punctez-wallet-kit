/** Provider-agnostic description of a loyalty card. One config renders both wallets. */
export interface PassLocation {
  latitude: number;
  longitude: number;
  /** Lock-screen text shown when the customer is nearby (Apple). */
  message?: string;
}

export interface CardConfig {
  businessName: string;
  /** Program name, e.g. "Coffee Club". */
  cardTitle: string;
  totalStamps: number;
  /** What the customer gets for a full card. May contain `{name}`. */
  rewardLabel?: string;
  /** `#RRGGBB` */
  brandColor: string;
  fontColor?: string;
  labelColor?: string;
  logoUrl?: string;
  /** Wide banner: Apple `strip.png`, Google `heroImage`. */
  heroImageUrl?: string;
  address?: string;
  openingHours?: string;
  phone?: string;
  websiteUrl?: string;
  /** Up to 10 relevant locations; both wallets cap at 10. */
  locations?: PassLocation[];
  /** Small top-right field. Value `{stamps}` renders the live counter. */
  headerField?: { label: string; value: string };
  auxiliaryField?: { label: string; value: string };
  sharingProhibited?: boolean;
  /** `YYYY-MM-DD` */
  expirationDate?: string;
}

/** Every user-facing string on the pass, so cards can be localised. */
export interface Labels {
  stamps: string;
  member: string;
  reward: string;
  address: string;
  hours: string;
  /** Apple change message; `%@` is replaced by the new value. */
  newStamp: string;
  call: string;
  website: string;
  nearby: (businessName: string) => string;
  description: (businessName: string) => string;
}

export const DEFAULT_LABELS: Labels = {
  stamps: "Stamps",
  member: "Member",
  reward: "Reward",
  address: "Address",
  hours: "Opening hours",
  newStamp: "New stamp: %@",
  call: "Call",
  website: "Website",
  nearby: (b) => `You are near ${b}!`,
  description: (b) => `${b} loyalty card`,
};

export const MAX_LOCATIONS = 10;

/** Error from a wallet provider, carrying the HTTP status and response body for diagnosis. */
export class WalletError extends Error {
  status: number;
  body?: unknown;

  constructor(message: string, status: number, body?: unknown) {
    super(message);
    this.name = "WalletError";
    this.status = status;
    this.body = body;
  }
}

/** `{name}` personalisation. Neither wallet has a template engine, so we interpolate at issue time. */
export function personalise(text: string | undefined, fullName: string): string | undefined {
  return text?.replaceAll("{name}", fullName);
}
