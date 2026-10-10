import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { http, HttpResponse } from 'msw';
import type { Connector } from '@krakenkey/shared';
import { server } from '../../test/mocks/server';
import { API_URL } from '../../services/api';
import {
  activeConnector,
  revokedConnector,
  staleConnector,
  waitingConnector,
} from '../../test/mocks/connectors';
import Connectors from '../Connectors';

const copy = vi.fn();
vi.mock('../../utils/clipboard', () => ({
  copyToClipboard: (text: string) => copy(text),
}));

const BASE = `${API_URL}/connectors`;
const TOKEN = `kkce_${'A'.repeat(43)}`;

function renderPage() {
  return render(
    <MemoryRouter>
      <Connectors />
    </MemoryRouter>,
  );
}

describe('Connectors', () => {
  let list: Connector[];
  let posted: Record<string, unknown> | null;

  beforeEach(() => {
    copy.mockClear();
    list = [
      activeConnector,
      waitingConnector,
      staleConnector,
      revokedConnector,
    ];
    posted = null;
    server.use(
      http.get(BASE, () => HttpResponse.json(list)),
      http.post(BASE, async ({ request }) => {
        posted = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json(
          {
            connector: {
              ...waitingConnector,
              id: '3f1c2b9e-5555-4555-8555-555555555555',
              name: posted.name,
              clientLabel: posted.clientLabel ?? null,
              scopes: posted.scopes,
              allowedCertIds: posted.allowedCertIds ?? null,
              allowedDomainIds: posted.allowedDomainIds ?? null,
              deploymentSummary: undefined,
            },
            enrollmentToken: TOKEN,
          },
          { status: 201 },
        );
      }),
    );
  });

  it('lists connectors with status, version, last seen and deployments', async () => {
    renderPage();
    await screen.findByText('web-01');
    const table = within(screen.getByRole('table'));

    expect(screen.getByText('Your Connectors (3 of 50)')).toBeInTheDocument();
    expect(table.getByText('Active')).toBeInTheDocument();
    expect(table.getByText('Waiting to enroll')).toBeInTheDocument();
    expect(table.getByText('Stale')).toBeInTheDocument();
    expect(table.getByText('Revoked')).toBeInTheDocument();
    expect(table.getByText('Acme Corp')).toBeInTheDocument();
    expect(table.getByText('Globex')).toBeInTheDocument();
    expect(table.getAllByText('0.3.0').length).toBeGreaterThan(0);
    expect(table.getByText('5 minutes ago')).toBeInTheDocument();
    expect(table.getByText('Never')).toBeInTheDocument();
    expect(table.getByText('1 certificate')).toBeInTheDocument();
    expect(table.getByText('3 certificates')).toBeInTheDocument();
    expect(table.getByText('1 failing')).toBeInTheDocument();
    expect(table.getByRole('link', { name: 'web-01' })).toHaveAttribute(
      'href',
      `/dashboard/connectors/${activeConnector.id}`,
    );
    expect(
      screen.getByText(/Revoked connectors stay listed/),
    ).toBeInTheDocument();
  });

  it('shows an empty state', async () => {
    list = [];
    renderPage();
    expect(await screen.findByText('No connectors yet')).toBeInTheDocument();
  });

  async function openCreate() {
    const user = userEvent.setup();
    renderPage();
    await screen.findByText('web-01');
    await user.click(screen.getByRole('button', { name: 'New Connector' }));
    await screen.findByRole('form', { name: 'Create connector' });
    return user;
  }

  it('requires a name and at least one restriction', async () => {
    const user = await openCreate();
    const submit = screen.getByRole('button', { name: 'Create Connector' });

    await user.click(submit);
    expect(
      screen.getByText('Enter a name for the connector.'),
    ).toBeInTheDocument();

    await user.type(screen.getByLabelText('Name'), 'web-05');
    await user.click(submit);
    expect(
      screen.getByText(/Pick at least one certificate or domain/),
    ).toBeInTheDocument();
    expect(posted).toBeNull();

    // Picking one clears the error.
    await user.click(
      await screen.findByRole('checkbox', { name: /^example\.com/ }),
    );
    expect(
      screen.queryByText(/Pick at least one certificate or domain/),
    ).toBeNull();
  });

  it('creates a connector and shows its token once, with setup commands', async () => {
    const user = await openCreate();
    await user.type(screen.getByLabelText('Name'), 'web-05');
    await user.type(
      screen.getByLabelText('Client label (optional)'),
      'Initech',
    );
    // certs:read is fixed; turn certs:renew off.
    const read = screen.getByRole('checkbox', { name: /certs:read/ });
    expect(read).toBeChecked();
    expect(read).toBeDisabled();
    await user.click(screen.getByRole('checkbox', { name: /certs:renew/ }));
    await user.click(
      await screen.findByRole('checkbox', { name: /^#1 example\.com/ }),
    );
    await user.click(screen.getByRole('checkbox', { name: /^example\.com/ }));
    await user.click(screen.getByRole('button', { name: 'Create Connector' }));

    await waitFor(() =>
      expect(posted).toEqual({
        name: 'web-05',
        clientLabel: 'Initech',
        scopes: ['certs:read'],
        allowedCertIds: [1],
        allowedDomainIds: ['domain-1'],
      }),
    );

    const panel = await screen.findByRole('region', {
      name: 'Enrollment token',
    });
    expect(within(panel).getByTestId('enrollment-token')).toHaveTextContent(
      TOKEN,
    );
    expect(
      within(panel).getByText(/It will not be shown again/),
    ).toBeInTheDocument();
    expect(within(panel).getByText(/\(24 hours\)/)).toBeInTheDocument();
    expect(
      within(panel).getByLabelText('Enroll on the host'),
    ).toHaveTextContent(
      'krakenkey-connector enroll --config /etc/krakenkey-connector/config.yaml',
    );
    expect(
      within(panel).getByLabelText('Enroll and run with Docker'),
    ).toHaveTextContent('ghcr.io/krakenkey/connector');

    await user.click(within(panel).getByRole('button', { name: 'Copy token' }));
    expect(copy).toHaveBeenCalledWith(TOKEN);

    // The new connector is listed and the dialog is closed.
    expect(screen.queryByRole('form', { name: 'Create connector' })).toBeNull();
    expect(
      within(screen.getByRole('table')).getByText('web-05'),
    ).toBeInTheDocument();
    expect(screen.getByText('Your Connectors (4 of 50)')).toBeInTheDocument();

    await user.click(within(panel).getByRole('button', { name: 'Dismiss' }));
    expect(screen.queryByText(TOKEN)).toBeNull();
  });

  it('explains the connector limit when the API refuses with 402', async () => {
    server.use(
      http.post(BASE, () =>
        HttpResponse.json(
          {
            statusCode: 402,
            message: 'Connector limit reached',
            error: 'Payment Required',
          },
          { status: 402 },
        ),
      ),
    );
    const user = await openCreate();
    await user.type(screen.getByLabelText('Name'), 'web-05');
    await user.click(
      await screen.findByRole('checkbox', { name: /^example\.com/ }),
    );
    await user.click(screen.getByRole('button', { name: 'Create Connector' }));

    expect(
      await screen.findByText(/You have the maximum of 50 active connectors/),
    ).toBeInTheDocument();
    expect(screen.queryByTestId('enrollment-token')).toBeNull();
  });

  it('disables New Connector at the limit', async () => {
    list = Array.from({ length: 50 }, (_, i) => ({
      ...activeConnector,
      id: `3f1c2b9e-0000-4000-8000-${String(i).padStart(12, '0')}`,
      name: `c-${i}`,
    }));
    renderPage();
    await screen.findByText('c-0');
    expect(
      screen.getByRole('button', { name: 'New Connector' }),
    ).toBeDisabled();
    expect(screen.getByText(/Revoke one to add another/)).toBeInTheDocument();
  });
});
