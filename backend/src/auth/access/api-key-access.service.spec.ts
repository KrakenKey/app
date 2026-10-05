import { ForbiddenException, NotFoundException } from '@nestjs/common';
import type { ParsedCsr } from '@krakenkey/shared';
import { ApiKeyAccessService } from './api-key-access.service';
import type { ApiKeyContext } from '../api-key-restrictions';

function csr(...names: string[]): ParsedCsr {
  return {
    subject: [{ name: 'commonName', shortName: 'CN', value: names[0] }],
    attributes: [],
    publicKey: { keyType: 'ECDSA', bitLength: 256 },
    extensions: [
      {
        name: 'subjectAltName',
        altNames: names.map((value) => ({ type: 2, value })),
      },
    ],
  };
}

function key(over: Partial<ApiKeyContext> = {}): { apiKey: ApiKeyContext } {
  return {
    apiKey: {
      id: 'key-1',
      scopes: null,
      allowedDomainIds: null,
      allowedCertIds: null,
      ...over,
    },
  };
}

describe('ApiKeyAccessService', () => {
  const domains = [
    { id: 'dom-lab', hostname: 'labxp.io' },
    { id: 'dom-ex', hostname: 'example.com' },
  ];
  let repo: { find: jest.Mock };
  let service: ApiKeyAccessService;

  beforeEach(() => {
    repo = {
      find: jest.fn(({ where }) =>
        Promise.resolve(
          domains.filter((d) => (where.id._value as string[]).includes(d.id)),
        ),
      ),
    };
    service = new ApiKeyAccessService(repo as any);
  });

  const labCert = { id: 1, parsedCsr: csr('labxp.io', '*.labxp.io') };
  const exCert = { id: 2, parsedCsr: csr('www.example.com') };
  const mixedCert = { id: 3, parsedCsr: csr('labxp.io', 'example.com') };

  describe('sessions and unrestricted keys', () => {
    it.each([
      ['a dashboard session', {}],
      ['an unrestricted key', key()],
      ['a scoped key', key({ scopes: ['certs:read'] })],
    ])('pass everything through for %s', async (_label, user) => {
      expect(service.isRestricted(user)).toBe(false);
      await expect(
        service.filterCerts(user, [labCert, exCert]),
      ).resolves.toHaveLength(2);
      await expect(service.assertCert(user, exCert)).resolves.toBeUndefined();
      await expect(service.issuanceHostnames(user)).resolves.toBeUndefined();
      expect(service.filterDomains(user, domains)).toHaveLength(2);
      expect(() => service.assertCanAddDomain(user)).not.toThrow();
      await expect(
        service.assertCanMonitorHost(user, 'anything.net'),
      ).resolves.toBeUndefined();
      expect(repo.find).not.toHaveBeenCalled();
    });
  });

  describe('key limited to one domain', () => {
    const user = key({ allowedDomainIds: ['dom-lab'] });

    it('only sees certificates whose names are all under that domain', async () => {
      await expect(
        service.filterCerts(user, [labCert, exCert, mixedCert]),
      ).resolves.toEqual([labCert]);
    });

    it('gets 404 for a certificate on another domain', async () => {
      await expect(service.assertCert(user, exCert)).rejects.toThrow(
        NotFoundException,
      );
      await expect(service.assertCert(user, mixedCert)).rejects.toThrow(
        NotFoundException,
      );
      await expect(service.assertCert(user, labCert)).resolves.toBeUndefined();
    });

    it('refuses a certificate with no readable names', async () => {
      await expect(
        service.assertCert(user, { id: 9, parsedCsr: null }),
      ).rejects.toThrow(NotFoundException);
    });

    it('limits new certificates to that domain', async () => {
      await expect(service.issuanceHostnames(user)).resolves.toEqual([
        'labxp.io',
      ]);
    });

    it('sees only that domain and cannot add domains', () => {
      expect(service.filterDomains(user, domains)).toEqual([domains[0]]);
      expect(() => service.assertDomain(user, 'dom-ex')).toThrow(
        NotFoundException,
      );
      expect(() => service.assertDomain(user, 'dom-lab')).not.toThrow();
      expect(() => service.assertCanAddDomain(user)).toThrow(
        ForbiddenException,
      );
    });

    it('only sees and creates endpoints under that domain', async () => {
      const eps = [
        { id: 'e1', host: 'pfe.labxp.io' },
        { id: 'e2', host: 'example.com' },
      ];
      await expect(service.filterEndpoints(user, eps)).resolves.toEqual([
        eps[0],
      ]);
      await expect(service.assertEndpoint(user, eps[1])).rejects.toThrow(
        NotFoundException,
      );
      await expect(
        service.assertCanMonitorHost(user, 'example.com'),
      ).rejects.toThrow(ForbiddenException);
      await expect(
        service.assertCanMonitorHost(user, 'gw.labxp.io'),
      ).resolves.toBeUndefined();
    });

    it('looks the domains up once per request', async () => {
      await service.filterCerts(user, [labCert, exCert]);
      await service.assertCert(user, labCert);
      expect(repo.find).toHaveBeenCalledTimes(1);
    });

    it('drops a deleted domain instead of widening access', async () => {
      const gone = key({ allowedDomainIds: ['dom-deleted'] });
      await expect(service.filterCerts(gone, [labCert])).resolves.toEqual([]);
      await expect(service.issuanceHostnames(gone)).resolves.toEqual([]);
    });
  });

  describe('key limited to specific certificates', () => {
    const user = key({ allowedCertIds: [2] });

    it('only sees those certificates', async () => {
      await expect(
        service.filterCerts(user, [labCert, exCert]),
      ).resolves.toEqual([exCert]);
      await expect(service.assertCert(user, labCert)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('cannot request new certificates', async () => {
      await expect(service.issuanceHostnames(user)).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('does not limit domains or endpoints', async () => {
      expect(service.filterDomains(user, domains)).toHaveLength(2);
      await expect(
        service.assertCanMonitorHost(user, 'anything.net'),
      ).resolves.toBeUndefined();
    });
  });

  it('applies both limits when a key has both', async () => {
    const user = key({ allowedDomainIds: ['dom-lab'], allowedCertIds: [1, 2] });
    await expect(
      service.filterCerts(user, [labCert, exCert, mixedCert]),
    ).resolves.toEqual([labCert]);
  });
});
