import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/** SaaS fulfillment API v2. */
export const MARKETPLACE_API_BASE =
  'https://marketplaceapi.microsoft.com/api/saas';
export const MARKETPLACE_API_VERSION = '2018-08-31';

/**
 * The Marketplace SaaS API's application id. Publisher tokens are requested
 * for it, and webhook calls from Microsoft carry it as `appid` or `azp`.
 */
export const MARKETPLACE_RESOURCE_ID = '20e940b3-4c77-4b0b-9a53-9e16a1b010a7';

/**
 * KrakenKey plans that can be sold through the Marketplace: Pro and Business
 * as public plans, Enterprise through private plans and private offers.
 */
export const MARKETPLACE_PLANS = ['pro', 'business', 'enterprise'] as const;
export type MarketplacePlan = (typeof MARKETPLACE_PLANS)[number];

/**
 * Plan names from before the rename, still accepted in the map so an
 * existing KK_MARKETPLACE_PLAN_MAP keeps working until it is updated.
 */
const LEGACY_MARKETPLACE_PLANS: Readonly<Record<string, MarketplacePlan>> = {
  starter: 'pro',
  team: 'business',
};

/**
 * Parses KK_MARKETPLACE_PLAN_MAP, a comma-separated list of
 * `<marketplace plan id>=<krakenkey plan>` pairs, for example
 * `kk-pro=pro,kk-business=business`. Several Marketplace plans (for example
 * public and private ones) can map to the same KrakenKey plan. The legacy
 * names `starter` and `team` read as `pro` and `business`. Entries that
 * don't parse are returned in `invalid` and left out.
 */
export function parsePlanMap(raw: string | undefined): {
  map: Record<string, MarketplacePlan>;
  invalid: string[];
} {
  const map: Record<string, MarketplacePlan> = {};
  const invalid: string[] = [];
  for (const entry of (raw ?? '').split(',')) {
    const trimmed = entry.trim();
    if (!trimmed) continue;
    const [planId, rawPlan, ...rest] = trimmed.split('=').map((s) => s.trim());
    const plan = rawPlan
      ? (LEGACY_MARKETPLACE_PLANS[rawPlan] ?? rawPlan)
      : rawPlan;
    if (
      !planId ||
      !plan ||
      rest.length > 0 ||
      !(MARKETPLACE_PLANS as readonly string[]).includes(plan)
    ) {
      invalid.push(trimmed);
      continue;
    }
    map[planId] = plan as MarketplacePlan;
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
 * Microsoft Marketplace settings, read once from the environment. Selling
 * through the Marketplace is off unless KK_MARKETPLACE_ENABLED is "true";
 * while it is off the landing page says the offer isn't available and the
 * webhook answers 404.
 */
@Injectable()
export class MarketplaceConfig {
  private readonly logger = new Logger(MarketplaceConfig.name);

  readonly enabled: boolean;
  readonly tenantId: string;
  readonly clientId: string;
  readonly clientSecret: string;
  readonly planMap: Record<string, MarketplacePlan>;
  /** Offers whose purchases are accepted. Empty accepts any offer. */
  readonly offerIds: string[];

  constructor(config: ConfigService) {
    this.enabled =
      (config.get<string>('KK_MARKETPLACE_ENABLED') ?? '').toLowerCase() ===
      'true';
    this.tenantId = config.get<string>('KK_MARKETPLACE_TENANT_ID') ?? '';
    this.clientId = config.get<string>('KK_MARKETPLACE_CLIENT_ID') ?? '';
    this.clientSecret =
      config.get<string>('KK_MARKETPLACE_CLIENT_SECRET') ?? '';
    const { map, invalid } = parsePlanMap(
      config.get<string>('KK_MARKETPLACE_PLAN_MAP'),
    );
    this.planMap = map;
    this.offerIds = parseList(config.get<string>('KK_MARKETPLACE_OFFER_IDS'));

    if (!this.enabled) return;
    if (invalid.length > 0) {
      this.logger.error(
        `KK_MARKETPLACE_PLAN_MAP has entries that were ignored: ${invalid.join(', ')} (expected <plan id>=pro|business|enterprise)`,
      );
    }
    const missing = this.missingSettings();
    if (missing.length > 0) {
      this.logger.error(
        `KK_MARKETPLACE_ENABLED is true but these settings are empty: ${missing.join(', ')}. Marketplace purchases and webhooks fail until they are set`,
      );
    }
  }

  /** Required settings that are empty. Never includes values. */
  missingSettings(): string[] {
    const missing: string[] = [];
    if (!this.tenantId) missing.push('KK_MARKETPLACE_TENANT_ID');
    if (!this.clientId) missing.push('KK_MARKETPLACE_CLIENT_ID');
    if (!this.clientSecret) missing.push('KK_MARKETPLACE_CLIENT_SECRET');
    if (Object.keys(this.planMap).length === 0) {
      missing.push('KK_MARKETPLACE_PLAN_MAP');
    }
    return missing;
  }

  /** The KrakenKey plan a purchase maps to, or null if it isn't sold here. */
  planFor(
    offerId: string | null | undefined,
    planId: string,
  ): MarketplacePlan | null {
    if (
      this.offerIds.length > 0 &&
      (!offerId || !this.offerIds.includes(offerId))
    ) {
      return null;
    }
    return this.planMap[planId] ?? null;
  }
}
