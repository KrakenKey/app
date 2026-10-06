import { generateKeyPairSync } from 'node:crypto';
import * as jwt from 'jsonwebtoken';
import { UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { GITHUB_OIDC_ISSUER } from '@krakenkey/shared';
import { GithubOidcVerifier } from './github-oidc.verifier';

const { privateKey, publicKey } = generateKeyPairSync('rsa', {
  modulusLength: 2048,
});
const other = generateKeyPairSync('rsa', { modulusLength: 2048 });
const AUD = 'https://api.krakenkey.io';

const claims = {
  sub: 'repo:octo/site:ref:refs/heads/main',
  repository: 'octo/site',
  repository_id: '123',
  repository_owner: 'octo',
  repository_owner_id: '456',
  ref: 'refs/heads/main',
};

function sign(
  payload: object = claims,
  opts: jwt.SignOptions = {},
  key: jwt.Secret = privateKey,
) {
  return jwt.sign(payload, key, {
    algorithm: 'RS256',
    keyid: 'k1',
    issuer: GITHUB_OIDC_ISSUER,
    audience: AUD,
    expiresIn: 300,
    ...opts,
  });
}

describe('GithubOidcVerifier', () => {
  const jwks = {
    getSigningKey: jest.fn(async (kid?: string) => {
      if (kid !== 'k1') throw new Error('unknown kid');
      return {
        getPublicKey: () => publicKey.export({ type: 'spki', format: 'pem' }),
      };
    }),
  };
  const config = (aud?: string) =>
    ({ get: () => aud }) as unknown as ConfigService;
  const verifier = new GithubOidcVerifier(config(), jwks as any);

  it('accepts a valid token and returns its claims', async () => {
    await expect(verifier.verify(sign())).resolves.toMatchObject(claims);
    expect(jwks.getSigningKey).toHaveBeenCalledWith('k1');
  });

  it('uses KK_GITHUB_OIDC_AUDIENCE when set', async () => {
    const dev = new GithubOidcVerifier(
      config('https://api-dev.krakenkey.io'),
      jwks as any,
    );
    await expect(dev.verify(sign())).rejects.toThrow(UnauthorizedException);
    await expect(
      dev.verify(sign(claims, { audience: 'https://api-dev.krakenkey.io' })),
    ).resolves.toBeTruthy();
  });

  it.each([
    ['another issuer', () => sign(claims, { issuer: 'https://evil.example' })],
    [
      'another audience',
      () => sign(claims, { audience: 'https://other.example' }),
    ],
    [
      'an expired token',
      () =>
        jwt.sign(
          { ...claims, exp: Math.floor(Date.now() / 1000) - 120 },
          privateKey,
          {
            algorithm: 'RS256',
            keyid: 'k1',
            issuer: GITHUB_OIDC_ISSUER,
            audience: AUD,
          },
        ),
    ],
    ['an unknown kid', () => sign(claims, { keyid: 'k2' })],
    ['a token signed by another key', () => sign(claims, {}, other.privateKey)],
    [
      'HS256',
      () =>
        jwt.sign(claims, 'secret', {
          algorithm: 'HS256',
          keyid: 'k1',
          issuer: GITHUB_OIDC_ISSUER,
          audience: AUD,
        }),
    ],
    [
      'alg none',
      () =>
        jwt.sign(claims, '', {
          algorithm: 'none',
          keyid: 'k1',
          issuer: GITHUB_OIDC_ISSUER,
          audience: AUD,
        } as jwt.SignOptions),
    ],
    [
      'a missing repository_id',
      () => sign({ ...claims, repository_id: undefined }),
    ],
    ['garbage', () => 'not.a.jwt'],
  ])('rejects %s with a generic 401', async (_label, make) => {
    await expect(verifier.verify(make())).rejects.toThrow(
      new UnauthorizedException('Invalid GitHub OIDC token'),
    );
  });
});
