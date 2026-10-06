import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { DEFAULT_ALERT_EVENTS } from '@krakenkey/shared';
import type {
  CreateNotificationChannelResponse,
  NotificationChannel,
} from '@krakenkey/shared';
import { server } from '../../test/mocks/server';
import { API_URL } from '../../services/api';
import AlertChannels from '../AlertChannels';

const { mockToast, mockCopy } = vi.hoisted(() => ({
  mockToast: {
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warning: vi.fn(),
  },
  mockCopy: vi.fn(),
}));

vi.mock('../../utils/toast', () => ({ toast: mockToast }));
vi.mock('../../utils/clipboard', () => ({ copyToClipboard: mockCopy }));

const BASE = `${API_URL}/notifications/channels`;

function channel(
  overrides: Partial<NotificationChannel> = {},
): NotificationChannel {
  return {
    id: 'ch-1',
    type: 'slack',
    name: 'Ops',
    urlMasked: 'https://hooks.slack.com/…a1B2',
    events: ['cert.failed', 'cert.expiring'],
    enabled: true,
    hasSecret: false,
    lastDeliveryAt: null,
    lastDeliveryStatus: null,
    lastError: null,
    createdAt: '2026-10-01T00:00:00.000Z',
    updatedAt: '2026-10-01T00:00:00.000Z',
    ...overrides,
  };
}

function listReturns(channels: NotificationChannel[]) {
  server.use(http.get(BASE, () => HttpResponse.json(channels)));
}

/** Captures the body of each POST to the channel list. */
function captureCreate(
  response: (
    body: Record<string, unknown>,
  ) => CreateNotificationChannelResponse,
) {
  const bodies: Record<string, unknown>[] = [];
  server.use(
    http.post(BASE, async ({ request }) => {
      const body = (await request.json()) as Record<string, unknown>;
      bodies.push(body);
      return HttpResponse.json(response(body), { status: 201 });
    }),
  );
  return bodies;
}

async function fillCreateForm(
  user: ReturnType<typeof userEvent.setup>,
  type: string,
  name: string,
  url: string,
) {
  await user.click(await screen.findByRole('button', { name: 'Add channel' }));
  await user.selectOptions(screen.getByLabelText('Type'), type);
  await user.type(screen.getByLabelText('Name'), name);
  await user.type(screen.getByLabelText('URL'), url);
}

describe('AlertChannels', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(window, 'confirm').mockReturnValue(true);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('lists channels with type, masked URL, events and last delivery', async () => {
    listReturns([
      channel({
        lastDeliveryAt: '2026-10-04T10:00:00.000Z',
        lastDeliveryStatus: 'failed',
        lastError: 'HTTP 404',
      }),
    ]);
    render(<AlertChannels />);

    const row = await screen.findByTestId('alert-channel-ch-1');
    expect(within(row).getByText('Ops')).toBeInTheDocument();
    expect(within(row).getByText('Slack')).toBeInTheDocument();
    expect(
      within(row).getByText('https://hooks.slack.com/…a1B2'),
    ).toBeInTheDocument();
    expect(within(row).getByText('cert expiring')).toBeInTheDocument();
    expect(within(row).getByText(/failed \(HTTP 404\)/)).toBeInTheDocument();
    expect(within(row).getByRole('switch')).toHaveAttribute(
      'aria-checked',
      'true',
    );
    expect(
      within(row).queryByRole('button', { name: /rotate secret/i }),
    ).not.toBeInTheDocument();
    expect(screen.getByText(/1 of 10 channels used/)).toBeInTheDocument();
  });

  it.each([
    ['slack', 'https://hooks.slack.com/services/T0/B0/xyz'],
    ['teams', 'https://prod.westus.logic.azure.com/workflows/abc'],
  ])('creates a %s channel with the default events', async (type, url) => {
    const user = userEvent.setup();
    const bodies = captureCreate((b) =>
      channel({ id: 'new', type: b.type as 'slack', name: b.name as string }),
    );
    render(<AlertChannels />);

    await fillCreateForm(user, type, 'Alerts', url);
    await user.click(
      within(screen.getByRole('form', { name: 'Add alert channel' })).getByRole(
        'button',
        { name: 'Add channel' },
      ),
    );

    await waitFor(() => expect(bodies).toHaveLength(1));
    expect(bodies[0]).toEqual({
      type,
      name: 'Alerts',
      url,
      events: DEFAULT_ALERT_EVENTS,
    });
    expect(await screen.findByTestId('alert-channel-new')).toBeInTheDocument();
    expect(screen.queryByTestId('webhook-secret')).not.toBeInTheDocument();
  });

  it('creates a webhook channel, shows the secret once and lets you dismiss it', async () => {
    const user = userEvent.setup();
    const bodies = captureCreate((b) => ({
      ...channel({
        id: 'wh',
        type: 'webhook',
        name: b.name as string,
        hasSecret: true,
      }),
      secret: 'whsec_abc123',
    }));
    render(<AlertChannels />);

    await fillCreateForm(
      user,
      'webhook',
      'SIEM',
      'https://hooks.example.com/kk',
    );
    // Add one optional event on top of the defaults.
    await user.click(screen.getByRole('checkbox', { name: /cert\.issued/ }));
    await user.click(
      within(screen.getByRole('form', { name: 'Add alert channel' })).getByRole(
        'button',
        { name: 'Add channel' },
      ),
    );

    await waitFor(() => expect(bodies).toHaveLength(1));
    expect(bodies[0].type).toBe('webhook');
    expect(bodies[0].events).toEqual(['cert.issued', ...DEFAULT_ALERT_EVENTS]);

    const reveal = await screen.findByTestId('webhook-secret');
    expect(within(reveal).getByText('whsec_abc123')).toBeInTheDocument();
    expect(
      within(reveal).getByText(/X-KrakenKey-Signature/),
    ).toBeInTheDocument();
    await user.click(within(reveal).getByRole('button', { name: 'Copy' }));
    expect(mockCopy).toHaveBeenCalledWith('whsec_abc123');

    await user.click(within(reveal).getByRole('button', { name: 'Dismiss' }));
    expect(screen.queryByText('whsec_abc123')).not.toBeInTheDocument();
    expect(screen.getByTestId('alert-channel-wh')).toBeInTheDocument();
  });

  it('shows API validation errors on the form', async () => {
    const user = userEvent.setup();
    server.use(
      http.post(BASE, () =>
        HttpResponse.json(
          {
            statusCode: 400,
            message: ['url must be a Slack incoming webhook URL'],
            error: 'Bad Request',
          },
          { status: 400 },
        ),
      ),
    );
    render(<AlertChannels />);

    await fillCreateForm(user, 'slack', 'Bad', 'https://example.com/x');
    await user.click(
      within(screen.getByRole('form', { name: 'Add alert channel' })).getByRole(
        'button',
        { name: 'Add channel' },
      ),
    );

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'url must be a Slack incoming webhook URL',
    );
    expect(
      screen.getByRole('form', { name: 'Add alert channel' }),
    ).toBeInTheDocument();
  });

  it('edits without sending the URL when it was left blank', async () => {
    const user = userEvent.setup();
    listReturns([channel()]);
    let patched: Record<string, unknown> | null = null;
    server.use(
      http.patch(`${BASE}/ch-1`, async ({ request }) => {
        patched = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json(channel({ name: 'Ops 2' }));
      }),
    );
    render(<AlertChannels />);

    await user.click(await screen.findByRole('button', { name: 'Edit Ops' }));
    const urlInput = screen.getByLabelText('URL');
    expect(urlInput).toHaveValue('');
    expect(
      screen.getByText(/Leave blank to keep the current URL/),
    ).toBeInTheDocument();
    expect(screen.getByLabelText('Type')).toBeDisabled();

    const name = screen.getByLabelText('Name');
    await user.clear(name);
    await user.type(name, 'Ops 2');
    await user.click(screen.getByRole('button', { name: 'Save changes' }));

    await waitFor(() => expect(patched).toEqual({ name: 'Ops 2' }));
    expect(await screen.findByText('Ops 2')).toBeInTheDocument();
  });

  it('sends the URL on edit when a new one is entered', async () => {
    const user = userEvent.setup();
    listReturns([channel()]);
    let patched: Record<string, unknown> | null = null;
    server.use(
      http.patch(`${BASE}/ch-1`, async ({ request }) => {
        patched = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json(channel());
      }),
    );
    render(<AlertChannels />);

    await user.click(await screen.findByRole('button', { name: 'Edit Ops' }));
    await user.type(
      screen.getByLabelText('URL'),
      'https://hooks.slack.com/services/new',
    );
    await user.click(screen.getByRole('button', { name: 'Save changes' }));

    await waitFor(() =>
      expect(patched).toEqual({
        url: 'https://hooks.slack.com/services/new',
      }),
    );
  });

  it('toggles a channel on and off', async () => {
    const user = userEvent.setup();
    listReturns([channel()]);
    let patched: Record<string, unknown> | null = null;
    server.use(
      http.patch(`${BASE}/ch-1`, async ({ request }) => {
        patched = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json(channel({ enabled: false }));
      }),
    );
    render(<AlertChannels />);

    const toggle = await screen.findByRole('switch', { name: 'Enable Ops' });
    await user.click(toggle);

    await waitFor(() => expect(patched).toEqual({ enabled: false }));
    await waitFor(() =>
      expect(toggle).toHaveAttribute('aria-checked', 'false'),
    );
  });

  it('shows the test-send result inline', async () => {
    const user = userEvent.setup();
    listReturns([channel()]);
    server.use(
      http.post(`${BASE}/ch-1/test`, () =>
        HttpResponse.json({ ok: false, status: 404, error: 'HTTP 404' }),
      ),
    );
    render(<AlertChannels />);

    await user.click(
      await screen.findByRole('button', { name: 'Send test to Ops' }),
    );

    expect(await screen.findByRole('status')).toHaveTextContent(
      'Test alert failed (HTTP 404): HTTP 404',
    );
  });

  it('shows a successful test send', async () => {
    const user = userEvent.setup();
    listReturns([channel()]);
    server.use(
      http.post(`${BASE}/ch-1/test`, () =>
        HttpResponse.json({ ok: true, status: 200, error: null }),
      ),
    );
    render(<AlertChannels />);

    await user.click(
      await screen.findByRole('button', { name: 'Send test to Ops' }),
    );

    expect(await screen.findByRole('status')).toHaveTextContent(
      'Test alert delivered (HTTP 200).',
    );
  });

  it('deletes a channel after confirmation', async () => {
    const user = userEvent.setup();
    listReturns([channel()]);
    let deleted = false;
    server.use(
      http.delete(`${BASE}/ch-1`, () => {
        deleted = true;
        return new HttpResponse(null, { status: 204 });
      }),
    );
    render(<AlertChannels />);

    await user.click(await screen.findByRole('button', { name: 'Delete Ops' }));

    expect(window.confirm).toHaveBeenCalled();
    await waitFor(() => expect(deleted).toBe(true));
    await waitFor(() =>
      expect(
        screen.queryByTestId('alert-channel-ch-1'),
      ).not.toBeInTheDocument(),
    );
  });

  it('does not delete when the confirmation is cancelled', async () => {
    const user = userEvent.setup();
    vi.mocked(window.confirm).mockReturnValue(false);
    listReturns([channel()]);
    let deleted = false;
    server.use(
      http.delete(`${BASE}/ch-1`, () => {
        deleted = true;
        return new HttpResponse(null, { status: 204 });
      }),
    );
    render(<AlertChannels />);

    await user.click(await screen.findByRole('button', { name: 'Delete Ops' }));

    expect(deleted).toBe(false);
    expect(screen.getByTestId('alert-channel-ch-1')).toBeInTheDocument();
  });

  it('rotates a webhook secret and shows the new one', async () => {
    const user = userEvent.setup();
    listReturns([
      channel({ id: 'wh', type: 'webhook', name: 'SIEM', hasSecret: true }),
    ]);
    server.use(
      http.post(`${BASE}/wh/rotate-secret`, () =>
        HttpResponse.json({ secret: 'whsec_rotated' }),
      ),
    );
    render(<AlertChannels />);

    await user.click(
      await screen.findByRole('button', { name: 'Rotate secret for SIEM' }),
    );

    const reveal = await screen.findByTestId('webhook-secret');
    expect(within(reveal).getByText('whsec_rotated')).toBeInTheDocument();
  });

  it('disables adding at the 10-channel limit', async () => {
    listReturns(
      Array.from({ length: 10 }, (_, i) =>
        channel({ id: `c${i}`, name: `Channel ${i}` }),
      ),
    );
    render(<AlertChannels />);

    expect(
      await screen.findByText(/reached the limit of 10 channels/),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add channel' })).toBeDisabled();
  });
});
