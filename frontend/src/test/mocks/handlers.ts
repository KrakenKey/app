import { http, HttpResponse } from 'msw';
import { mockUser, mockTokens, mockDomains, mockCerts, mockApiKey } from './data';
import { API_URL } from '../../services/api';

export const handlers = [
  // Auth
  http.get(`${API_URL}/auth/profile`, () => {
    return HttpResponse.json(mockUser);
  }),

  http.get(`${API_URL}/auth/callback`, () => {
    return HttpResponse.json(mockTokens);
  }),

  http.get(`${API_URL}/auth/api-keys`, () => {
    return HttpResponse.json([]);
  }),

  http.post(`${API_URL}/auth/api-keys`, () => {
    return HttpResponse.json({ apiKey: mockApiKey, id: 'key-1', name: 'test-key' });
  }),

  // Domains
  http.get(`${API_URL}/domains`, () => {
    return HttpResponse.json(mockDomains);
  }),

  http.post(`${API_URL}/domains`, async ({ request }) => {
    const body = (await request.json()) as { hostname: string };
    return HttpResponse.json({
      id: 'domain-new',
      hostname: body.hostname,
      verificationCode: 'krakenkey-verify=new123',
      isVerified: false,
      userId: 'user-1',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
  }),

  http.post(`${API_URL}/domains/:id/verify`, ({ params }) => {
    const domain = mockDomains.find((d) => d.id === params.id);
    if (!domain) return new HttpResponse(null, { status: 404 });
    return HttpResponse.json({ ...domain, isVerified: true });
  }),

  http.delete(`${API_URL}/domains/:id`, () => {
    return new HttpResponse(null, { status: 204 });
  }),

  // TLS Certificates
  http.get(`${API_URL}/certs/tls`, () => {
    return HttpResponse.json(mockCerts);
  }),

  http.post(`${API_URL}/certs/tls`, () => {
    return HttpResponse.json({ id: 3, status: 'pending' });
  }),

  http.get(`${API_URL}/certs/tls/:id`, ({ params }) => {
    const cert = mockCerts.find((c) => c.id === Number(params.id));
    if (!cert) return new HttpResponse(null, { status: 404 });
    return HttpResponse.json(cert);
  }),

  http.post(`${API_URL}/certs/tls/:id/renew`, ({ params }) => {
    return HttpResponse.json({ id: Number(params.id), status: 'renewing' });
  }),

  http.post(`${API_URL}/certs/tls/:id/revoke`, ({ params }) => {
    return HttpResponse.json({ id: Number(params.id), status: 'revoked' });
  }),

  http.delete(`${API_URL}/certs/tls/:id`, ({ params }) => {
    return HttpResponse.json({ id: Number(params.id) });
  }),
];
