import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { http, HttpResponse } from 'msw';
import { server } from '../../test/mocks/server';
import { API_URL } from '../../services/api';
import { mockPublicReport } from '../../test/mocks/reports';
import SharedReport from '../SharedReport';

const TOKEN = 'S'.repeat(43);

function renderPage() {
  return render(
    <MemoryRouter initialEntries={[`/r/${TOKEN}`]}>
      <Routes>
        <Route path="/r/:token" element={<SharedReport />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('SharedReport', () => {
  beforeEach(() => localStorage.clear());

  it('renders the report read-only without a login', async () => {
    let auth: string | null = 'unset';
    server.use(
      http.get(`${API_URL}/public/reports/:token`, ({ request, params }) => {
        auth = request.headers.get('authorization');
        expect(params.token).toBe(TOKEN);
        return HttpResponse.json(mockPublicReport);
      }),
    );
    renderPage();

    expect(await screen.findByText('Client sites')).toBeInTheDocument();
    expect(screen.getAllByText(/expired\.example\.com/).length).toBeGreaterThan(
      0,
    );
    expect(screen.getByText(/This link expires on/)).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /share/i }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /delete/i }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'KrakenKey' })).toHaveAttribute(
      'href',
      'https://krakenkey.io',
    );
    expect(screen.getByRole('link', { name: 'KrakenKey' })).toHaveAttribute(
      'rel',
      'noopener noreferrer',
    );
    expect(auth).toBeNull();
  });

  it('does not send a stale dashboard token', async () => {
    localStorage.setItem('access_token', 'stale');
    let auth: string | null = 'unset';
    server.use(
      http.get(`${API_URL}/public/reports/:token`, ({ request }) => {
        auth = request.headers.get('authorization');
        return HttpResponse.json(mockPublicReport);
      }),
    );
    renderPage();
    await screen.findByText('Client sites');
    expect(auth).toBeNull();
  });

  it('explains an expired or revoked link', async () => {
    server.use(
      http.get(`${API_URL}/public/reports/:token`, () =>
        HttpResponse.json({ statusCode: 404 }, { status: 404 }),
      ),
    );
    renderPage();
    expect(
      await screen.findByText('This link has expired or was revoked'),
    ).toBeInTheDocument();
  });
});
