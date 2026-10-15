import { ResolveCustomerCommand } from '@aws-sdk/client-marketplace-metering';
import { GetEntitlementsCommand } from '@aws-sdk/client-marketplace-entitlement-service';
import { AwsMarketplaceConfig } from './aws-marketplace.config';
import {
  AwsMarketplaceApiError,
  AwsMarketplaceClient,
  AwsMarketplaceTokenError,
  cachedCredentials,
} from './aws-marketplace.client';

const LICENSE = 'arn:aws:license-manager::111122223333:license:l-abc';

function sdkError(name: string, status = 400) {
  return Object.assign(new Error(`${name}: secret token abc`), {
    name,
    $metadata: { httpStatusCode: status },
  });
}

function makeClient() {
  const metering = { send: jest.fn() };
  const entitlement = { send: jest.fn() };
  const config = new AwsMarketplaceConfig({ get: () => undefined } as any);
  const client = new AwsMarketplaceClient(config, {
    metering: metering as any,
    entitlement: entitlement as any,
  });
  return { client, metering, entitlement };
}

describe('AwsMarketplaceClient', () => {
  describe('resolveCustomer', () => {
    it('returns the account, license, product and agreement', async () => {
      const { client, metering } = makeClient();
      metering.send.mockResolvedValue({
        CustomerAWSAccountId: '444455556666',
        CustomerIdentifier: '',
        LicenseArn: LICENSE,
        ProductCode: 'prod-code',
        Metadata: { AgreementId: 'agmt-1' },
      });
      await expect(client.resolveCustomer('tok')).resolves.toEqual({
        customerAwsAccountId: '444455556666',
        licenseArn: LICENSE,
        productCode: 'prod-code',
        agreementId: 'agmt-1',
      });
      const [command, options] = metering.send.mock.calls[0];
      expect(command).toBeInstanceOf(ResolveCustomerCommand);
      expect(command.input).toEqual({ RegistrationToken: 'tok' });
      expect(options.abortSignal).toBeDefined();
    });

    it('reports an invalid or expired token as a token error', async () => {
      const { client, metering } = makeClient();
      metering.send.mockRejectedValueOnce(sdkError('InvalidTokenException'));
      await expect(client.resolveCustomer('tok')).rejects.toBeInstanceOf(
        AwsMarketplaceTokenError,
      );
      metering.send.mockRejectedValueOnce(sdkError('ExpiredTokenException'));
      await expect(client.resolveCustomer('tok')).rejects.toMatchObject({
        code: 'ExpiredTokenException',
      });
    });

    it('reports other failures by error name only, never the message', async () => {
      const { client, metering } = makeClient();
      metering.send.mockRejectedValue(sdkError('ThrottlingException'));
      const err = await client.resolveCustomer('tok').catch((e: Error) => e);
      expect(err).toBeInstanceOf(AwsMarketplaceApiError);
      expect((err as AwsMarketplaceApiError).code).toBe('ThrottlingException');
      expect((err as Error).message).not.toContain('secret');
    });

    it('refuses a response without a license ARN', async () => {
      const { client, metering } = makeClient();
      metering.send.mockResolvedValue({
        CustomerAWSAccountId: '444455556666',
        ProductCode: 'prod-code',
      });
      await expect(client.resolveCustomer('tok')).rejects.toMatchObject({
        code: 'IncompleteResponse',
      });
    });
  });

  describe('getEntitlements', () => {
    it('filters by license ARN and reads every page', async () => {
      const { client, entitlement } = makeClient();
      entitlement.send
        .mockResolvedValueOnce({ Entitlements: [], NextToken: 'p2' })
        .mockResolvedValueOnce({
          Entitlements: [
            {
              Dimension: 'pro',
              LicenseArn: LICENSE,
              CustomerAWSAccountId: '444455556666',
              ProductCode: 'prod-code',
              ExpirationDate: new Date('2027-01-01T00:00:00Z'),
              Value: { IntegerValue: 1 },
            },
            { LicenseArn: LICENSE },
          ],
        });
      const result = await client.getEntitlements('prod-code', LICENSE);
      expect(result).toEqual([
        {
          dimension: 'pro',
          licenseArn: LICENSE,
          customerAwsAccountId: '444455556666',
          productCode: 'prod-code',
          expirationDate: new Date('2027-01-01T00:00:00Z'),
          value: {
            integer: 1,
            double: undefined,
            boolean: undefined,
            string: undefined,
          },
        },
      ]);
      const inputs = entitlement.send.mock.calls.map(
        (c: [GetEntitlementsCommand]) => c[0].input,
      );
      expect(inputs[0]).toEqual({
        ProductCode: 'prod-code',
        Filter: { LICENSE_ARN: [LICENSE] },
        MaxResults: 25,
        NextToken: undefined,
      });
      expect(inputs[1].NextToken).toBe('p2');
    });

    it('wraps failures', async () => {
      const { client, entitlement } = makeClient();
      entitlement.send.mockRejectedValue(
        sdkError('InternalServiceErrorException', 500),
      );
      await expect(
        client.getEntitlements('prod-code', LICENSE),
      ).rejects.toMatchObject({
        operation: 'GetEntitlements',
        code: 'InternalServiceErrorException',
        status: 500,
      });
    });

    it('stops following NextToken after a bounded number of pages', async () => {
      const { client, entitlement } = makeClient();
      entitlement.send.mockResolvedValue({
        Entitlements: [],
        NextToken: 'again',
      });
      await expect(
        client.getEntitlements('prod-code', LICENSE),
      ).rejects.toMatchObject({ code: 'TooManyPages' });
      expect(entitlement.send).toHaveBeenCalledTimes(20);
    });
  });
});

describe('cachedCredentials', () => {
  const creds = (expiresInMs: number, now: number) => ({
    accessKeyId: 'AKIA',
    secretAccessKey: 'secret',
    sessionToken: 'session',
    expiration: new Date(now + expiresInMs),
  });

  it('reuses credentials until five minutes before they expire', async () => {
    let now = 1_000_000;
    const provider = jest.fn(async () => creds(60 * 60 * 1000, now));
    const cached = cachedCredentials(provider, 5 * 60 * 1000, () => now);
    await cached();
    now += 50 * 60 * 1000;
    await cached();
    expect(provider).toHaveBeenCalledTimes(1);
    now += 6 * 60 * 1000; // 4 minutes left
    await cached();
    expect(provider).toHaveBeenCalledTimes(2);
  });

  it('shares one refresh between concurrent callers', async () => {
    const provider = jest.fn(async () => creds(3600_000, Date.now()));
    const cached = cachedCredentials(provider);
    await Promise.all([cached(), cached(), cached()]);
    expect(provider).toHaveBeenCalledTimes(1);
  });

  it('tries again after a failed refresh', async () => {
    const provider = jest
      .fn()
      .mockRejectedValueOnce(new Error('sts down'))
      .mockResolvedValueOnce(creds(3600_000, Date.now()));
    const cached = cachedCredentials(provider);
    await expect(cached()).rejects.toThrow('sts down');
    await expect(cached()).resolves.toMatchObject({ accessKeyId: 'AKIA' });
  });

  it('keeps credentials without an expiration', async () => {
    const provider = jest.fn(async () => ({
      accessKeyId: 'AKIA',
      secretAccessKey: 'secret',
    }));
    const cached = cachedCredentials(provider);
    await cached();
    await cached();
    expect(provider).toHaveBeenCalledTimes(1);
  });
});
