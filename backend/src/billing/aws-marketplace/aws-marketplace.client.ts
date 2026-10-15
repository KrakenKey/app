import { Inject, Injectable, Optional } from '@nestjs/common';
import {
  MarketplaceMeteringClient,
  ResolveCustomerCommand,
} from '@aws-sdk/client-marketplace-metering';
import {
  GetEntitlementsCommand,
  MarketplaceEntitlementServiceClient,
} from '@aws-sdk/client-marketplace-entitlement-service';
import { fromTemporaryCredentials } from '@aws-sdk/credential-providers';
import {
  AWS_MARKETPLACE_REGION,
  AwsMarketplaceConfig,
} from './aws-marketplace.config';

/** The parts of AWS credentials the cache looks at. */
export interface AwsCredentials {
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken?: string;
  expiration?: Date;
}

export type AwsCredentialProvider = () => Promise<AwsCredentials>;

/** What ResolveCustomer returns for a registration token. */
export interface ResolvedCustomer {
  customerAwsAccountId: string;
  licenseArn: string;
  productCode: string;
  /** Metadata.AgreementId, when AWS includes it. */
  agreementId: string | null;
}

/** One GetEntitlements entry. */
export interface AwsEntitlement {
  dimension: string;
  licenseArn: string | null;
  customerAwsAccountId: string | null;
  productCode: string | null;
  expirationDate: Date | null;
  value: {
    integer?: number;
    double?: number;
    boolean?: boolean;
    string?: string;
  } | null;
}

/** ResolveCustomer refused the token (invalid, expired or already redeemed). */
export class AwsMarketplaceTokenError extends Error {
  constructor(readonly code: string) {
    super(`AWS Marketplace refused the registration token (${code})`);
    this.name = 'AwsMarketplaceTokenError';
  }
}

/**
 * Any other AWS Marketplace API failure. `code` is the SDK error name only:
 * messages are never copied, so nothing a caller logs can carry a token.
 */
export class AwsMarketplaceApiError extends Error {
  constructor(
    readonly operation: string,
    readonly code: string,
    readonly status: number | null,
  ) {
    super(`AWS Marketplace ${operation} failed (${code})`);
    this.name = 'AwsMarketplaceApiError';
  }
}

/** Minimal SDK surface, replaceable in tests. */
export interface AwsMarketplaceSdk {
  metering: Pick<MarketplaceMeteringClient, 'send'>;
  entitlement: Pick<MarketplaceEntitlementServiceClient, 'send'>;
}

/** Injection token to replace the SDK clients, for tests. */
export const AWS_MARKETPLACE_SDK = Symbol('AWS_MARKETPLACE_SDK');

/**
 * ResolveCustomer has to answer while the buyer's browser waits on the
 * fulfillment URL, so it gets a short budget and a single retry.
 */
export const RESOLVE_TIMEOUT_MS = 8000;

/** GetEntitlements runs inside a short database transaction; keep it bounded. */
export const ENTITLEMENTS_TIMEOUT_MS = 10_000;

/** Refresh assumed-role credentials when they have less than this left. */
export const CREDENTIAL_REFRESH_MARGIN_MS = 5 * 60 * 1000;

/** STS session name, visible in the seller account's CloudTrail. */
export const ROLE_SESSION_NAME = 'krakenkey-aws-marketplace';

/** Max entries per GetEntitlements page (the API's limit). */
const ENTITLEMENTS_PAGE_SIZE = 25;

/** Stops a runaway NextToken loop; one license has a handful of entitlements. */
const MAX_ENTITLEMENT_PAGES = 20;

const TOKEN_ERRORS = new Set([
  'InvalidTokenException',
  'ExpiredTokenException',
]);

/**
 * Wraps a credential provider so the result is reused until it is within
 * `marginMs` of expiring. Credentials without an expiration are kept for
 * the life of the process. Concurrent callers share one refresh.
 */
export function cachedCredentials(
  provider: AwsCredentialProvider,
  marginMs = CREDENTIAL_REFRESH_MARGIN_MS,
  now: () => number = Date.now,
): AwsCredentialProvider {
  let cached: AwsCredentials | null = null;
  let inFlight: Promise<AwsCredentials> | null = null;
  return async () => {
    if (
      cached &&
      (!cached.expiration || cached.expiration.getTime() - now() > marginMs)
    ) {
      return cached;
    }
    inFlight ??= provider()
      .then((creds) => {
        cached = creds;
        return creds;
      })
      .finally(() => {
        inFlight = null;
      });
    return inFlight;
  };
}

function errorCode(err: unknown): { code: string; status: number | null } {
  const e = err as {
    name?: unknown;
    $metadata?: { httpStatusCode?: number };
  } | null;
  return {
    code: typeof e?.name === 'string' ? e.name : 'UnknownError',
    status: e?.$metadata?.httpStatusCode ?? null,
  };
}

/**
 * AWS Marketplace Metering (ResolveCustomer) and Entitlement Service
 * (GetEntitlements) clients, always in us-east-1.
 *
 * With KK_AWS_MARKETPLACE_ROLE_ARN set, both calls use credentials from
 * sts:AssumeRole into that role in the seller account; the base credentials
 * (the EC2 instance role) come from the default chain. The assumed-role
 * credentials are shared by both clients and reused until 5 minutes before
 * they expire. Without a role the default credentials are used directly,
 * which only works where they already belong to the seller account.
 */
@Injectable()
export class AwsMarketplaceClient {
  private sdk: AwsMarketplaceSdk | null;

  constructor(
    private readonly config: AwsMarketplaceConfig,
    @Optional() @Inject(AWS_MARKETPLACE_SDK) sdk?: AwsMarketplaceSdk,
  ) {
    this.sdk = sdk ?? null;
  }

  /** Built on first use, so nothing touches AWS while the feature is off. */
  private clients(): AwsMarketplaceSdk {
    if (this.sdk) return this.sdk;
    const credentials = this.config.roleArn
      ? cachedCredentials(
          fromTemporaryCredentials({
            params: {
              RoleArn: this.config.roleArn,
              RoleSessionName: ROLE_SESSION_NAME,
              DurationSeconds: 3600,
            },
            clientConfig: { region: AWS_MARKETPLACE_REGION },
          }),
        )
      : undefined;
    this.sdk = {
      metering: new MarketplaceMeteringClient({
        region: AWS_MARKETPLACE_REGION,
        credentials,
        maxAttempts: 2,
      }),
      entitlement: new MarketplaceEntitlementServiceClient({
        region: AWS_MARKETPLACE_REGION,
        credentials,
        maxAttempts: 3,
      }),
    };
    return this.sdk;
  }

  /**
   * Exchanges the fulfillment URL's registration token. Throws
   * AwsMarketplaceTokenError when AWS refuses the token and
   * AwsMarketplaceApiError for anything else.
   */
  async resolveCustomer(token: string): Promise<ResolvedCustomer> {
    let out;
    try {
      out = await this.clients().metering.send(
        new ResolveCustomerCommand({ RegistrationToken: token }),
        { abortSignal: AbortSignal.timeout(RESOLVE_TIMEOUT_MS) },
      );
    } catch (err) {
      const { code, status } = errorCode(err);
      if (TOKEN_ERRORS.has(code)) throw new AwsMarketplaceTokenError(code);
      throw new AwsMarketplaceApiError('ResolveCustomer', code, status);
    }
    if (!out.CustomerAWSAccountId || !out.LicenseArn || !out.ProductCode) {
      throw new AwsMarketplaceApiError(
        'ResolveCustomer',
        'IncompleteResponse',
        200,
      );
    }
    return {
      customerAwsAccountId: out.CustomerAWSAccountId,
      licenseArn: out.LicenseArn,
      productCode: out.ProductCode,
      agreementId: out.Metadata?.AgreementId || null,
    };
  }

  /**
   * Every entitlement AWS reports for the license, across pages. Filtered
   * by LICENSE_ARN, not by account: with Concurrent Agreements one AWS
   * account can hold several licenses for the product.
   */
  async getEntitlements(
    productCode: string,
    licenseArn: string,
  ): Promise<AwsEntitlement[]> {
    const result: AwsEntitlement[] = [];
    let nextToken: string | undefined;
    for (let page = 0; page < MAX_ENTITLEMENT_PAGES; page++) {
      let out;
      try {
        out = await this.clients().entitlement.send(
          new GetEntitlementsCommand({
            ProductCode: productCode,
            Filter: { LICENSE_ARN: [licenseArn] },
            MaxResults: ENTITLEMENTS_PAGE_SIZE,
            NextToken: nextToken,
          }),
          { abortSignal: AbortSignal.timeout(ENTITLEMENTS_TIMEOUT_MS) },
        );
      } catch (err) {
        const { code, status } = errorCode(err);
        throw new AwsMarketplaceApiError('GetEntitlements', code, status);
      }
      for (const e of out.Entitlements ?? []) {
        if (!e.Dimension) continue;
        result.push({
          dimension: e.Dimension,
          licenseArn: e.LicenseArn ?? null,
          customerAwsAccountId: e.CustomerAWSAccountId ?? null,
          productCode: e.ProductCode ?? null,
          expirationDate: e.ExpirationDate ? new Date(e.ExpirationDate) : null,
          value: e.Value
            ? {
                integer: e.Value.IntegerValue,
                double: e.Value.DoubleValue,
                boolean: e.Value.BooleanValue,
                string: e.Value.StringValue,
              }
            : null,
        });
      }
      // AWS may return an empty page with a NextToken; keep going.
      nextToken = out.NextToken;
      if (!nextToken) return result;
    }
    throw new AwsMarketplaceApiError('GetEntitlements', 'TooManyPages', null);
  }
}
