import { Logger } from '@nestjs/common';
import {
  AwsMarketplaceConfig,
  parseDimensionMap,
  queueRegion,
} from './aws-marketplace.config';

function configWith(env: Record<string, string | undefined>) {
  return new AwsMarketplaceConfig({ get: (key: string) => env[key] } as any);
}

const QUEUE = 'https://sqs.us-east-1.amazonaws.com/111122223333/kk-aws-mp';

describe('parseDimensionMap', () => {
  it('parses dimension=plan pairs', () => {
    expect(parseDimensionMap('pro=pro, business = business')).toEqual({
      map: { pro: 'pro', business: 'business' },
      invalid: [],
    });
  });

  it('lets several dimensions map to one plan', () => {
    expect(parseDimensionMap('pro=pro,pro_private=pro').map).toEqual({
      pro: 'pro',
      pro_private: 'pro',
    });
  });

  it('accepts enterprise for private offers', () => {
    expect(parseDimensionMap('ent=enterprise').map).toEqual({
      ent: 'enterprise',
    });
  });

  it('reports entries that do not parse and leaves them out', () => {
    const { map, invalid } = parseDimensionMap(
      'pro=pro,free=free,starter=starter,=pro,business,a=b=c,',
    );
    expect(map).toEqual({ pro: 'pro' });
    expect(invalid).toEqual([
      'free=free',
      'starter=starter',
      '=pro',
      'business',
      'a=b=c',
    ]);
  });

  it('treats an unset map as empty', () => {
    expect(parseDimensionMap(undefined)).toEqual({ map: {}, invalid: [] });
  });
});

describe('queueRegion', () => {
  it('reads the region from an SQS queue URL', () => {
    expect(queueRegion(QUEUE)).toBe('us-east-1');
    expect(
      queueRegion('https://sqs.eu-west-2.amazonaws.com/111122223333/q'),
    ).toBe('eu-west-2');
  });

  it('returns null for anything else', () => {
    expect(queueRegion('http://sqs.us-east-1.amazonaws.com/1/q')).toBeNull();
    expect(queueRegion('https://example.com/q')).toBeNull();
    expect(queueRegion('')).toBeNull();
  });
});

describe('AwsMarketplaceConfig', () => {
  let error: jest.SpyInstance;
  let warn: jest.SpyInstance;
  beforeEach(() => {
    error = jest.spyOn(Logger.prototype, 'error').mockImplementation();
    warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
  });
  afterEach(() => jest.restoreAllMocks());

  it('is off unless KK_AWS_MARKETPLACE_ENABLED is "true"', () => {
    expect(configWith({}).enabled).toBe(false);
    expect(configWith({ KK_AWS_MARKETPLACE_ENABLED: 'yes' }).enabled).toBe(
      false,
    );
    expect(configWith({ KK_AWS_MARKETPLACE_ENABLED: 'TRUE' }).enabled).toBe(
      true,
    );
  });

  it('logs nothing while off, even with bad settings', () => {
    configWith({ KK_AWS_MARKETPLACE_DIMENSION_MAP: 'x=y' });
    expect(error).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
  });

  it('logs ignored map entries, an empty map and a missing queue by name when on', () => {
    configWith({
      KK_AWS_MARKETPLACE_ENABLED: 'true',
      KK_AWS_MARKETPLACE_DIMENSION_MAP: 'x=y',
    });
    expect(error.mock.calls.map((c) => String(c[0])).join('\n')).toMatch(
      /ignored: x=y[\s\S]*DIMENSION_MAP is empty/,
    );
    expect(String(warn.mock.calls[0][0])).toContain(
      'KK_AWS_MARKETPLACE_QUEUE_URL is empty',
    );
  });

  it('logs a queue URL that is not an SQS URL', () => {
    const config = configWith({
      KK_AWS_MARKETPLACE_ENABLED: 'true',
      KK_AWS_MARKETPLACE_DIMENSION_MAP: 'pro=pro',
      KK_AWS_MARKETPLACE_QUEUE_URL: 'https://example.com/q',
    });
    expect(String(error.mock.calls[0][0])).toContain('not an SQS queue URL');
    expect(config.consumerEnabled).toBe(false);
  });

  it('reads the role, product codes, queue and app domain', () => {
    const config = configWith({
      KK_AWS_MARKETPLACE_ENABLED: 'true',
      KK_AWS_MARKETPLACE_ROLE_ARN: ' arn:aws:iam::111122223333:role/kk ',
      KK_AWS_MARKETPLACE_PRODUCT_CODES: 'abc, def',
      KK_AWS_MARKETPLACE_DIMENSION_MAP: 'pro=pro,business=business',
      KK_AWS_MARKETPLACE_QUEUE_URL: QUEUE,
      KK_APP_DOMAIN: 'app-dev.krakenkey.io',
    });
    expect(config.roleArn).toBe('arn:aws:iam::111122223333:role/kk');
    expect(config.productCodes).toEqual(['abc', 'def']);
    expect(config.queueUrl).toBe(QUEUE);
    expect(config.consumerEnabled).toBe(true);
    expect(config.appDomain).toBe('app-dev.krakenkey.io');
    expect(error).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
  });

  it('runs no consumer while off, even with a queue', () => {
    expect(
      configWith({ KK_AWS_MARKETPLACE_QUEUE_URL: QUEUE }).consumerEnabled,
    ).toBe(false);
  });

  it('accepts any product when no codes are set, otherwise only listed ones', () => {
    expect(configWith({}).acceptsProduct('abc')).toBe(true);
    expect(configWith({}).acceptsProduct('')).toBe(false);
    const config = configWith({ KK_AWS_MARKETPLACE_PRODUCT_CODES: 'abc' });
    expect(config.acceptsProduct('abc')).toBe(true);
    expect(config.acceptsProduct('other')).toBe(false);
    expect(config.acceptsProduct(null)).toBe(false);
  });

  it('maps dimensions to plans', () => {
    const config = configWith({
      KK_AWS_MARKETPLACE_DIMENSION_MAP: 'pro=pro,business=business',
    });
    expect(config.planFor('business')).toBe('business');
    expect(config.planFor('gold')).toBeNull();
    expect(config.planFor(null)).toBeNull();
  });
});
