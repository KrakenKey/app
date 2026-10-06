import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { render } from '../../test/test-utils';
import { http, HttpResponse } from 'msw';
import type { GithubOidcTrust } from '@krakenkey/shared';
import { server } from '../../test/mocks/server';
import { API_URL } from '../../services/api';
import GithubOidcTrusts from '../GithubOidcTrusts';
import { toast } from '../../utils/toast';

const TRUSTS = `${API_URL}/auth/github-oidc/trusts`;

const base: GithubOidcTrust = {
  id: 't1',
  name: 'website deploy',
  repository: 'octo/website',
  repositoryId: '123456',
  allowedRefs: ['refs/heads/main', 'refs/tags/v*'],
  environment: 'production',
  scopes: ['certs:read', 'domains:write'],
  allowedDomainIds: ['domain-1'],
  allowedCertIds: null,
  lastUsedAt: '2026-09-30T12:00:00.000Z',
  lastUsedRef: 'refs/heads/main',
  createdAt: '2026-09-01T00:00:00.000Z',
};

const unused: GithubOidcTrust = {
  ...base,
  id: 't2',
  name: 'docs renewal',
  repository: 'octo/docs',
  repositoryId: null,
  allowedRefs: null,
  environment: null,
  scopes: ['certs:read', 'domains:read', 'endpoints:read', 'account:read'],
  allowedDomainIds: null,
  lastUsedAt: null,
  lastUsedRef: null,
};

describe('GithubOidcTrusts', () => {
  let list: GithubOidcTrust[];
  let posted: Record<string, unknown> | null;

  beforeEach(() => {
    list = [base, unused];
    posted = null;
    server.use(
      http.get(TRUSTS, () => HttpResponse.json(list)),
      http.post(TRUSTS, async ({ request }) => {
        posted = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json(
          {
            ...unused,
            id: 'new-trust-id',
            name: posted.name,
            repository: posted.repository,
            repositoryId: posted.repositoryId ?? null,
            scopes: posted.scopes ?? null,
          },
          { status: 201 },
        );
      }),
    );
  });

  it('lists policies with repository pinning, refs, access and last use', async () => {
    render(<GithubOidcTrusts />);

    await screen.findByText('website deploy');
    const table = within(screen.getByRole('table'));
    expect(screen.getByText('Trust Policies (2 of 20)')).toBeInTheDocument();
    expect(table.getByText('pinned to repo id 123456')).toBeInTheDocument();
    expect(table.getByText('pins on its first run')).toBeInTheDocument();
    expect(
      table.getByText('refs/heads/main, refs/tags/v*'),
    ).toBeInTheDocument();
    expect(table.getByText('production')).toBeInTheDocument();
    expect(table.getByText('Any branch or tag')).toBeInTheDocument();
    expect(table.getByText('Custom (2 scopes)')).toBeInTheDocument();
    expect(table.getByText('Read-only')).toBeInTheDocument();
    await waitFor(() =>
      expect(table.getByText('1 domain').parentElement).toHaveAttribute(
        'title',
        'example.com',
      ),
    );
    // Last used ref below the date, and "Never" for the unused policy.
    expect(table.getAllByText('refs/heads/main')).toHaveLength(1);
    expect(table.getByText('Never')).toBeInTheDocument();
  });

  async function fillForm(repo = 'octo/api') {
    const user = userEvent.setup();
    render(<GithubOidcTrusts />);
    await screen.findByText('website deploy');
    await user.type(screen.getByLabelText('Policy name'), 'api deploy');
    await user.type(screen.getByLabelText('Repository'), repo);
    return user;
  }

  const submit = (user: ReturnType<typeof userEvent.setup>) =>
    user.click(screen.getByRole('button', { name: /add trust policy/i }));

  it('sends only name and repository for a full-access policy', async () => {
    const user = await fillForm();
    expect(screen.getByText(/Policies can't be edited/)).toBeInTheDocument();

    await submit(user);

    await waitFor(() =>
      expect(posted).toEqual({ name: 'api deploy', repository: 'octo/api' }),
    );
    const snippet = await screen.findByLabelText('Workflow snippet');
    expect(snippet).toHaveTextContent('id-token: write');
    expect(snippet).toHaveTextContent('uses: krakenkey/cert-action@v1');
    expect(snippet.textContent).not.toContain('trust-id');
    expect(
      await screen.findByText('Trust Policies (3 of 20)'),
    ).toBeInTheDocument();
  });

  it('sends refs, environment, preset scopes and domain limits', async () => {
    const user = await fillForm();
    await user.type(
      screen.getByLabelText(/Branches or tags/),
      'refs/heads/main{enter}refs/tags/v*{enter}refs/heads/main',
    );
    await user.type(screen.getByLabelText(/Environment/), ' production ');
    await user.click(
      screen.getByRole('radio', { name: /^Certificate renewal/ }),
    );
    await user.click(screen.getByRole('button', { name: /restrictions/i }));
    await user.click(
      await screen.findByRole('checkbox', { name: /^example\.com/ }),
    );
    // GitHub runner addresses vary, so there is no IP limit.
    expect(screen.queryByLabelText('Allowed IPs')).toBeNull();

    await submit(user);

    await waitFor(() =>
      expect(posted).toEqual({
        name: 'api deploy',
        repository: 'octo/api',
        allowedRefs: ['refs/heads/main', 'refs/tags/v*'],
        environment: 'production',
        scopes: ['certs:read', 'certs:renew', 'account:read'],
        allowedDomainIds: ['domain-1'],
      }),
    );
  });

  it('rejects refs that do not start with refs/ or have a * in the middle', async () => {
    const user = await fillForm();
    await user.type(
      screen.getByLabelText(/Branches or tags/),
      'refs/heads/main{enter}main{enter}refs/*/x',
    );

    await submit(user);

    expect(
      await screen.findByText(
        'Each entry must start with refs/ and may only end in *: main, refs/*/x',
      ),
    ).toBeInTheDocument();
    expect(screen.getByLabelText(/Branches or tags/)).toHaveAttribute(
      'aria-invalid',
      'true',
    );
    expect(posted).toBeNull();
  });

  it('sends a repository ID to pin the policy up front', async () => {
    const info = vi.spyOn(toast, 'info');
    const user = await fillForm();
    await user.type(screen.getByLabelText(/Repository ID/), ' 987654 ');

    await submit(user);

    await waitFor(() =>
      expect(posted).toEqual({
        name: 'api deploy',
        repository: 'octo/api',
        repositoryId: '987654',
      }),
    );
    expect(info).not.toHaveBeenCalled();
  });

  it('says when a new policy could not be pinned yet', async () => {
    const info = vi.spyOn(toast, 'info');
    const user = await fillForm();

    await submit(user);

    await waitFor(() =>
      expect(info).toHaveBeenCalledWith(
        expect.stringContaining('pins to it on its first workflow run'),
      ),
    );
  });

  it('rejects a repository ID that is not a number', async () => {
    const user = await fillForm();
    await user.type(screen.getByLabelText(/Repository ID/), 'octo/api');

    await submit(user);

    expect(
      await screen.findByText(/The repository ID is a number/),
    ).toBeInTheDocument();
    expect(posted).toBeNull();
  });

  it('rejects a repository that is not owner/name', async () => {
    const user = await fillForm('https://github.com/octo/api');

    await submit(user);

    expect(
      await screen.findByText(/Enter the repository as owner\/name/),
    ).toBeInTheDocument();
    expect(posted).toBeNull();
  });

  it('adds trust-id to the snippet when the repository already has a policy', async () => {
    const user = await fillForm('Octo/Website');

    await submit(user);

    const snippet = await screen.findByLabelText('Workflow snippet');
    expect(snippet).toHaveTextContent('trust-id: new-trust-id');
  });

  it('deletes a policy after confirming', async () => {
    let deleted: string | null = null;
    server.use(
      http.delete(`${TRUSTS}/:id`, ({ params }) => {
        deleted = params.id as string;
        return new HttpResponse(null, { status: 204 });
      }),
    );
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);

    render(<GithubOidcTrusts />);
    await screen.findByText('website deploy');
    await userEvent.click(
      screen.getByRole('button', {
        name: 'Delete trust policy website deploy',
      }),
    );

    await waitFor(() => expect(deleted).toBe('t1'));
    expect(confirmSpy).toHaveBeenCalled();
    await waitFor(() =>
      expect(screen.queryByText('website deploy')).toBeNull(),
    );
    expect(screen.getByText('Trust Policies (1 of 20)')).toBeInTheDocument();
  });

  it('does not delete when the confirm is cancelled', async () => {
    let deleted = false;
    server.use(
      http.delete(`${TRUSTS}/:id`, () => {
        deleted = true;
        return new HttpResponse(null, { status: 204 });
      }),
    );
    vi.spyOn(window, 'confirm').mockReturnValue(false);

    render(<GithubOidcTrusts />);
    await screen.findByText('website deploy');
    await userEvent.click(
      screen.getByRole('button', {
        name: 'Delete trust policy website deploy',
      }),
    );

    expect(deleted).toBe(false);
    expect(screen.getByText('website deploy')).toBeInTheDocument();
  });

  it('disables the form at the 20 policy limit', async () => {
    list = Array.from({ length: 20 }, (_, i) => ({
      ...unused,
      id: `t${i}`,
      name: `policy ${i}`,
    }));
    render(<GithubOidcTrusts />);
    await screen.findByText('policy 0');

    expect(
      screen.getByRole('button', { name: /add trust policy/i }),
    ).toBeDisabled();
    expect(
      screen.getByText(/maximum of 20 trust policies/),
    ).toBeInTheDocument();
  });
});
