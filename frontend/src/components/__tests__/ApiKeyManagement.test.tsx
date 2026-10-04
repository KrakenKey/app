import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { render } from '../../test/test-utils';
import { http, HttpResponse } from 'msw';
import { server } from '../../test/mocks/server';
import { API_URL } from '../../services/api';
import ApiKeyManagement from '../ApiKeyManagement';

const keys = [
  {
    id: 'k1',
    name: 'ci-deploy',
    createdAt: '2026-01-15T00:00:00.000Z',
    expiresAt: null,
    revokedAt: null,
    lastUsedAt: '2026-03-01T12:00:00.000Z',
    lastUsedIp: '203.0.113.7',
  },
  {
    id: 'k2',
    name: 'old-laptop',
    createdAt: '2026-01-01T00:00:00.000Z',
    expiresAt: null,
    revokedAt: '2026-02-20T00:00:00.000Z',
    lastUsedAt: null,
    lastUsedIp: null,
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
});
