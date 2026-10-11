import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { http, HttpResponse } from 'msw';
import type { Connector } from '@krakenkey/shared';
import { server } from '../../test/mocks/server';
import { API_URL } from '../../services/api';
import {
  CONFIG_HASH,
  activeConnector,
  expiredConnector,
  mockConfigSummary,
  mockDeployments,
  waitingConnector,
} from '../../test/mocks/connectors';
import { CONNECTOR_DOCS_URL } from '../../utils/connectors';
import ConnectorDetail from '../ConnectorDetail';

vi.mock('../../utils/clipboard', () => ({ copyToClipboard: vi.fn() }));

const BASE = `${API_URL}/connectors`;
const TOKEN = `kkce_${'B'.repeat(43)}`;
const EXPIRES = new Date(Date.now() + 24 * 3600_000).toISOString();

function renderPage(id: string) {
  return render(
    <MemoryRouter initialEntries={[`/dashboard/connectors/${id}`]}>
      <Routes>
        <Route path="/dashboard/connectors/:id" element={<ConnectorDetail />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('ConnectorDetail', () => {
  let current: Connector;
  let patched: Record<string, unknown> | null;
  let revoked: boolean;
  let tokens: number;

  beforeEach(() => {
    current = { ...activeConnector, deployments: mockDeployments };
    patched = null;
    revoked = false;
    tokens = 0;
    server.use(
      http.get(`${BASE}/:id`, ({ params }) =>
        params.id === current.id
          ? HttpResponse.json(current)
          : HttpResponse.json(
              { statusCode: 404, message: 'Connector not found' },
              { status: 404 },
            ),
      ),
      http.patch(`${BASE}/:id`, async ({ request }) => {
        patched = (await request.json()) as Record<string, unknown>;
        current = { ...current, ...patched };
        return HttpResponse.json(current);
      }),
      http.delete(`${BASE}/:id`, () => {
        revoked = true;
        current = { ...current, revokedAt: new Date().toISOString() };
        return new HttpResponse(null, { status: 204 });
      }),
      http.post(`${BASE}/:id/enrollment-token`, () => {
        tokens++;
        return HttpResponse.json(
          { enrollmentToken: TOKEN, expiresAt: EXPIRES },
          { status: 201 },
        );
      }),
    );
  });

  it('shows details, restrictions and deployments', async () => {
    renderPage(activeConnector.id);
    expect(
      await screen.findByRole('heading', { name: 'web-01' }),
    ).toBeInTheDocument();
    expect(screen.getByText('Acme Corp')).toBeInTheDocument();
    expect(screen.getByText('Active')).toBeInTheDocument();
    expect(screen.getByText('linux/amd64')).toBeInTheDocument();
    expect(screen.getByText('certs:read, certs:renew')).toBeInTheDocument();
    // Names come from the certificate and domain lists.
    // Once in the restrictions, once per deployment row.
    expect(await screen.findAllByText('#1 example.com')).toHaveLength(3);
    expect(await screen.findByText('example.com')).toBeInTheDocument();

    const table = within(screen.getByRole('table', { name: 'Deployments' }));
    expect(table.getByText('nginx-main')).toBeInTheDocument();
    expect(table.getByText('Verified')).toBeInTheDocument();
    expect(table.getByText('haproxy')).toBeInTheDocument();
    expect(table.getByText('Failed')).toBeInTheDocument();
    expect(table.getByText('reload_failed')).toBeInTheDocument();
    expect(table.getByText('04abcdef0123456789')).toBeInTheDocument();
    expect(table.getByText('2 hours ago')).toBeInTheDocument();
    expect(screen.getByText('1 failing target')).toBeInTheDocument();
    // Enrolled: no new token.
    expect(
      screen.queryByRole('button', { name: /New enrollment token/ }),
    ).toBeNull();
  });

  it('renames and clears the client label', async () => {
    const user = userEvent.setup();
    renderPage(activeConnector.id);
    await screen.findByRole('heading', { name: 'web-01' });
    await user.click(screen.getByRole('button', { name: 'Edit' }));
    const name = screen.getByLabelText('Name');
    await user.clear(name);
    await user.type(name, 'web-01b');
    await user.clear(screen.getByLabelText('Client label (optional)'));
    await user.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() =>
      expect(patched).toEqual({ name: 'web-01b', clientLabel: null }),
    );
    expect(
      await screen.findByRole('heading', { name: 'web-01b' }),
    ).toBeInTheDocument();
    expect(screen.queryByText('Acme Corp')).toBeNull();
  });

  it('revokes after confirming, explaining what happens', async () => {
    const user = userEvent.setup();
    renderPage(activeConnector.id);
    await screen.findByRole('heading', { name: 'web-01' });
    await user.click(screen.getByRole('button', { name: 'Revoke' }));

    const dialog = screen.getByRole('dialog');
    expect(
      within(dialog).getByText(/stops at its next check/),
    ).toBeInTheDocument();
    expect(
      within(dialog).getByText(/Every key it was issued/),
    ).toBeInTheDocument();

    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(revoked).toBe(false);

    await user.click(screen.getByRole('button', { name: 'Revoke' }));
    await user.click(
      within(screen.getByRole('dialog')).getByRole('button', {
        name: 'Revoke Connector',
      }),
    );
    await waitFor(() => expect(revoked).toBe(true));
    expect(await screen.findByText('Revoked')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Revoke' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Edit' })).toBeNull();
  });

  it('issues a new enrollment token while not enrolled', async () => {
    current = { ...waitingConnector, deployments: [] };
    const user = userEvent.setup();
    renderPage(waitingConnector.id);
    await screen.findByRole('heading', { name: 'db-02' });
    expect(screen.getByText('Waiting to enroll')).toBeInTheDocument();
    expect(screen.getByText(/has not enrolled yet/)).toBeInTheDocument();
    expect(screen.getByText('No deployments reported yet')).toBeInTheDocument();

    await user.click(
      screen.getByRole('button', { name: /New enrollment token/ }),
    );
    expect(await screen.findByTestId('enrollment-token')).toHaveTextContent(
      TOKEN,
    );
    expect(tokens).toBe(1);
    expect(screen.getByText(/It will not be shown again/)).toBeInTheDocument();
  });

  it('says so for an unknown connector', async () => {
    renderPage('3f1c2b9e-9999-4999-8999-999999999999');
    expect(
      await screen.findByText('This connector does not exist.'),
    ).toBeInTheDocument();
  });

  it('shows an expired token and offers a new one', async () => {
    current = { ...expiredConnector, deployments: [] };
    const user = userEvent.setup();
    renderPage(expiredConnector.id);
    await screen.findByRole('heading', { name: 'mail-05' });
    expect(screen.getByText('Enrollment token expired')).toBeInTheDocument();
    expect(
      screen.getByText(/its enrollment token\s+expired/),
    ).toBeInTheDocument();

    await user.click(
      screen.getByRole('button', { name: /New enrollment token/ }),
    );
    expect(await screen.findByTestId('enrollment-token')).toHaveTextContent(
      TOKEN,
    );
    // The new expiry from the API replaces the expired one.
    expect(screen.getByText('Waiting to enroll')).toBeInTheDocument();
    expect(
      screen.getByText(`expires on ${new Date(EXPIRES).toLocaleString()}`, {
        exact: false,
      }),
    ).toBeInTheDocument();
  });

  it('edits scopes and restrictions, saying the current keys are revoked', async () => {
    const user = userEvent.setup();
    renderPage(activeConnector.id);
    await screen.findByRole('heading', { name: 'web-01' });
    expect(
      screen.getByText(/covers new certificates for that domain/),
    ).toBeInTheDocument();
    expect(screen.queryByText(/can't be changed/)).toBeNull();

    await user.click(screen.getByRole('button', { name: 'Edit restrictions' }));
    const dialog = within(screen.getByRole('dialog'));
    expect(
      dialog.getByText(/revokes the connector's current short-lived keys/),
    ).toBeInTheDocument();
    // Starts from the current limits.
    const renew = dialog.getByRole('checkbox', { name: /certs:renew/ });
    expect(renew).toBeChecked();
    const cert = await dialog.findByRole('checkbox', {
      name: /^#1 example\.com/,
    });
    expect(cert).toBeChecked();
    const domain = dialog.getByRole('checkbox', { name: /^example\.com/ });
    expect(domain).toBeChecked();

    // Clearing every restriction is refused before sending.
    await user.click(cert);
    await user.click(domain);
    await user.click(dialog.getByRole('button', { name: 'Save' }));
    expect(
      dialog.getByText(/Pick at least one certificate or domain/),
    ).toBeInTheDocument();
    expect(patched).toBeNull();

    await user.click(domain);
    await user.click(renew);
    await user.click(dialog.getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(patched).toEqual({
        scopes: ['certs:read'],
        allowedCertIds: null,
        allowedDomainIds: ['domain-1'],
      }),
    );
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(await screen.findByText('certs:read')).toBeInTheDocument();
  });

  describe('configuration', () => {
    const shared = (over: Partial<Connector> = {}): Connector => ({
      ...activeConnector,
      deployments: mockDeployments,
      configSummary: mockConfigSummary,
      configHash: CONFIG_HASH,
      configReportedAt: new Date(Date.now() - 10 * 60_000).toISOString(),
      ...over,
    });
    const section = async () =>
      within(await screen.findByRole('region', { name: 'Configuration' }));

    it('explains how sharing works when nothing is shared', async () => {
      current = {
        ...activeConnector,
        deployments: [],
        configSummary: null,
        configHash: null,
        configReportedAt: null,
      };
      renderPage(activeConnector.id);
      const config = await section();
      expect(
        config.getByText(/has not shared its configuration/),
      ).toBeInTheDocument();
      expect(config.getByText(/from\s+version 0.3.0/)).toBeInTheDocument();
      expect(
        config.getByText('krakenkey.share_config: false'),
      ).toBeInTheDocument();
      expect(
        config.getByRole('link', { name: 'connector docs' }),
      ).toHaveAttribute('href', CONNECTOR_DOCS_URL);
      expect(config.queryByText('Read-only')).toBeNull();
      expect(config.queryByRole('table')).toBeNull();
    });

    it('treats a connector without the fields (older API) as not shared', async () => {
      renderPage(activeConnector.id);
      const config = await section();
      expect(
        config.getByText(/has not shared its configuration/),
      ).toBeInTheDocument();
    });

    it('shows the shared summary, read-only', async () => {
      current = shared();
      renderPage(activeConnector.id);
      const config = await section();

      expect(config.getByText('Read-only')).toBeInTheDocument();
      expect(config.getByText(/change it there/)).toBeInTheDocument();
      expect(
        config.getByText('10 minutes ago', { exact: false }),
      ).toBeInTheDocument();
      const hash = config.getByText(CONFIG_HASH.slice(0, 12));
      expect(hash).toHaveAttribute('title', CONFIG_HASH);
      expect(config.getByText('1 hour')).toBeInTheDocument();

      const plugins = within(config.getByRole('table', { name: 'Plugins' }));
      const rows = plugins.getAllByRole('row');
      expect(rows[0]).toHaveTextContent('azure-keyvault0.3.0Bundled');
      expect(rows[1]).toHaveTextContent('file—Built in');

      // Certificate card: link, names, key store with its settings
      expect(
        await config.findByRole('link', { name: '#1 example.com' }),
      ).toHaveAttribute('href', '/dashboard/certificates');
      expect(
        config.getByText('example.com, www.example.com'),
      ).toBeInTheDocument();
      expect(config.getByText('ecdsa-p256')).toBeInTheDocument();
      expect(config.getAllByText('vault: kv-prod')).toHaveLength(2);
      expect(config.getAllByText('certificate_name: www')).toHaveLength(2);

      const targets = within(
        config.getByRole('table', { name: 'Targets for certificate #1' }),
      );
      const [vault, nginx, haproxy] = targets.getAllByRole('row');
      expect(
        within(vault).getByText('Added automatically'),
      ).toBeInTheDocument();
      expect(within(vault).queryByText(/Runs a command/)).toBeNull();
      expect(within(vault).getByText('No check')).toBeInTheDocument();
      expect(within(vault).getByText('Not reported')).toBeInTheDocument();

      expect(
        within(nginx).getByText('Runs a command after deploy'),
      ).toBeInTheDocument();
      expect(within(nginx).queryByText('Added automatically')).toBeNull();
      expect(
        within(nginx).getByText('www.example.com:443'),
      ).toBeInTheDocument();
      expect(
        within(nginx).getByText('dir: /etc/nginx/certs'),
      ).toBeInTheDocument();
      expect(
        within(nginx).getByText('fullchain: site.pem'),
      ).toBeInTheDocument();
      expect(within(nginx).queryByText('Chain validation skipped')).toBeNull();
      // Joined with the deployment the connector reported
      expect(within(nginx).getByText('Verified')).toBeInTheDocument();

      expect(within(haproxy).getByText('port 8443')).toBeInTheDocument();
      expect(
        within(haproxy).getByText('Chain validation skipped'),
      ).toBeInTheDocument();
      expect(within(haproxy).getByText('Failed')).toBeInTheDocument();

      // Certificate 2 has no targets
      expect(config.getByText('No targets in the config.')).toBeInTheDocument();

      // Nothing to edit
      expect(config.queryAllByRole('button')).toHaveLength(0);
      expect(config.queryAllByRole('textbox')).toHaveLength(0);
      expect(config.queryByText(/shortened this summary/)).toBeNull();
    });

    it('flags certificates outside the restrictions and allowed ones missing from the config', async () => {
      current = shared({ allowedCertIds: [1, 3] });
      renderPage(activeConnector.id);
      const config = await section();
      const drift = within(
        config.getByRole('note', { name: 'Configuration drift' }),
      );
      const notAllowed = await drift.findByText(
        /In the config but outside this connector's restrictions/,
      );
      expect(notAllowed).toHaveTextContent('#2 pending.com');
      expect(notAllowed).not.toHaveTextContent('#1');
      const missing = drift.getByText(/Allowed but not in the config/);
      expect(missing).toHaveTextContent('#3');
      expect(missing).not.toHaveTextContent('#1');
    });

    it('shows no drift when the config matches the restrictions', async () => {
      current = shared({
        configSummary: {
          ...mockConfigSummary,
          certificates: [mockConfigSummary.certificates[0]],
        },
      });
      renderPage(activeConnector.id);
      const config = await section();
      expect(config.queryByRole('note')).toBeNull();
    });

    it('cannot compare a domain-only restriction', async () => {
      current = shared({ allowedCertIds: null });
      renderPage(activeConnector.id);
      const config = await section();
      expect(config.queryByRole('note')).toBeNull();
    });

    it('says when the summary was cut to the limits', async () => {
      current = shared({
        allowedCertIds: [1, 2, 3],
        configSummary: { ...mockConfigSummary, truncated: true },
      });
      renderPage(activeConnector.id);
      const config = await section();
      expect(
        config.getByText(
          'The connector shortened this summary to fit; see its log.',
        ),
      ).toBeInTheDocument();
      expect(
        config.getByText(/or they were cut from the summary/),
      ).toBeInTheDocument();
    });
  });
});
