import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { render } from '../../test/test-utils';
import { http, HttpResponse } from 'msw';
import { server } from '../../test/mocks/server';
import { API_URL } from '../../services/api';
import ApiKeyManagement from '../ApiKeyManagement';

const unrestricted = {
  scopes: null,
  allowedDomainIds: null,
  allowedCertIds: null,
  allowedIps: null,
};

const keys = [
  {
    id: 'k1',
    name: 'ci-deploy',
    createdAt: '2026-01-15T00:00:00.000Z',
    expiresAt: null,
    revokedAt: null,
    lastUsedAt: '2026-03-01T12:00:00.000Z',
    lastUsedIp: '203.0.113.7',
    ...unrestricted,
  },
  {
    id: 'k2',
    name: 'old-laptop',
    createdAt: '2026-01-01T00:00:00.000Z',
    expiresAt: null,
    revokedAt: '2026-02-20T00:00:00.000Z',
    lastUsedAt: null,
    lastUsedIp: null,
    ...unrestricted,
  },
];

describe('ApiKeyManagement', () => {
  let listQuery: URLSearchParams | null;

  beforeEach(() => {
    listQuery = null;
    server.use(
      http.get(`${API_URL}/auth/api-keys`, ({ request }) => {
        listQuery = new URL(request.url).searchParams;
        return HttpResponse.json(keys);
      }),
    );
  });

  it('asks for revoked keys and shows last use', async () => {
    render(<ApiKeyManagement />);

    expect(await screen.findByText('ci-deploy')).toBeInTheDocument();
    expect(listQuery?.get('includeRevoked')).toBe('true');
    expect(screen.getByText('203.0.113.7')).toBeInTheDocument();
    expect(screen.getByText('Your API Keys (1)')).toBeInTheDocument();
    expect(
      screen.getByText('Revoked keys stay listed for 30 days.'),
    ).toBeInTheDocument();
  });

  it('shows revoked keys without a revoke button', async () => {
    render(<ApiKeyManagement />);

    await screen.findByText('old-laptop');
    expect(screen.getByText(/^Revoked \d/)).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /revoke/i })).toHaveLength(1);
  });

  it('marks a key revoked in place after confirming', async () => {
    let deleted: string | null = null;
    server.use(
      http.delete(`${API_URL}/auth/api-keys/:id`, ({ params }) => {
        deleted = params.id as string;
        return HttpResponse.json({ message: 'API key revoked' });
      }),
    );
    vi.spyOn(window, 'confirm').mockReturnValue(true);

    render(<ApiKeyManagement />);
    await screen.findByText('ci-deploy');
    await userEvent.click(screen.getByRole('button', { name: /revoke/i }));

    await waitFor(() => expect(deleted).toBe('k1'));
    expect(await screen.findByText('Your API Keys (0)')).toBeInTheDocument();
    expect(screen.getAllByText(/^Revoked \d/)).toHaveLength(2);
    expect(screen.queryByRole('button', { name: /revoke/i })).toBeNull();
  });

  describe('access column', () => {
    it('names full access, presets and custom sets, with restriction badges', async () => {
      server.use(
        http.get(`${API_URL}/auth/api-keys`, () =>
          HttpResponse.json([
            { ...keys[0], id: 'a', name: 'full-key' },
            {
              ...keys[0],
              id: 'b',
              name: 'reader',
              // Same set as the read-only preset, different order.
              scopes: [
                'account:read',
                'endpoints:read',
                'domains:read',
                'certs:read',
              ],
              allowedDomainIds: ['domain-1', 'domain-gone'],
            },
            {
              ...keys[0],
              id: 'c',
              name: 'custom-key',
              scopes: ['certs:read', 'domains:write'],
              allowedCertIds: [1, 2],
              allowedIps: ['203.0.113.0/24', '2001:db8::1'],
            },
            {
              ...keys[1],
              id: 'd',
              name: 'old-probe',
              scopes: ['probes:report'],
            },
          ]),
        ),
      );

      render(<ApiKeyManagement />);
      await screen.findByText('full-key');
      const table = within(screen.getByRole('table'));

      expect(table.getByText('Full access')).toHaveAttribute(
        'title',
        'All scopes',
      );
      expect(table.getByText('Read-only')).toBeInTheDocument();
      expect(table.getByText('Probe')).toBeInTheDocument();
      expect(table.getByText('Custom (2 scopes)')).toHaveAttribute(
        'title',
        'certs:read, domains:write',
      );

      // Hostnames replace ids once the domain list has loaded.
      await waitFor(() =>
        expect(table.getByText('2 domains').parentElement).toHaveAttribute(
          'title',
          'example.com, domain-gone',
        ),
      );
      expect(table.getByText('2 certs').parentElement).toHaveAttribute(
        'title',
        '#1, #2',
      );
      expect(table.getByText('IP-limited').parentElement).toHaveAttribute(
        'title',
        '203.0.113.0/24, 2001:db8::1',
      );
    });
  });

  describe('create form', () => {
    let posted: Record<string, unknown> | null;

    beforeEach(() => {
      posted = null;
      server.use(
        http.post(`${API_URL}/auth/api-keys`, async ({ request }) => {
          posted = (await request.json()) as Record<string, unknown>;
          return HttpResponse.json({
            apiKey: 'kk_new_key',
            id: 'k9',
            name: posted.name,
            ...unrestricted,
          });
        }),
      );
    });

    async function renderForm() {
      const user = userEvent.setup();
      render(<ApiKeyManagement />);
      await screen.findByText('ci-deploy');
      await user.type(screen.getByLabelText('Name'), 'deploy');
      return user;
    }

    const submit = (user: ReturnType<typeof userEvent.setup>) =>
      user.click(screen.getByRole('button', { name: /create key/i }));

    it('defaults to full access and sends no scopes or limits', async () => {
      const user = await renderForm();
      expect(screen.getByRole('radio', { name: /^Full access/ })).toBeChecked();
      expect(
        screen.getByText(/can't be changed after the key is created/),
      ).toBeInTheDocument();

      await submit(user);

      await waitFor(() => expect(posted).toEqual({ name: 'deploy' }));
      expect(await screen.findByText('kk_new_key')).toBeInTheDocument();
    });

    it('sends the scopes of the chosen preset', async () => {
      const user = await renderForm();
      await user.click(screen.getByRole('radio', { name: /^Read-only/ }));
      expect(
        screen.getByRole('checkbox', { name: /^domains:read/ }),
      ).toBeChecked();

      await submit(user);

      await waitFor(() =>
        expect(posted).toEqual({
          name: 'deploy',
          scopes: [
            'certs:read',
            'domains:read',
            'endpoints:read',
            'account:read',
          ],
        }),
      );
    });

    it('switches to custom when a preset scope is changed', async () => {
      const user = await renderForm();
      await user.click(
        screen.getByRole('radio', { name: /^Certificate renewal/ }),
      );
      await user.click(screen.getByRole('checkbox', { name: /^certs:revoke/ }));

      expect(screen.getByRole('radio', { name: /^Custom/ })).toBeChecked();
      await submit(user);

      await waitFor(() =>
        expect(posted?.scopes).toEqual([
          'certs:read',
          'certs:renew',
          'certs:revoke',
          'account:read',
        ]),
      );
    });

    it('blocks a custom key with no scopes', async () => {
      const user = await renderForm();
      await user.click(screen.getByRole('radio', { name: /^Custom/ }));
      expect(
        screen
          .getAllByRole('checkbox')
          .filter((c) => (c as HTMLInputElement).checked),
      ).toHaveLength(0);

      await submit(user);

      expect(await screen.findByRole('alert')).toHaveTextContent(
        'Pick at least one scope, or choose Full access.',
      );
      expect(posted).toBeNull();
    });

    it('sends domain, certificate and IP limits', async () => {
      const user = await renderForm();
      await user.click(screen.getByRole('button', { name: /restrictions/i }));

      await user.click(
        await screen.findByRole('checkbox', { name: /^example\.com/ }),
      );
      await user.click(
        await screen.findByRole('checkbox', { name: /^#1 example\.com/ }),
      );
      expect(
        screen.getByText(/can't request new\s+certificates/),
      ).toBeInTheDocument();
      await user.type(
        screen.getByLabelText('Allowed IPs'),
        '203.0.113.10, 198.51.100.0/24{enter}2001:db8::/32',
      );

      await submit(user);

      await waitFor(() =>
        expect(posted).toEqual({
          name: 'deploy',
          allowedDomainIds: ['domain-1'],
          allowedCertIds: [1],
          allowedIps: ['203.0.113.10', '198.51.100.0/24', '2001:db8::/32'],
        }),
      );
    });

    it('shows an error for an invalid IP and does not submit', async () => {
      const user = await renderForm();
      await user.click(screen.getByRole('button', { name: /restrictions/i }));
      await user.type(
        screen.getByLabelText('Allowed IPs'),
        '10.0.0.1{enter}10.0.0.300',
      );

      await submit(user);

      expect(
        await screen.findByText(
          'Not a valid IP address or CIDR range: 10.0.0.300',
        ),
      ).toBeInTheDocument();
      expect(screen.getByLabelText('Allowed IPs')).toHaveAttribute(
        'aria-invalid',
        'true',
      );
      expect(posted).toBeNull();
    });
  });
});
