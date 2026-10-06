import { http, HttpResponse } from 'msw';
import { server } from '../../test/mocks/server';
import { API_URL } from '../api';
import {
  createGithubOidcTrust,
  deleteGithubOidcTrust,
  fetchGithubOidcTrusts,
} from '../githubOidcService';

const TRUSTS = `${API_URL}/auth/github-oidc/trusts`;

describe('githubOidcService', () => {
  let posted: Record<string, unknown> | null;
  let deleted: string | null;

  beforeEach(() => {
    posted = null;
    deleted = null;
    server.use(
      http.get(TRUSTS, () => HttpResponse.json([{ id: 't1' }])),
      http.post(TRUSTS, async ({ request }) => {
        posted = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json({ id: 't9', ...posted }, { status: 201 });
      }),
      http.delete(`${TRUSTS}/:id`, ({ params }) => {
        deleted = params.id as string;
        return new HttpResponse(null, { status: 204 });
      }),
    );
  });

  it('lists trust policies', async () => {
    expect(await fetchGithubOidcTrusts()).toEqual([{ id: 't1' }]);
  });

  it('leaves out empty optional fields', async () => {
    const trust = await createGithubOidcTrust({
      name: 'n',
      repository: 'octo/site',
      allowedRefs: [],
      environment: '  ',
      scopes: undefined,
      allowedDomainIds: [],
      allowedCertIds: [],
    });
    expect(posted).toEqual({ name: 'n', repository: 'octo/site' });
    expect(trust.id).toBe('t9');
  });

  it('sends refs, environment, scopes and limits', async () => {
    await createGithubOidcTrust({
      name: 'n',
      repository: 'octo/site',
      allowedRefs: ['refs/heads/main'],
      environment: ' production ',
      scopes: ['certs:read'],
      allowedDomainIds: ['d1'],
      allowedCertIds: [7],
    });
    expect(posted).toEqual({
      name: 'n',
      repository: 'octo/site',
      allowedRefs: ['refs/heads/main'],
      environment: 'production',
      scopes: ['certs:read'],
      allowedDomainIds: ['d1'],
      allowedCertIds: [7],
    });
  });

  it('deletes by id', async () => {
    await deleteGithubOidcTrust('t1');
    expect(deleted).toBe('t1');
  });
});
