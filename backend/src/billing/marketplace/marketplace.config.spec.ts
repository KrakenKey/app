import { ConfigService } from '@nestjs/config';
import { MarketplaceConfig, parsePlanMap } from './marketplace.config';

function configFor(env: Record<string, string>): MarketplaceConfig {
  const config = new MarketplaceConfig({
    get: (key: string) => env[key],
  } as unknown as ConfigService);
  return config;
}

describe('parsePlanMap', () => {
  it('maps Marketplace plan ids to KrakenKey plans', () => {
    expect(
      parsePlanMap(
        ' kk-starter-monthly=starter, kk-starter-yearly=starter,kk-team=team ,kk-biz=business',
      ),
    ).toEqual({
      map: {
        'kk-starter-monthly': 'starter',
        'kk-starter-yearly': 'starter',
        'kk-team': 'team',
        'kk-biz': 'business',
      },
      invalid: [],
    });
  });

  it('leaves out entries that do not parse or name another plan', () => {
    expect(
      parsePlanMap('a=starter,b=enterprise,c=free,d,=team,e=team=x'),
    ).toEqual({
      map: { a: 'starter' },
      invalid: ['b=enterprise', 'c=free', 'd', '=team', 'e=team=x'],
    });
  });

  it('is empty when unset', () => {
    expect(parsePlanMap(undefined)).toEqual({ map: {}, invalid: [] });
  });
});

describe('MarketplaceConfig', () => {
  it('is off unless KK_MARKETPLACE_ENABLED is "true"', () => {
    expect(configFor({}).enabled).toBe(false);
    expect(configFor({ KK_MARKETPLACE_ENABLED: 'false' }).enabled).toBe(false);
    expect(configFor({ KK_MARKETPLACE_ENABLED: '1' }).enabled).toBe(false);
  });

  it('lists missing settings by name only', () => {
    const config = configFor({
      KK_MARKETPLACE_ENABLED: 'true',
      KK_MARKETPLACE_TENANT_ID: 't',
    });
    expect(config.enabled).toBe(true);
    expect(config.missingSettings()).toEqual([
      'KK_MARKETPLACE_CLIENT_ID',
      'KK_MARKETPLACE_CLIENT_SECRET',
      'KK_MARKETPLACE_PLAN_MAP',
    ]);
  });

  it('maps plans for any offer when no offer list is set', () => {
    const config = configFor({ KK_MARKETPLACE_PLAN_MAP: 'p1=team' });
    expect(config.planFor('any-offer', 'p1')).toBe('team');
    expect(config.planFor('any-offer', 'p2')).toBeNull();
  });

  it('refuses offers that are not listed', () => {
    const config = configFor({
      KK_MARKETPLACE_PLAN_MAP: 'p1=team',
      KK_MARKETPLACE_OFFER_IDS: 'krakenkey, krakenkey-dev',
    });
    expect(config.planFor('krakenkey-dev', 'p1')).toBe('team');
    expect(config.planFor('other-offer', 'p1')).toBeNull();
    expect(config.planFor(undefined, 'p1')).toBeNull();
  });
});
