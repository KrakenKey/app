import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { resolveAcmeDirectoryUrl } from '../util/acme-directory';
import {
  type AriWindow,
  parseRenewalInfo,
  retryAfterSeconds,
} from '../util/ari';

const FETCH_TIMEOUT_MS = 10_000;

export interface RenewalInfoResult {
  window: AriWindow;
  /** Seconds before asking again, from Retry-After (clamped). */
  retryAfterSeconds: number;
}

/**
 * Reads ACME Renewal Information (RFC 9773). renewalInfo is a plain,
 * unauthenticated GET, so this doesn't need the ACME account.
 */
@Injectable()
export class AriService {
  private readonly logger = new Logger(AriService.name);
  private renewalInfoUrl: Promise<string | null> | null = null;

  constructor(private readonly config: ConfigService) {}

  /** ARI is on unless KK_ACME_ARI=false. */
  isEnabled(): boolean {
    return this.config.get<string>('KK_ACME_ARI')?.toLowerCase() !== 'false';
  }

  /**
   * The directory's renewalInfo URL, or null when the CA doesn't support
   * ARI. Cached; a failed lookup is retried on the next call.
   */
  getRenewalInfoUrl(): Promise<string | null> {
    if (!this.renewalInfoUrl) {
      const { url } = resolveAcmeDirectoryUrl(this.config);
      this.renewalInfoUrl = fetch(url, {
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      })
        .then(async (res) => {
          if (!res.ok) throw new Error(`directory returned ${res.status}`);
          const dir = (await res.json()) as { renewalInfo?: unknown };
          return typeof dir.renewalInfo === 'string' ? dir.renewalInfo : null;
        })
        .catch((err: unknown) => {
          this.renewalInfoUrl = null;
          throw err;
        });
    }
    return this.renewalInfoUrl;
  }

  /**
   * The CA's suggested window for a certificate, or null when the CA has no
   * renewal information for it (404) or doesn't support ARI. Throws on
   * network errors and other failures so the caller can retry later.
   */
  async getRenewalInfo(certId: string): Promise<RenewalInfoResult | null> {
    const base = await this.getRenewalInfoUrl();
    if (!base) return null;
    const res = await fetch(`${base.replace(/\/$/, '')}/${certId}`, {
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`renewalInfo returned ${res.status}`);
    const window = parseRenewalInfo(await res.json());
    if (!window) throw new Error('renewalInfo response was malformed');
    return {
      window,
      retryAfterSeconds: retryAfterSeconds(res.headers.get('retry-after')),
    };
  }
}
