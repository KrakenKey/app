import { http, HttpResponse } from 'msw';
import { server } from '../../test/mocks/server';
import { API_URL } from '../api';
import {
  createConnector,
  fetchCertificateDeployments,
  newEnrollmentToken,
  revokeConnector,
  updateConnector,
} from '../connectorService';

const BASE = `${API_URL}/connectors`;
const ID = '3f1c2b9e-1111-4111-8111-111111111111';

describe('connectorService', () => {
  let posted: Record<string, unknown> | null;
  let patched: Record<string, unknown> | null;
  let deleted: string | null;
  let deploymentsQuery: string | null;

  beforeEach(() => {
    posted = null;
    patched = null;
    deleted = null;
    deploymentsQuery = null;
    server.use(
      http.post(BASE, async ({ request }) => {
        posted = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json(
          {
            connector: { id: ID, ...posted },
            enrollmentToken: 'kkce_x',
            expiresAt: '2026-10-11T12:00:00.000Z',
          },
          { status: 201 },
        );
      }),
      http.get(`${BASE}/deployments`, ({ request }) => {
        deploymentsQuery = new URL(request.url).search;
        return HttpResponse.json([]);
      }),
      http.patch(`${BASE}/:id`, async ({ request }) => {
        patched = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json({ id: ID, ...patched });
      }),
      http.delete(`${BASE}/:id`, ({ params }) => {
        deleted = params.id as string;
        return new HttpResponse(null, { status: 204 });
      }),
      http.post(`${BASE}/:id/enrollment-token`, () =>
        HttpResponse.json(
          {
            enrollmentToken: 'kkce_new',
            expiresAt: '2026-10-11T12:00:00.000Z',
          },
          { status: 201 },
        ),
      ),
    );
  });

  it('leaves out a blank client label and empty restriction lists', async () => {
    const res = await createConnector({
      name: 'web-01',
      clientLabel: '  ',
      scopes: ['certs:read'],
      allowedCertIds: [],
      allowedDomainIds: ['d1'],
    });
    expect(posted).toEqual({
      name: 'web-01',
      scopes: ['certs:read'],
      allowedDomainIds: ['d1'],
    });
    expect(res.enrollmentToken).toBe('kkce_x');
  });

  it('sends a trimmed client label and certificate ids', async () => {
    await createConnector({
      name: 'web-01',
      clientLabel: ' Acme ',
      scopes: ['certs:read', 'certs:renew'],
      allowedCertIds: [7],
    });
    expect(posted).toEqual({
      name: 'web-01',
      clientLabel: 'Acme',
      scopes: ['certs:read', 'certs:renew'],
      allowedCertIds: [7],
    });
  });

  it('patches, revokes and issues a new token', async () => {
    await updateConnector(ID, { name: 'web-02', clientLabel: null });
    expect(patched).toEqual({ name: 'web-02', clientLabel: null });
    await revokeConnector(ID);
    expect(deleted).toBe(ID);
    expect(await newEnrollmentToken(ID)).toEqual({
      enrollmentToken: 'kkce_new',
      expiresAt: '2026-10-11T12:00:00.000Z',
    });
  });

  it('asks for the deployments of one certificate', async () => {
    await fetchCertificateDeployments(42);
    expect(deploymentsQuery).toBe('?certificateId=42');
  });
});
