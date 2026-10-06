import { GithubRepoLookup } from './github-repo-lookup';

describe('GithubRepoLookup', () => {
  const lookup = new GithubRepoLookup();
  let fetchMock: jest.SpyInstance;

  const reply = (status: number, body?: unknown) =>
    fetchMock.mockResolvedValue(
      new Response(body === undefined ? null : JSON.stringify(body), {
        status,
      }),
    );

  beforeEach(() => {
    fetchMock = jest.spyOn(global, 'fetch');
  });
  afterEach(() => jest.restoreAllMocks());

  it('returns the id of a public repository with the same name', async () => {
    reply(200, { id: 123456789, full_name: 'Octo/Site' });
    await expect(lookup.lookup('octo/site')).resolves.toEqual({
      status: 'found',
      id: '123456789',
    });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.github.com/repos/octo/site');
    expect(init.redirect).toBe('manual');
  });

  it('treats private or missing repositories as not found', async () => {
    reply(404, { message: 'Not Found' });
    await expect(lookup.lookup('octo/private')).resolves.toEqual({
      status: 'not_found',
    });
  });

  it('does not follow a renamed repository to its new name', async () => {
    reply(301, { message: 'Moved Permanently' });
    await expect(lookup.lookup('octo/old-name')).resolves.toEqual({
      status: 'not_found',
    });
  });

  it('refuses an answer for a different repository', async () => {
    reply(200, { id: 1, full_name: 'other/site' });
    await expect(lookup.lookup('octo/site')).resolves.toEqual({
      status: 'not_found',
    });
  });

  it('reports rate limits, server errors and network failures as unavailable', async () => {
    reply(403, { message: 'API rate limit exceeded' });
    await expect(lookup.lookup('octo/site')).resolves.toEqual({
      status: 'unavailable',
    });
    reply(502);
    await expect(lookup.lookup('octo/site')).resolves.toEqual({
      status: 'unavailable',
    });
    fetchMock.mockRejectedValue(new Error('timeout'));
    await expect(lookup.lookup('octo/site')).resolves.toEqual({
      status: 'unavailable',
    });
  });
});
