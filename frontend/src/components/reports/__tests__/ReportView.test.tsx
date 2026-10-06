import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ReportView } from '../ReportView';
import { mockReport } from '../../../test/mocks/reports';

function hostColumn() {
  const rows = screen.getAllByRole('row').slice(1);
  return rows.map((r) => within(r).getAllByRole('cell')[0].textContent ?? '');
}

describe('ReportView', () => {
  it('shows summary counts, issuers and earliest expiry', () => {
    render(<ReportView report={mockReport} onDownloadCsv={() => {}} />);
    expect(screen.getByTestId('count-critical')).toHaveTextContent('1');
    expect(screen.getByTestId('count-ok')).toHaveTextContent('1');
    expect(screen.getByText("4 total, 3 on Let's Encrypt")).toBeInTheDocument();
    expect(screen.getByText(/expired\.example\.com on/)).toBeInTheDocument();
    expect(
      screen.getByText('DigiCert Inc', { selector: 'span' }),
    ).toBeInTheDocument();
    expect(screen.getByText('4 of 4 hosts scanned')).toBeInTheDocument();
  });

  it('lists hosts most urgent first', () => {
    render(<ReportView report={mockReport} onDownloadCsv={() => {}} />);
    expect(hostColumn().map((t) => t.split('TLS')[0])).toEqual([
      'expired.example.com',
      'soon.example.com',
      'month.example.com',
      'fine.example.com',
    ]);
    expect(screen.getByText('2d ago')).toBeInTheDocument();
    expect(screen.getByText('Expires in 6 days')).toBeInTheDocument();
  });

  it('filters by severity from the buttons and the summary cards', async () => {
    const user = userEvent.setup();
    render(<ReportView report={mockReport} onDownloadCsv={() => {}} />);

    await user.click(screen.getByRole('button', { name: 'Warning' }));
    expect(hostColumn()).toHaveLength(1);
    expect(hostColumn()[0]).toContain('soon.example.com');

    await user.click(screen.getByRole('button', { name: /All \(4\)/ }));
    expect(hostColumn()).toHaveLength(4);

    await user.click(screen.getByTestId('count-critical'));
    expect(hostColumn()).toHaveLength(1);
    expect(hostColumn()[0]).toContain('expired.example.com');
  });

  it('sorts by host and toggles direction', async () => {
    const user = userEvent.setup();
    render(<ReportView report={mockReport} onDownloadCsv={() => {}} />);
    const hostHeader = screen.getByRole('button', { name: 'Host' });

    await user.click(hostHeader);
    expect(hostColumn()[0]).toContain('expired.example.com');
    expect(hostColumn()[3]).toContain('soon.example.com');

    await user.click(hostHeader);
    expect(hostColumn()[0]).toContain('soon.example.com');
  });

  it('calls the CSV handler', async () => {
    const user = userEvent.setup();
    const onDownload = vi.fn();
    render(<ReportView report={mockReport} onDownloadCsv={onDownload} />);
    await user.click(screen.getByRole('button', { name: /download csv/i }));
    expect(onDownload).toHaveBeenCalledTimes(1);
  });

  it('shows progress while scanning', () => {
    render(
      <ReportView
        report={{
          ...mockReport,
          status: 'running',
          completedCount: 1,
          hosts: [
            mockReport.hosts[0],
            {
              ...mockReport.hosts[3],
              host: 'later.example.com',
              status: 'pending',
              severity: null,
              daysLeft: null,
            },
          ],
        }}
        onDownloadCsv={() => {}}
      />,
    );
    expect(screen.getByRole('progressbar')).toHaveAttribute(
      'aria-valuenow',
      '1',
    );
    expect(screen.getByText('Scanning')).toBeInTheDocument();
    expect(screen.getByText('Pending')).toBeInTheDocument();
  });
});
