import { generateKeyPairSync } from 'node:crypto';
import * as jwt from 'jsonwebtoken';
import { UnauthorizedException } from '@nestjs/common';
import { MarketplaceWebhookVerifier } from './marketplace-webhook.verifier';
import {
  MARKETPLACE_RESOURCE_ID,
  type MarketplaceConfig,
} from './marketplace.config';

const TENANT = '11111111-1111-4111-8111-111111111111';
const OTHER_TENANT = '22222222-2222-4222-8222-222222222222';
const CLIENT = '33333333-3333-4333-8333-333333333333';

const { privateKey, publicKey } = generateKeyPairSync('rsa', {
  modulusLength: 2048,
});
const other = generateKeyPairSync('rsa', { modulusLength: 2048 });

const baseClaims = { tid: TENANT, appid: MARKETPLACE_RESOURCE_ID };

function sign(
  claims: object = baseClaims,
  opts: jwt.SignOptions = {},
  key: jwt.Secret = privateKey,
): string {
  return jwt.sign(claims, key, {
    algorithm: 'RS256',
    keyid: 'k1',
    issuer: `https://sts.windows.net/${TENANT}/`,
    audience: CLIENT,
    expiresIn: 300,
    ...opts,
  });
}

describe('MarketplaceWebhookVerifier', () => {
  const jwks = {
    getSigningKeys: jest.fn(async () => [
      {
        kid: 'k1',
        getPublicKey: () =>
          publicKey.export({ type: 'spki', format: 'pem' }) as string,
      },
    ]),
  };
  const config = {
    tenantId: TENANT,
    clientId: CLIENT,
  } as unknown as MarketplaceConfig;
  let verifier: MarketplaceWebhookVerifier;
  const bearer = (token: string) => `Bearer ${token}`;

  beforeEach(() => {
    jwks.getSigningKeys.mockClear();
    verifier = new MarketplaceWebhookVerifier(config, jwks as any);
    jest
      .spyOn((verifier as any).logger, 'warn')
      .mockImplementation(() => undefined);
  });

  it('accepts a v1 token from the tenant for our app', async () => {
    await expect(verifier.verify(bearer(sign()))).resolves.toBeUndefined();
  });

  it('accepts a v2 token with azp instead of appid', async () => {
    const token = sign(
      { tid: TENANT, azp: MARKETPLACE_RESOURCE_ID },
      { issuer: `https://login.microsoftonline.com/${TENANT}/v2.0` },
    );
    await expect(verifier.verify(bearer(token))).resolves.toBeUndefined();
  });

  it.each([
    ['no Authorization header', () => undefined],
    ['a non-bearer header', () => `Basic ${sign()}`],
    ['a token that is not a JWT', () => bearer('not-a-jwt')],
    [
      'the wrong audience',
      () => bearer(sign(baseClaims, { audience: 'another-app' })),
    ],
    [
      'an issuer from another tenant',
      () =>
        bearer(
          sign(baseClaims, {
            issuer: `https://sts.windows.net/${OTHER_TENANT}/`,
          }),
        ),
    ],
    [
      'a tid from another tenant',
      () => bearer(sign({ ...baseClaims, tid: OTHER_TENANT })),
    ],
    [
      'a caller other than the Marketplace API',
      () => bearer(sign({ tid: TENANT, appid: 'someone-else' })),
    ],
    [
      'an expired token',
      () =>
        bearer(
          jwt.sign(
            { ...baseClaims, exp: Math.floor(Date.now() / 1000) - 300 },
            privateKey,
            {
              algorithm: 'RS256',
              keyid: 'k1',
              issuer: `https://sts.windows.net/${TENANT}/`,
              audience: CLIENT,
            },
          ),
        ),
    ],
    [
      'a token without exp',
      () =>
        bearer(
          jwt.sign(baseClaims, privateKey, {
            algorithm: 'RS256',
            keyid: 'k1',
            issuer: `https://sts.windows.net/${TENANT}/`,
            audience: CLIENT,
          }),
        ),
    ],
    ['a bad signature', () => bearer(sign(baseClaims, {}, other.privateKey))],
    ['an unknown key id', () => bearer(sign(baseClaims, { keyid: 'k2' }))],
    [
      'an HS256 token',
      () =>
        bearer(
          jwt.sign(baseClaims, 'shared-secret', {
            algorithm: 'HS256',
            keyid: 'k1',
            issuer: `https://sts.windows.net/${TENANT}/`,
            audience: CLIENT,
            expiresIn: 300,
          }),
        ),
    ],
  ])('rejects %s', async (_label, header) => {
    await expect(verifier.verify(header())).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it('rejects everything when the tenant or client id is not configured', async () => {
    const unconfigured = new MarketplaceWebhookVerifier(
      { tenantId: '', clientId: '' } as unknown as MarketplaceConfig,
      jwks as any,
    );
    jest
      .spyOn((unconfigured as any).logger, 'warn')
      .mockImplementation(() => undefined);
    await expect(unconfigured.verify(bearer(sign()))).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it('never logs the token', async () => {
    const warn = jest.spyOn((verifier as any).logger, 'warn');
    const token = sign(baseClaims, { audience: 'another-app' });
    await verifier.verify(bearer(token)).catch(() => undefined);
    for (const [msg] of warn.mock.calls) {
      expect(String(msg)).not.toContain(token);
    }
  });

  it('downloads the key set once and reuses it', async () => {
    await verifier.verify(bearer(sign()));
    await verifier.verify(bearer(sign()));
    expect(jwks.getSigningKeys).toHaveBeenCalledTimes(1);
  });

  it('limits key downloads for unknown key ids', async () => {
    jest.useFakeTimers({ now: new Date('2026-10-13T00:00:00Z') });
    try {
      await verifier.verify(bearer(sign())); // first download
      for (let i = 0; i < 20; i++) {
        await verifier
          .verify(bearer(sign(baseClaims, { keyid: `junk-${i}` })))
          .catch(() => undefined);
      }
      expect(jwks.getSigningKeys).toHaveBeenCalledTimes(1);

      jest.setSystemTime(new Date('2026-10-13T00:06:00Z'));
      await verifier
        .verify(bearer(sign(baseClaims, { keyid: 'rotated' })))
        .catch(() => undefined);
      expect(jwks.getSigningKeys).toHaveBeenCalledTimes(2);
    } finally {
      jest.useRealTimers();
    }
  });

  it('does not download keys for a token meant for another tenant or app', async () => {
    await verifier
      .verify(bearer(sign({ ...baseClaims, tid: OTHER_TENANT })))
      .catch(() => undefined);
    await verifier
      .verify(bearer(sign(baseClaims, { audience: 'another-app' })))
      .catch(() => undefined);
    expect(jwks.getSigningKeys).not.toHaveBeenCalled();
  });
});
