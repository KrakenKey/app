import { http, HttpResponse } from 'msw';
import { server } from '../../test/mocks/server';
import { API_URL } from '../api';
import { createApiKey } from '../apiKeyService';

describe('apiKeyService.createApiKey', () => {
  let posted: Record<string, unknown> | null;

  beforeEach(() => {
    posted = null;
    server.use(
      http.post(`${API_URL}/auth/api-keys`, async ({ request }) => {
        posted = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json({ apiKey: 'kk_x', id: 'k1', name: 'n' });
      }),
    );
  });

  it('sends only the name for a full-access key', async () => {
    await createApiKey('n');
    expect(posted).toEqual({ name: 'n' });
  });

  it('leaves out empty restriction lists', async () => {
    await createApiKey('n', undefined, {
      scopes: undefined,
      allowedDomainIds: [],
      allowedCertIds: [],
      allowedIps: [],
    });
    expect(posted).toEqual({ name: 'n' });
  });

  it('sends scopes, limits and the end of the expiry day', async () => {
    await createApiKey('n', '2027-01-31', {
      scopes: ['certs:read', 'certs:renew'],
      allowedDomainIds: ['d1'],
      allowedCertIds: [7],
      allowedIps: ['203.0.113.0/24'],
    });
    expect(posted).toEqual({
      name: 'n',
      expiresAt: '2027-01-31T23:59:59.000Z',
      scopes: ['certs:read', 'certs:renew'],
      allowedDomainIds: ['d1'],
      allowedCertIds: [7],
      allowedIps: ['203.0.113.0/24'],
    });
  });
});
