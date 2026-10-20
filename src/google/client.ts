import { DEFAULT_LABELS, WalletError, type Labels } from "../types.ts";
import { createTokenProvider, type ServiceAccount } from "./jwt.ts";
import { messagePatch } from "./payloads.ts";

const API = "https://walletobjects.googleapis.com/walletobjects/v1";
const RETRYABLE = new Set([429, 502, 503, 504]);

export interface GoogleWalletClientOptions {
  serviceAccount: ServiceAccount;
  labels?: Labels;
  maxAttempts?: number;
  fetchImpl?: typeof fetch;
  /** Injected in tests to skip real waiting. */
  sleep?: (ms: number) => Promise<void>;
}

/** 400 ms, 800 ms, ... plus up to 150 ms jitter so parallel retries don't line up. */
export const backoffMs = (attempt: number) => 400 * 2 ** (attempt - 1) + Math.floor(Math.random() * 150);

export class GoogleWalletClient {
  private token: () => Promise<string>;
  private fetchImpl: typeof fetch;
  private sleep: (ms: number) => Promise<void>;
  private maxAttempts: number;
  private labels: Labels;

  constructor(opts: GoogleWalletClientOptions) {
    this.fetchImpl = opts.fetchImpl ?? fetch;
    this.token = createTokenProvider(opts.serviceAccount, this.fetchImpl);
    this.sleep = opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
    this.maxAttempts = opts.maxAttempts ?? 3;
    this.labels = opts.labels ?? DEFAULT_LABELS;
  }

  /**
   * 429 and 502/503/504 mean the request was not processed, so it is safe to
   * retry (exponential backoff, honouring `Retry-After`, capped at 4 s).
   * Network errors are retried only for GET, never for writes that may have
   * reached Google.
   */
  async call<T>(path: string, method: string, body?: unknown): Promise<T> {
    const token = await this.token();
    for (let attempt = 1; ; attempt++) {
      let res: Response;
      try {
        res = await this.fetchImpl(`${API}${path}`, {
          method,
          headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
          body: body === undefined ? undefined : JSON.stringify(body),
        });
      } catch (cause) {
        if (method === "GET" && attempt < this.maxAttempts) {
          await this.sleep(backoffMs(attempt));
          continue;
        }
        throw new WalletError(`Google Wallet API unreachable: ${(cause as Error).message}`, 0);
      }
      if (RETRYABLE.has(res.status) && attempt < this.maxAttempts) {
        const retryAfter = Number(res.headers.get("retry-after"));
        await this.sleep(retryAfter > 0 ? Math.min(retryAfter * 1000, 4000) : backoffMs(attempt));
        continue;
      }
      const raw = await res.text();
      let parsed: unknown = raw;
      try {
        parsed = raw ? JSON.parse(raw) : null;
      } catch {
        /* keep raw text for diagnosis */
      }
      if (!res.ok) throw new WalletError(`Google Wallet API returned ${res.status} for ${method} ${path}`, res.status, parsed);
      return parsed as T;
    }
  }

  /** POST the class; on 409 (already exists, e.g. the business edited its card) PATCH it instead. */
  async upsertClass(payload: Record<string, unknown>): Promise<void> {
    try {
      await this.call("/loyaltyClass", "POST", payload);
    } catch (err) {
      if (err instanceof WalletError && err.status === 409) {
        await this.call(`/loyaltyClass/${payload.id}`, "PATCH", payload);
      } else {
        throw err;
      }
    }
  }

  async createObject(payload: Record<string, unknown>): Promise<void> {
    await this.call("/loyaltyObject", "POST", payload);
  }

  async getStamps(objectId: string): Promise<number> {
    const obj = await this.call<{ loyaltyPoints?: { balance?: { int?: number } } }>(`/loyaltyObject/${objectId}`, "GET");
    return obj.loyaltyPoints?.balance?.int ?? 0;
  }

  async setStamps(objectId: string, count: number, notify?: { header: string; body: string }): Promise<void> {
    await this.call(`/loyaltyObject/${objectId}`, "PATCH", {
      loyaltyPoints: { balance: { int: Math.max(0, Math.floor(count)) }, label: this.labels.stamps },
      ...(notify ? messagePatch(notify.header, notify.body) : {}),
    });
  }

  async addStamp(objectId: string, totalStamps?: number): Promise<{ before: number; after: number; completed: boolean }> {
    const before = await this.getStamps(objectId);
    const after = before + 1;
    await this.setStamps(objectId, after);
    return { before, after, completed: totalStamps !== undefined && after >= totalStamps };
  }

  /** Broadcast without touching the stamps. */
  async pushMessage(objectId: string, header: string, body: string): Promise<void> {
    await this.call(`/loyaltyObject/${objectId}`, "PATCH", messagePatch(header, body));
  }
}
