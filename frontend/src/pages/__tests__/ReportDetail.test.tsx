import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { http, HttpResponse } from 'msw';
import { server } from '../../test/mocks/server';
import { API_URL } from '../../services/api';
import { mockReport } from '../../test/mocks/reports';
import ReportDetail from '../ReportDetail';

const copy = vi.fn();
vi.mock('../../utils/clipboard', () => ({
  copyToClipboard: (text: string) => copy(text),
}));

const TOKEN = 'T'.repeat(43);

function renderPage() {
  return render(
    <MemoryRouter initialEntries={[`/dashboard/reports/${mockReport.id}`]}>
      <Routes>
        <Route path="/dashboard/reports/:id" element={<ReportDetail />} />
        <Route path="/dashboard/reports" element={<div>Report list</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('ReportDetail', () => {
  let shared = false;

  beforeEach(() => {
    shared = false;
    copy.mockReset();
    server.use(
      http.get(`${API_URL}/reports/:id`, () =>
        HttpResponse.json({
          ...mockReport,
          share: shared
            ? {
                expiresAt: '2026-11-04T10:00:00Z',
                createdAt: '2026-10-05T10:00:00Z',
              }
            : null,
        }),
      ),
      http.post(`${API_URL}/reports/:id/share`, () => {
        shared = true;
        return HttpResponse.json({
          url: `https://app.krakenkey.io/r/${TOKEN}`,
          token: TOKEN,
          expiresAt: '2026-11-04T10:00:00Z',
        });
      }),
      http.delete(`${API_URL}/reports/:id/share`, () => {
        shared = false;
        return new HttpResponse(null, { status: 204 });
      }),
      http.delete(
        `${API_URL}/reports/:id`,
        () => new HttpResponse(null, { status: 204 }),
      ),
    );
  });

  it('creates and copies a share link, then revokes it', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByRole('button', { name: 'Share' }));

    const input = await screen.findByLabelText('Share link');
    expect(input).toHaveValue(`https://app.krakenkey.io/r/${TOKEN}`);
    expect(copy).toHaveBeenCalledWith(`https://app.krakenkey.io/r/${TOKEN}`);
    expect(
      await screen.findByText(/Shared link active until/),
    ).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Revoke' }));
    expect(
      await screen.findByRole('button', { name: 'Share' }),
    ).toBeInTheDocument();
    expect(screen.queryByLabelText('Share link')).not.toBeInTheDocument();
  });

  it('deletes after confirmation', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByRole('button', { name: 'Delete' }));
    await user.click(screen.getByRole('button', { name: 'Confirm delete' }));
    await waitFor(() =>
      expect(screen.getByText('Report list')).toBeInTheDocument(),
    );
  });

  it('shows a message for a missing report', async () => {
    server.use(
      http.get(`${API_URL}/reports/:id`, () =>
        HttpResponse.json({ statusCode: 404 }, { status: 404 }),
      ),
    );
    renderPage();
    expect(
      await screen.findByText('This report does not exist.'),
    ).toBeInTheDocument();
  });
});
