import {
  BadRequestException,
  ConflictException,
  HttpException,
  NotFoundException,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { generateKeyPairSync, sign } from 'node:crypto';
import { ConnectorsService } from './connectors.service';
import { rotateMessage, tokenMessage } from './connector-crypto';

const ID = '3f1c2b9e-1111-4111-8111-111111111111';

function keyPair() {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const x = publicKey.export({ format: 'jwk' }).x!;
  return {
    privateKey,
    publicB64: Buffer.from(x, 'base64url').toString('base64'),
  };
}

const now = () => new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
const NONCE = 'AAAAAAAAAAAAAAAAAAAAAA';

function signed(
  key: ReturnType<typeof keyPair>,
  over: { connectorId?: string; timestamp?: string; nonce?: string } = {},
) {
  const connectorId = over.connectorId ?? ID;
  const timestamp = over.timestamp ?? now();
  const nonce = over.nonce ?? NONCE;
  const signature = sign(
    null,
    Buffer.from(tokenMessage(connectorId, timestamp, nonce)),
    key.privateKey,
  ).toString('base64');
  return { connectorId: ID, timestamp, nonce, signature };
}

describe('ConnectorsService', () => {
  const key = keyPair();
  let row: Record<string, any>;
  let qb: Record<string, jest.Mock>;
  let repo: Record<string, jest.Mock>;
  let auth: Record<string, jest.Mock>;
  let billing: { resolveUserTier: jest.Mock };
  let nonces: { claim: jest.Mock };
  let svc: ConnectorsService;

  const enrolled = (over: Record<string, unknown> = {}) => ({
    id: ID,
    userId: 'u1',
    name: 'web-01',
    clientLabel: null,
    scopes: ['certs:read', 'certs:renew'],
    allowedCertIds: [7],
    allowedDomainIds: null,
    publicKey: key.publicB64,
    enrolledAt: new Date(),
    revokedAt: null,
    lastSeenAt: null,
    version: '0.2.0',
    os: 'linux',
    arch: 'amd64',
    createdAt: new Date(),
    ...over,
  });

  beforeEach(() => {
    row = enrolled();
    qb = {
      update: jest.fn().mockReturnThis(),
      set: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      returning: jest.fn().mockReturnThis(),
      execute: jest.fn().mockResolvedValue({ raw: [] }),
    };
    repo = {
      find: jest.fn().mockResolvedValue([]),
      findOne: jest.fn(async () => row),
      count: jest.fn().mockResolvedValue(0),
      create: jest.fn((v: Record<string, unknown>) => ({
        id: ID,
        createdAt: new Date(),
        ...v,
      })),
      save: jest.fn(),
      update: jest.fn().mockResolvedValue({ affected: 1 }),
      createQueryBuilder: jest.fn(() => qb),
    };
    auth = {
      hmacSecret: jest.fn((raw: string) => `hash(${raw})`),
      validateRestrictions: jest.fn(
        async (_u: string, r: Record<string, unknown[] | undefined>) => ({
          scopes: null,
          allowedCertIds: r.allowedCertIds?.length ? r.allowedCertIds : null,
          allowedDomainIds: r.allowedDomainIds?.length
            ? r.allowedDomainIds
            : null,
          allowedIps: null,
        }),
      ),
      createEphemeralApiKey: jest.fn().mockResolvedValue({
        id: 'k1',
        apiKey: 'kk_short',
        expiresAt: new Date('2026-10-10T15:00:00Z'),
      }),
      revokeConnectorKeys: jest.fn().mockResolvedValue(2),
    };
    billing = { resolveUserTier: jest.fn().mockResolvedValue('free') };
    nonces = { claim: jest.fn().mockResolvedValue(true) };
    svc = new ConnectorsService(
      repo as any,
      auth as any,
      billing as any,
      nonces as any,
    );
  });

  describe('create', () => {
    const dto = (over: Record<string, unknown> = {}) =>
      ({
        name: 'web-01',
        scopes: ['certs:read', 'certs:renew'],
        allowedCertIds: [7],
        ...over,
      }) as any;

    it('stores only the hash of a kkce_ token that expires in 24 hours', async () => {
      const res = await svc.create('u1', dto({ clientLabel: 'Acme' }));
      expect(res.enrollmentToken).toMatch(/^kkce_[A-Za-z0-9_-]{43}$/);
      const saved = repo.save.mock.calls[0][0];
      expect(saved.enrollmentTokenHash).toBe(`hash(${res.enrollmentToken})`);
      expect(JSON.stringify(saved)).not.toContain(res.enrollmentToken + '"');
      expect(
        saved.enrollmentTokenExpiresAt.getTime() - Date.now(),
      ).toBeGreaterThan(24 * 3600_000 - 5000);
      expect(res.connector).toMatchObject({
        id: ID,
        name: 'web-01',
        clientLabel: 'Acme',
        scopes: ['certs:read', 'certs:renew'],
        allowedCertIds: [7],
        allowedDomainIds: null,
        enrolledAt: null,
        revokedAt: null,
      });
      expect(res.connector).not.toHaveProperty('enrollmentTokenHash');
      expect(res.expiresAt).toBe(saved.enrollmentTokenExpiresAt.toISOString());
      expect(res.connector.enrollmentTokenExpiresAt).toBe(res.expiresAt);
    });

    it('requires certs:read', async () => {
      await expect(
        svc.create('u1', dto({ scopes: ['certs:renew'] })),
      ).rejects.toThrow('scopes must include certs:read');
    });

    it('refuses an unrestricted connector', async () => {
      await expect(
        svc.create('u1', dto({ allowedCertIds: [], allowedDomainIds: [] })),
      ).rejects.toThrow(BadRequestException);
      await expect(
        svc.create('u1', dto({ allowedCertIds: undefined })),
      ).rejects.toThrow(BadRequestException);
      expect(repo.save).not.toHaveBeenCalled();
    });

    it('checks the restrictions belong to the user', async () => {
      auth.validateRestrictions.mockRejectedValue(
        new BadRequestException('Unknown certificate id(s): 7'),
      );
      await expect(svc.create('u1', dto())).rejects.toThrow(
        'Unknown certificate id(s): 7',
      );
    });

    it('caps active connectors at 50 with a 402', async () => {
      repo.count.mockResolvedValue(50);
      const err = await svc.create('u1', dto()).catch((e) => e);
      expect(err).toBeInstanceOf(HttpException);
      expect(err.getStatus()).toBe(402);
      expect(err.getResponse()).toEqual({
        message: 'Connector limit reached',
        code: 'plan_limit_exceeded',
        limit: 50,
        current: 50,
        plan: 'free',
      });
      expect(repo.count).toHaveBeenCalledWith({
        where: { userId: 'u1', revokedAt: expect.anything() },
      });
      expect(repo.save).not.toHaveBeenCalled();
    });
  });

  describe('reissueEnrollmentToken', () => {
    it('replaces the token of a connector that has not enrolled', async () => {
      row = enrolled({ enrolledAt: null, publicKey: null });
      const res = await svc.reissueEnrollmentToken('u1', ID);
      expect(res.enrollmentToken).toMatch(/^kkce_/);
      expect(Date.parse(res.expiresAt) - Date.now()).toBeGreaterThan(
        24 * 3600_000 - 5000,
      );
      expect(repo.update).toHaveBeenCalledWith(
        expect.objectContaining({ id: ID, userId: 'u1' }),
        expect.objectContaining({
          enrollmentTokenHash: `hash(${res.enrollmentToken})`,
        }),
      );
    });

    it('refuses enrolled or revoked connectors with 409', async () => {
      await expect(svc.reissueEnrollmentToken('u1', ID)).rejects.toThrow(
        ConflictException,
      );
      row = enrolled({ enrolledAt: null, revokedAt: new Date() });
      await expect(svc.reissueEnrollmentToken('u1', ID)).rejects.toThrow(
        ConflictException,
      );
      row = enrolled({ enrolledAt: null });
      repo.update.mockResolvedValue({ affected: 0 });
      await expect(svc.reissueEnrollmentToken('u1', ID)).rejects.toThrow(
        ConflictException,
      );
    });

    it('404s for another user', async () => {
      row = null as any;
      await expect(svc.reissueEnrollmentToken('u2', ID)).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('enrollmentTokenExpiresAt', () => {
    it('is shown only while a token can still be used', async () => {
      const at = new Date('2026-10-11T00:00:00Z');
      row = enrolled({ enrolledAt: null, enrollmentTokenExpiresAt: at });
      expect((await svc.get('u1', ID)).enrollmentTokenExpiresAt).toBe(
        '2026-10-11T00:00:00.000Z',
      );
      row = enrolled({ enrollmentTokenExpiresAt: at });
      expect((await svc.get('u1', ID)).enrollmentTokenExpiresAt).toBeNull();
      row = enrolled({
        enrolledAt: null,
        revokedAt: new Date(),
        enrollmentTokenExpiresAt: at,
      });
      expect((await svc.get('u1', ID)).enrollmentTokenExpiresAt).toBeNull();
    });
  });

  describe('update restrictions', () => {
    it('replaces certificate ids after checking them and revokes live keys', async () => {
      const res = await svc.update('u1', ID, { allowedCertIds: [8, 9] });
      expect(auth.validateRestrictions).toHaveBeenCalledWith('u1', {
        allowedCertIds: [8, 9],
        allowedDomainIds: undefined,
      });
      expect(repo.update).toHaveBeenCalledWith(
        { id: ID, userId: 'u1', revokedAt: expect.anything() },
        { allowedCertIds: [8, 9] },
      );
      expect(auth.revokeConnectorKeys).toHaveBeenCalledWith(ID);
      expect(res.allowedCertIds).toEqual([8, 9]);
    });

    it('swaps a certificate restriction for a domain restriction', async () => {
      const d = '11111111-1111-4111-8111-111111111111';
      await svc.update('u1', ID, {
        allowedCertIds: null,
        allowedDomainIds: [d],
      });
      expect(repo.update).toHaveBeenCalledWith(expect.anything(), {
        allowedCertIds: null,
        allowedDomainIds: [d],
      });
      expect(auth.revokeConnectorKeys).toHaveBeenCalled();
    });

    it('refuses removing the last restriction', async () => {
      for (const dto of [
        { allowedCertIds: [] },
        { allowedCertIds: null },
        { allowedCertIds: null, allowedDomainIds: null },
      ]) {
        await expect(svc.update('u1', ID, dto as any)).rejects.toThrow(
          BadRequestException,
        );
      }
      expect(repo.update).not.toHaveBeenCalled();
      expect(auth.revokeConnectorKeys).not.toHaveBeenCalled();
    });

    it('changes scopes, requiring certs:read', async () => {
      await expect(
        svc.update('u1', ID, { scopes: ['certs:renew'] }),
      ).rejects.toThrow('scopes must include certs:read');
      await svc.update('u1', ID, { scopes: ['certs:read'] });
      expect(repo.update).toHaveBeenCalledWith(expect.anything(), {
        scopes: ['certs:read'],
      });
      expect(auth.revokeConnectorKeys).toHaveBeenCalledTimes(1);
    });

    it('keeps keys when nothing that limits them changes', async () => {
      await svc.update('u1', ID, {
        name: 'renamed',
        scopes: ['certs:renew', 'certs:read'],
        allowedCertIds: [7],
      });
      expect(repo.update).toHaveBeenCalledWith(expect.anything(), {
        name: 'renamed',
      });
      expect(auth.revokeConnectorKeys).not.toHaveBeenCalled();
    });

    it('refuses foreign ids', async () => {
      auth.validateRestrictions.mockRejectedValueOnce(
        new BadRequestException('Unknown certificate id(s): 99'),
      );
      await expect(
        svc.update('u1', ID, { allowedCertIds: [99] }),
      ).rejects.toThrow('Unknown certificate id(s): 99');
      expect(repo.update).not.toHaveBeenCalled();
    });

    it('409s when the connector was revoked meanwhile', async () => {
      repo.update.mockResolvedValueOnce({ affected: 0 });
      await expect(
        svc.update('u1', ID, { allowedCertIds: [8] }),
      ).rejects.toThrow(ConflictException);
      expect(auth.revokeConnectorKeys).not.toHaveBeenCalled();
    });
  });

  describe('update', () => {
    it('refuses a revoked connector with 409', async () => {
      row = enrolled({ revokedAt: new Date() });
      await expect(svc.update('u1', ID, { name: 'x' })).rejects.toThrow(
        ConflictException,
      );
      expect(repo.update).not.toHaveBeenCalled();
    });

    it('renames and clears the client label', async () => {
      row = enrolled({ clientLabel: 'Acme' });
      const res = await svc.update('u1', ID, {
        name: 'web-02',
        clientLabel: null,
      });
      expect(repo.update).toHaveBeenCalledWith(
        { id: ID, userId: 'u1', revokedAt: expect.anything() },
        { name: 'web-02', clientLabel: null },
      );
      expect(res).toMatchObject({ name: 'web-02', clientLabel: null });
    });
  });

  describe('revoke', () => {
    it('sets revokedAt, drops the token and revokes live keys', async () => {
      await svc.revoke('u1', ID);
      expect(repo.update).toHaveBeenCalledWith(
        expect.objectContaining({ id: ID, userId: 'u1' }),
        expect.objectContaining({
          revokedAt: expect.any(Date),
          enrollmentTokenHash: null,
        }),
      );
      expect(auth.revokeConnectorKeys).toHaveBeenCalledWith(ID);
    });

    it('is idempotent and still sweeps keys', async () => {
      row = enrolled({ revokedAt: new Date() });
      await svc.revoke('u1', ID);
      expect(repo.update).not.toHaveBeenCalled();
      expect(auth.revokeConnectorKeys).toHaveBeenCalledWith(ID);
    });

    it('404s for another user', async () => {
      row = null as any;
      await expect(svc.revoke('u2', ID)).rejects.toThrow(NotFoundException);
      expect(auth.revokeConnectorKeys).not.toHaveBeenCalled();
    });
  });

  describe('enroll', () => {
    const token = `kkce_${'a'.repeat(43)}`;
    const dto = (over: Record<string, unknown> = {}) =>
      ({
        token,
        publicKey: key.publicB64,
        version: '0.2.0',
        os: 'linux',
        arch: 'amd64',
        ...over,
      }) as any;

    it('consumes the token in one conditional update', async () => {
      qb.execute.mockResolvedValue({
        raw: [{ id: ID, name: 'web-01', userId: 'u1' }],
      });
      await expect(svc.enroll(dto())).resolves.toEqual({
        connectorId: ID,
        name: 'web-01',
      });
      expect(qb.where).toHaveBeenCalledWith('"enrollmentTokenHash" = :hash', {
        hash: `hash(${token})`,
      });
      const conditions = qb.andWhere.mock.calls.map((c) => c[0]);
      expect(conditions).toEqual([
        '"enrollmentTokenExpiresAt" > :now',
        '"enrolledAt" IS NULL',
        '"revokedAt" IS NULL',
      ]);
      expect(qb.set).toHaveBeenCalledWith(
        expect.objectContaining({
          enrollmentTokenHash: null,
          publicKey: key.publicB64,
          enrolledAt: expect.any(Date),
          version: '0.2.0',
        }),
      );
    });

    it('gives the same 401 for any token that matches nothing', async () => {
      const err = await svc.enroll(dto()).catch((e) => e);
      expect(err).toBeInstanceOf(UnauthorizedException);
      expect(err.message).toBe('Invalid enrollment token');
    });

    it('gives malformed tokens the same work as any other refusal', async () => {
      for (const bad of ['kk_abc', 'kkce_short', 'x'.repeat(60)]) {
        await expect(svc.enroll(dto({ token: bad }))).rejects.toThrow(
          'Invalid enrollment token',
        );
      }
      expect(auth.hmacSecret).toHaveBeenCalledTimes(3);
      expect(qb.execute).toHaveBeenCalledTimes(3);
    });

    it('refuses small-order public keys before touching the token', async () => {
      for (const publicKey of [
        'AQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=',
        Buffer.alloc(32).toString('base64'),
      ]) {
        await expect(svc.enroll(dto({ publicKey }))).rejects.toThrow(
          BadRequestException,
        );
      }
      expect(qb.execute).not.toHaveBeenCalled();
    });

    it('checks the public key before touching the token', async () => {
      await expect(svc.enroll(dto({ publicKey: 'AAAA' }))).rejects.toThrow(
        BadRequestException,
      );
      expect(qb.execute).not.toHaveBeenCalled();
    });
  });

  describe('exchangeToken', () => {
    it('issues a one-hour key with the connector limits and connectorId', async () => {
      await expect(svc.exchangeToken(signed(key))).resolves.toEqual({
        apiKey: 'kk_short',
        expiresAt: '2026-10-10T15:00:00.000Z',
      });
      expect(auth.createEphemeralApiKey).toHaveBeenCalledWith(
        'u1',
        'Connector: web-01',
        'connector',
        3600,
        {
          scopes: ['certs:read', 'certs:renew'],
          allowedDomainIds: null,
          allowedCertIds: [7],
        },
        { connectorId: ID },
      );
      expect(nonces.claim).toHaveBeenCalledWith(ID, NONCE);
      expect(repo.update).toHaveBeenCalledWith(ID, {
        lastSeenAt: expect.any(Date),
        staleAlertedAt: null,
      });
    });

    const refused = async (dto: any) => {
      const err = await svc.exchangeToken(dto).catch((e) => e);
      expect(err).toBeInstanceOf(UnauthorizedException);
      expect(err.message).toBe('Invalid connector credentials');
      expect(auth.createEphemeralApiKey).not.toHaveBeenCalled();
    };

    it('refuses unknown, revoked and unenrolled connectors', async () => {
      row = null as any;
      await refused(signed(key));
      row = enrolled({ revokedAt: new Date() });
      await refused(signed(key));
      row = enrolled({ enrolledAt: null, publicKey: null });
      await refused(signed(key));
      expect(nonces.claim).not.toHaveBeenCalled();
    });

    it('refuses timestamps more than 300 seconds off', async () => {
      const at = (s: number) =>
        new Date(Date.now() + s * 1000).toISOString().replace(/\.\d{3}Z$/, 'Z');
      await refused(signed(key, { timestamp: at(-302) }));
      await refused(signed(key, { timestamp: at(302) }));
      await expect(
        svc.exchangeToken(signed(key, { timestamp: at(-290) })),
      ).resolves.toBeDefined();
    });

    it('refuses signatures by another key or over other fields', async () => {
      await refused(signed(keyPair()));
      await refused(
        signed(key, { connectorId: '3f1c2b9e-2222-4222-8222-222222222222' }),
      );
      const s = signed(key);
      await refused({ ...s, nonce: 'BBBBBBBBBBBBBBBBBBBBBB' });
      expect(nonces.claim).not.toHaveBeenCalled();
    });

    it('refuses a reused nonce', async () => {
      nonces.claim.mockResolvedValue(false);
      await refused(signed(key));
    });

    it('fails closed when nonces cannot be stored', async () => {
      nonces.claim.mockRejectedValue(new ServiceUnavailableException());
      await expect(svc.exchangeToken(signed(key))).rejects.toThrow(
        ServiceUnavailableException,
      );
      expect(auth.createEphemeralApiKey).not.toHaveBeenCalled();
    });

    it('revokes a key minted while the connector was being revoked', async () => {
      repo.findOne
        .mockResolvedValueOnce(row)
        .mockResolvedValueOnce({ id: ID, revokedAt: new Date() });
      const err = await svc.exchangeToken(signed(key)).catch((e) => e);
      expect(err).toBeInstanceOf(UnauthorizedException);
      expect(auth.revokeConnectorKeys).toHaveBeenCalledWith(ID);
    });
  });

  describe('rotate', () => {
    const next = keyPair();
    const rotateDto = (
      signer: ReturnType<typeof keyPair>,
      newPublicKey = next.publicB64,
    ) => {
      const timestamp = now();
      const signature = sign(
        null,
        Buffer.from(rotateMessage(ID, newPublicKey, timestamp, NONCE)),
        signer.privateKey,
      ).toString('base64');
      return {
        connectorId: ID,
        newPublicKey,
        timestamp,
        nonce: NONCE,
        signature,
      };
    };

    it('replaces the key when signed by the current one and revokes live keys', async () => {
      await svc.rotate(rotateDto(key));
      expect(repo.update).toHaveBeenCalledWith(
        expect.objectContaining({ id: ID, publicKey: key.publicB64 }),
        expect.objectContaining({ publicKey: next.publicB64 }),
      );
      expect(auth.revokeConnectorKeys).toHaveBeenCalledWith(ID);
    });

    it('refuses rotating to the same key', async () => {
      await expect(svc.rotate(rotateDto(key, key.publicB64))).rejects.toThrow(
        'newPublicKey must differ from the current key',
      );
      expect(repo.update).not.toHaveBeenCalled();
      expect(auth.revokeConnectorKeys).not.toHaveBeenCalled();
    });

    it('refuses a small-order new key', async () => {
      await expect(
        svc.rotate(
          rotateDto(key, 'AQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA='),
        ),
      ).rejects.toThrow(BadRequestException);
      expect(nonces.claim).not.toHaveBeenCalled();
    });

    it('refuses a rotation signed by the new key', async () => {
      await expect(svc.rotate(rotateDto(next))).rejects.toThrow(
        'Invalid connector credentials',
      );
      expect(repo.update).not.toHaveBeenCalled();
    });

    it('refuses a token-exchange signature replayed as a rotation', async () => {
      const s = signed(key);
      await expect(
        svc.rotate({ ...s, newPublicKey: next.publicB64 }),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('refuses when the key changed underneath', async () => {
      repo.update.mockResolvedValue({ affected: 0 });
      await expect(svc.rotate(rotateDto(key))).rejects.toThrow(
        UnauthorizedException,
      );
      expect(auth.revokeConnectorKeys).not.toHaveBeenCalled();
    });

    it('400s for an invalid new key', async () => {
      await expect(svc.rotate(rotateDto(key, 'AAAA'))).rejects.toThrow(
        BadRequestException,
      );
    });
  });
});
