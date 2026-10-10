import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { http, HttpResponse } from 'msw';
import type { Connector } from '@krakenkey/shared';
import { server } from '../../test/mocks/server';
import { API_URL } from '../../services/api';
import {
  activeConnector,
  mockDeployments,
  waitingConnector,
} from '../../test/mocks/connectors';
import ConnectorDetail from '../ConnectorDetail';

vi.mock('../../utils/clipboard', () => ({ copyToClipboard: vi.fn() }));

const BASE = `${API_URL}/connectors`;
const TOKEN = `kkce_${'B'.repeat(43)}`;

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
        return HttpResponse.json({ enrollmentToken: TOKEN }, { status: 201 });
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
});
