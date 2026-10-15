import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/**
 * ResolveCustomer and GetEntitlements are only served in US East
 * (N. Virginia), and AWS Marketplace emits its EventBridge events there.
 * https://docs.aws.amazon.com/marketplace/latest/userguide/checking-entitlements.html
 */
export const AWS_MARKETPLACE_REGION = 'us-east-1';

/**
 * KrakenKey plans that can be sold through AWS Marketplace: the contract's
 * `pro` and `business` dimensions, and Enterprise for private offers.
 */
export const AWS_MARKETPLACE_PLANS = ['pro', 'business', 'enterprise'] as const;
export type AwsMarketplacePlan = (typeof AWS_MARKETPLACE_PLANS)[number];

/**
 * Parses KK_AWS_MARKETPLACE_DIMENSION_MAP, a comma-separated list of
 * `<contract dimension>=<krakenkey plan>` pairs, for example
 * `pro=pro,business=business`. Several dimensions can map to the same plan.
 * Entries that don't parse are returned in `invalid` and left out.
 */
export function parseDimensionMap(raw: string | undefined): {
  map: Record<string, AwsMarketplacePlan>;
  invalid: string[];
} {
  const map: Record<string, AwsMarketplacePlan> = {};
  const invalid: string[] = [];
  for (const entry of (raw ?? '').split(',')) {
    const trimmed = entry.trim();
    if (!trimmed) continue;
    const [dimension, plan, ...rest] = trimmed.split('=').map((s) => s.trim());
    if (
      !dimension ||
      !plan ||
      rest.length > 0 ||
      !(AWS_MARKETPLACE_PLANS as readonly string[]).includes(plan)
    ) {
      invalid.push(trimmed);
      continue;
    }
    map[dimension] = plan as AwsMarketplacePlan;
  }
  return { map, invalid };
}

function parseList(raw: string | undefined): string[] {
  return (raw ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * The region of an SQS queue URL
 * (`https://sqs.<region>.amazonaws.com/<account>/<name>`), or null when the
 * URL doesn't have that shape.
 */
export function queueRegion(queueUrl: string): string | null {
  const match = /^https:\/\/sqs\.([a-z0-9-]+)\.amazonaws\.com(?:\.cn)?\//.exec(
    queueUrl,
  );
  return match ? match[1] : null;
}

/**
 * AWS Marketplace settings, read once from the environment. Selling through
 * AWS Marketplace is off unless KK_AWS_MARKETPLACE_ENABLED is "true"; while
 * it is off every /billing/aws-marketplace route except `status` answers
 * 404, the landing page says the offer isn't available, and neither the
 * event consumer nor the reconcile job runs.
 */
@Injectable()
export class AwsMarketplaceConfig {
  private readonly logger = new Logger(AwsMarketplaceConfig.name);

  readonly enabled: boolean;
  /**
   * Role in the seller account to assume for ResolveCustomer and
   * GetEntitlements. Empty uses the default credentials as they are.
   */
  readonly roleArn: string;
  /** Product codes whose purchases are accepted. Empty accepts any. */
  readonly productCodes: string[];
  readonly dimensionMap: Record<string, AwsMarketplacePlan>;
  /** SQS queue the seller account's events are forwarded to. Empty: no consumer. */
  readonly queueUrl: string;
  /** The dashboard's host name, for the landing page redirect. */
  readonly appDomain: string;

  constructor(config: ConfigService) {
    this.enabled =
      (config.get<string>('KK_AWS_MARKETPLACE_ENABLED') ?? '').toLowerCase() ===
      'true';
    this.roleArn = (
      config.get<string>('KK_AWS_MARKETPLACE_ROLE_ARN') ?? ''
    ).trim();
    this.productCodes = parseList(
      config.get<string>('KK_AWS_MARKETPLACE_PRODUCT_CODES'),
    );
    const { map, invalid } = parseDimensionMap(
      config.get<string>('KK_AWS_MARKETPLACE_DIMENSION_MAP'),
    );
    this.dimensionMap = map;
    this.queueUrl = (
      config.get<string>('KK_AWS_MARKETPLACE_QUEUE_URL') ?? ''
    ).trim();
    this.appDomain = config.get<string>('KK_APP_DOMAIN') || 'app.krakenkey.io';

    if (!this.enabled) return;
    if (invalid.length > 0) {
      this.logger.error(
        `KK_AWS_MARKETPLACE_DIMENSION_MAP has entries that were ignored: ${invalid.join(', ')} (expected <dimension>=pro|business|enterprise)`,
      );
    }
    if (Object.keys(this.dimensionMap).length === 0) {
      this.logger.error(
        'KK_AWS_MARKETPLACE_ENABLED is true but KK_AWS_MARKETPLACE_DIMENSION_MAP is empty. Purchases stay pending until it is set',
      );
    }
    if (!this.queueUrl) {
      this.logger.warn(
        'KK_AWS_MARKETPLACE_QUEUE_URL is empty: AWS Marketplace events are not read, and changes are only picked up by the hourly reconcile',
      );
    } else if (!queueRegion(this.queueUrl)) {
      this.logger.error(
        'KK_AWS_MARKETPLACE_QUEUE_URL is not an SQS queue URL (https://sqs.<region>.amazonaws.com/<account>/<name>); events are not read',
      );
    }
  }

  /** Whether purchases of this product are accepted here. */
  acceptsProduct(productCode: string | null | undefined): boolean {
    if (!productCode) return false;
    return (
      this.productCodes.length === 0 || this.productCodes.includes(productCode)
    );
  }

  /** The KrakenKey plan a contract dimension maps to, or null if it isn't sold here. */
  planFor(dimension: string | null | undefined): AwsMarketplacePlan | null {
    if (!dimension) return null;
    return this.dimensionMap[dimension] ?? null;
  }

  /** Whether the SQS consumer should run. */
  get consumerEnabled(): boolean {
    return this.enabled && !!this.queueUrl && !!queueRegion(this.queueUrl);
  }
}
