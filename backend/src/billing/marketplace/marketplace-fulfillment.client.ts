import { randomUUID } from 'node:crypto';
import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import {
  MARKETPLACE_API_BASE,
  MARKETPLACE_API_VERSION,
  MARKETPLACE_RESOURCE_ID,
  MarketplaceConfig,
} from './marketplace.config';

/** Injection token to replace fetch (tests). */
export const MARKETPLACE_FETCH = 'MARKETPLACE_FETCH';

/** Per-request timeout. Webhook handling must finish within 10 seconds. */
const REQUEST_TIMEOUT_MS = 4000;

/** Refresh the publisher token this long before it expires. */
const TOKEN_REFRESH_MARGIN_MS = 5 * 60 * 1000;

export interface SaasParty {
  emailId?: string | null;
  objectId?: string | null;
  tenantId?: string | null;
  puid?: string | null;
}

export interface SaasSubscription {
  id: string;
  name?: string;
  publisherId?: string;
  offerId: string;
  planId: string;
  quantity?: number | null;
  saasSubscriptionStatus: string;
  beneficiary?: SaasParty;
  purchaser?: SaasParty;
  term?: {
    startDate?: string | null;
    endDate?: string | null;
    termUnit?: string | null;
  };
  autoRenew?: boolean;
  isFreeTrial?: boolean;
  isTest?: boolean;
  allowedCustomerOperations?: string[];
}

export interface ResolvedPurchase {
  id: string;
  subscriptionName?: string;
  offerId: string;
  planId: string;
  quantity?: number | null;
  subscription: SaasSubscription;
}

export interface SaasOperation {
  id: string;
  activityId?: string;
  subscriptionId: string;
  offerId?: string;
  publisherId?: string;
  planId?: string;
  quantity?: number | null;
  action: string;
  timeStamp?: string;
  /** NotStarted, InProgress, Failed, Succeeded or Conflict. */
  status: string;
}

/** A non-2xx answer (or no answer) from Microsoft. Never carries tokens. */
export class MarketplaceApiError extends Error {
  constructor(
    message: string,
    /** HTTP status, or 0 when the request didn't complete. */
    readonly status: number,
  ) {
    super(message);
    this.name = 'MarketplaceApiError';
  }
}

type FetchFn = typeof fetch;

/**
 * Client for the SaaS fulfillment API v2, authenticated with KrakenKey's
 * fulfillment app registration (client credentials). The access token is
 * cached until shortly before it expires. Tokens, secrets and marketplace
 * purchase tokens are never logged.
 */
@Injectable()
export class MarketplaceFulfillmentClient {
  private readonly logger = new Logger(MarketplaceFulfillmentClient.name);
  private readonly fetch: FetchFn;
  private cached: { token: string; refreshAt: number } | null = null;
  private pending: Promise<string> | null = null;

  constructor(
    private readonly config: MarketplaceConfig,
    @Optional() @Inject(MARKETPLACE_FETCH) fetchImpl?: FetchFn,
  ) {
    this.fetch = fetchImpl ?? ((input, init) => fetch(input, init));
  }

  /** Exchanges the landing page token for the purchased subscription. */
  async resolve(marketplaceToken: string): Promise<ResolvedPurchase> {
    return this.call<ResolvedPurchase>('POST', '/subscriptions/resolve', {
      headers: { 'x-ms-marketplace-token': marketplaceToken },
    });
  }

  /** Tells Microsoft the account is set up; billing starts. */
  async activate(subscriptionId: string): Promise<void> {
    await this.call(
      'POST',
      `/subscriptions/${encodeURIComponent(subscriptionId)}/activate`,
      { body: {} },
    );
  }

  async getSubscription(subscriptionId: string): Promise<SaasSubscription> {
    return this.call<SaasSubscription>(
      'GET',
      `/subscriptions/${encodeURIComponent(subscriptionId)}`,
    );
  }

  async listOperations(subscriptionId: string): Promise<SaasOperation[]> {
    const res = await this.call<{ operations?: SaasOperation[] } | null>(
      'GET',
      `/subscriptions/${encodeURIComponent(subscriptionId)}/operations`,
    );
    return res?.operations ?? [];
  }

  async getOperation(
    subscriptionId: string,
    operationId: string,
  ): Promise<SaasOperation> {
    const op = await this.call<SaasOperation & { 'id  '?: string }>(
      'GET',
      `/subscriptions/${encodeURIComponent(subscriptionId)}/operations/${encodeURIComponent(operationId)}`,
    );
    // Microsoft's own example spells the key "id  "; accept either.
    return { ...op, id: op.id ?? op['id  '] ?? '' };
  }

  /** Accepts (Success) or rejects (Failure) a pending operation. */
  async updateOperation(
    subscriptionId: string,
    operationId: string,
    status: 'Success' | 'Failure',
  ): Promise<void> {
    await this.call(
      'PATCH',
      `/subscriptions/${encodeURIComponent(subscriptionId)}/operations/${encodeURIComponent(operationId)}`,
      { body: { status } },
    );
  }

  private async call<T>(
    method: string,
    path: string,
    opts: { headers?: Record<string, string>; body?: unknown } = {},
    retried = false,
  ): Promise<T> {
    const token = await this.accessToken();
    const requestId = randomUUID();
    const url = `${MARKETPLACE_API_BASE}${path}?api-version=${MARKETPLACE_API_VERSION}`;
    let res: Response;
    try {
      res = await this.fetch(url, {
        method,
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${token}`,
          'x-ms-requestid': requestId,
          'x-ms-correlationid': requestId,
          ...opts.headers,
        },
        body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (err) {
      this.logger.warn(
        `Marketplace ${method} ${this.describe(path)} failed: ${err instanceof Error ? err.message : String(err)} requestId=${requestId}`,
      );
      throw new MarketplaceApiError('Marketplace API unreachable', 0);
    }

    // A token revoked or rotated early: fetch a new one once.
    if (res.status === 401 && !retried) {
      this.cached = null;
      return this.call<T>(method, path, opts, true);
    }

    if (!res.ok) {
      this.logger.warn(
        `Marketplace ${method} ${this.describe(path)} returned ${res.status} requestId=${requestId}`,
      );
      throw new MarketplaceApiError(
        `Marketplace API returned ${res.status}`,
        res.status,
      );
    }

    const text = await res.text();
    if (!text) return null as T;
    try {
      return JSON.parse(text) as T;
    } catch {
      throw new MarketplaceApiError(
        'Marketplace API returned invalid JSON',
        res.status,
      );
    }
  }

  /** Path without ids, for logs. */
  private describe(path: string): string {
    return path
      .replace(/\/subscriptions\/[^/]+/, '/subscriptions/:id')
      .replace(/\/operations\/[^/]+/, '/operations/:id');
  }

  private async accessToken(): Promise<string> {
    if (this.cached && Date.now() < this.cached.refreshAt) {
      return this.cached.token;
    }
    // Concurrent callers share one token request.
    this.pending ??= this.fetchToken().finally(() => {
      this.pending = null;
    });
    return this.pending;
  }

  private async fetchToken(): Promise<string> {
    const { tenantId, clientId, clientSecret } = this.config;
    if (!tenantId || !clientId || !clientSecret) {
      throw new MarketplaceApiError('Marketplace credentials are not set', 0);
    }
    const url = `https://login.microsoftonline.com/${encodeURIComponent(tenantId)}/oauth2/v2.0/token`;
    let res: Response;
    try {
      res = await this.fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'client_credentials',
          client_id: clientId,
          client_secret: clientSecret,
          scope: `${MARKETPLACE_RESOURCE_ID}/.default`,
        }).toString(),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (err) {
      this.logger.warn(
        `Marketplace token request failed: ${err instanceof Error ? err.message : String(err)}`,
      );
      throw new MarketplaceApiError('Token endpoint unreachable', 0);
    }
    if (!res.ok) {
      // The body may echo request details; log only the status.
      this.logger.error(`Marketplace token request returned ${res.status}`);
      throw new MarketplaceApiError(
        `Token endpoint returned ${res.status}`,
        res.status,
      );
    }
    const body = (await res.json()) as {
      access_token?: string;
      expires_in?: number | string;
    };
    if (!body.access_token) {
      throw new MarketplaceApiError('Token response has no access_token', 0);
    }
    const expiresInMs = (Number(body.expires_in) || 3600) * 1000;
    this.cached = {
      token: body.access_token,
      refreshAt:
        Date.now() + Math.max(expiresInMs - TOKEN_REFRESH_MARGIN_MS, 0),
    };
    return body.access_token;
  }
}
