import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { render } from '../../test/test-utils';
import { server } from '../../test/mocks/server';
import { API_URL } from '../../services/api';
import { mockReport, mockReportListItem } from '../../test/mocks/reports';
import Reports from '../Reports';

const navigate = vi.fn();
let plan = 'free';

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom');
  return { ...actual, useNavigate: () => navigate };
});

vi.mock('../../hooks/useAuth', async () => {
  const actual = await vi.importActual('../../hooks/useAuth');
  return {
    ...actual,
    useAuth: () => ({
      user: {
        username: 'testuser',
        email: 'test@example.com',
        groups: [],
        plan,
      },
      isAuthenticated: true,
      isLoading: false,
    }),
  };
});

describe('Reports page', () => {
  beforeEach(() => {
    plan = 'free';
    navigate.mockReset();
    server.use(
      http.get(`${API_URL}/reports`, () =>
        HttpResponse.json([mockReportListItem]),
      ),
    );
  });

  it('lists past reports with status and counts', async () => {
    render(<Reports />);
    expect(await screen.findByText('Client sites')).toBeInTheDocument();
    expect(screen.getByText('4/4 hosts')).toBeInTheDocument();
    expect(screen.getByText('Complete')).toBeInTheDocument();
    expect(screen.getByText('1 critical')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /client sites/i })).toHaveAttribute(
      'href',
      `/dashboard/reports/${mockReport.id}`,
    );
  });

  it('shows an empty state', async () => {
    server.use(http.get(`${API_URL}/reports`, () => HttpResponse.json([])));
    render(<Reports />);
    expect(await screen.findByText('No reports yet')).toBeInTheDocument();
  });

  it('counts distinct hosts against the free plan limit', async () => {
    const user = userEvent.setup();
    render(<Reports />);
    expect(screen.getByTestId('host-count')).toHaveTextContent('0 of 25 hosts');
    await user.type(
      screen.getByLabelText('Hosts'),
      'a.example.com{enter}A.example.com{enter}b.example.com:8443',
    );
    expect(screen.getByTestId('host-count')).toHaveTextContent('2 of 25 hosts');
  });

  it('shows the paid plan limit', () => {
    plan = 'team';
    render(<Reports />);
    expect(screen.getByTestId('host-count')).toHaveTextContent(
      '0 of 250 hosts',
    );
  });

  it('blocks a list over the plan limit', async () => {
    const user = userEvent.setup();
    render(<Reports />);
    const many = Array.from({ length: 26 }, (_, i) => `h${i}.example.com`);
    await user.click(screen.getByLabelText('Hosts'));
    await user.paste(many.join('\n'));
    expect(screen.getByTestId('host-count')).toHaveTextContent(
      '26 of 25 hosts (over your plan limit)',
    );
    expect(screen.getByRole('button', { name: /run report/i })).toBeDisabled();
  });

  it('creates a report and opens it', async () => {
    const user = userEvent.setup();
    let body: unknown;
    server.use(
      http.post(`${API_URL}/reports`, async ({ request }) => {
        body = await request.json();
        return HttpResponse.json({ ...mockReport, status: 'pending' });
      }),
    );
    render(<Reports />);
    await user.type(
      screen.getByLabelText('Hosts'),
      'a.example.com{enter}{enter}b.example.com',
    );
    await user.type(screen.getByLabelText('Name (optional)'), 'Clients');
    await user.click(screen.getByRole('button', { name: /run report/i }));
    await waitFor(() =>
      expect(navigate).toHaveBeenCalledWith(
        `/dashboard/reports/${mockReport.id}`,
      ),
    );
    expect(body).toEqual({
      hosts: ['a.example.com', 'b.example.com'],
      name: 'Clients',
    });
  });

  it('shows validation errors from the API', async () => {
    const user = userEvent.setup();
    server.use(
      http.post(`${API_URL}/reports`, () =>
        HttpResponse.json(
          {
            statusCode: 400,
            message: ['"10.0.0.1": private IP addresses are not allowed'],
            error: 'Bad Request',
          },
          { status: 400 },
        ),
      ),
    );
    render(<Reports />);
    await user.type(screen.getByLabelText('Hosts'), '10.0.0.1');
    await user.click(screen.getByRole('button', { name: /run report/i }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'private IP addresses are not allowed',
    );
  });
});
