import { ForbiddenException, HttpException } from '@nestjs/common';
import { GithubOidcService, refAllowed } from './github-oidc.service';

describe('refAllowed', () => {
  it('allows any ref when unrestricted', () => {
    expect(refAllowed('refs/heads/x', null)).toBe(true);
  });
  it('matches exact refs and prefixes ending in *', () => {
    const allowed = ['refs/heads/main', 'refs/tags/v*'];
    expect(refAllowed('refs/heads/main', allowed)).toBe(true);
    expect(refAllowed('refs/tags/v1.2.0', allowed)).toBe(true);
    expect(refAllowed('refs/heads/main2', allowed)).toBe(false);
    expect(refAllowed('refs/heads/feature', allowed)).toBe(false);
    expect(refAllowed(undefined, allowed)).toBe(false);
  });
});

describe('GithubOidcService.exchange', () => {
  const claims = {
    sub: 'repo:octo/site:ref:refs/heads/main',
    repository: 'Octo/Site',
    repository_id: '123',
    repository_owner: 'octo',
    repository_owner_id: '456',
    ref: 'refs/heads/main',
    sha: 'abc',
  };
  const trust = (over: Record<string, unknown> = {}) => ({
    id: 't1',
    userId: 'u1',
    repository: 'octo/site',
    repositoryId: null,
    allowedRefs: null,
    environment: null,
    scopes: ['certs:read', 'certs:renew'],
    allowedDomainIds: ['d1'],
    allowedCertIds: null,
    ...over,
  });

  let candidates: ReturnType<typeof trust>[];
  let repo: { createQueryBuilder: jest.Mock; update: jest.Mock };
  let auth: { createEphemeralApiKey: jest.Mock };
  let verifier: { verify: jest.Mock };
  let svc: GithubOidcService;

  beforeEach(() => {
    candidates = [trust()];
    const qb = {
      where: jest.fn().mockReturnThis(),
      getMany: jest.fn(async () => candidates),
    };
    repo = { createQueryBuilder: jest.fn(() => qb), update: jest.fn() };
    auth = {
      createEphemeralApiKey: jest.fn().mockResolvedValue({
        id: 'k1',
        apiKey: 'kk_x',
        expiresAt: new Date('2026-10-06T00:15:00Z'),
      }),
    };
    verifier = { verify: jest.fn().mockResolvedValue(claims) };
    svc = new GithubOidcService(repo as any, auth as any, verifier as any);
  });

  it('mints a 15-minute key with the trust policy limits and pins the repository id', async () => {
    await expect(svc.exchange('jwt', undefined)).resolves.toEqual({
      apiKey: 'kk_x',
      expiresAt: '2026-10-06T00:15:00.000Z',
      trustId: 't1',
      scopes: ['certs:read', 'certs:renew'],
    });
    expect(auth.createEphemeralApiKey).toHaveBeenCalledWith(
      'u1',
      'GitHub OIDC: Octo/Site@refs/heads/main',
      'github-oidc',
      900,
      {
        scopes: ['certs:read', 'certs:renew'],
        allowedDomainIds: ['d1'],
        allowedCertIds: null,
      },
    );
    expect(repo.update).toHaveBeenCalledWith(
      't1',
      expect.objectContaining({
        repositoryId: '123',
        lastUsedRef: 'refs/heads/main',
      }),
    );
  });

  it('refuses when no policy matches', async () => {
    candidates = [];
    await expect(svc.exchange('jwt', undefined)).rejects.toThrow(
      ForbiddenException,
    );
    expect(auth.createEphemeralApiKey).not.toHaveBeenCalled();
  });

  it('refuses a re-created repository with another id', async () => {
    candidates = [trust({ repositoryId: '999' })];
    await expect(svc.exchange('jwt', undefined)).rejects.toThrow(
      ForbiddenException,
    );
  });

  it('applies ref and environment conditions', async () => {
    candidates = [trust({ allowedRefs: ['refs/tags/v*'] })];
    await expect(svc.exchange('jwt', undefined)).rejects.toThrow(
      ForbiddenException,
    );
    candidates = [trust({ environment: 'production' })];
    await expect(svc.exchange('jwt', undefined)).rejects.toThrow(
      ForbiddenException,
    );
    verifier.verify.mockResolvedValue({ ...claims, environment: 'production' });
    await expect(svc.exchange('jwt', undefined)).resolves.toBeTruthy();
  });

  it('asks for a trust id when several policies match, and uses it', async () => {
    candidates = [trust(), trust({ id: 't2', userId: 'u2' })];
    const err = await svc.exchange('jwt', undefined).catch((e) => e);
    expect(err).toBeInstanceOf(HttpException);
    expect(err.getStatus()).toBe(409);
    expect(err.getResponse()).toMatchObject({ trustIds: ['t1', 't2'] });

    await svc.exchange('jwt', 't2');
    expect(auth.createEphemeralApiKey).toHaveBeenCalledWith(
      'u2',
      expect.any(String),
      'github-oidc',
      900,
      expect.any(Object),
    );
  });

  it('does not reach the database when the token is invalid', async () => {
    verifier.verify.mockRejectedValue(new Error('bad'));
    await expect(svc.exchange('jwt', undefined)).rejects.toThrow('bad');
    expect(repo.createQueryBuilder).not.toHaveBeenCalled();
  });
});
