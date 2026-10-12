import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useEffect } from 'react';
import { useAccessForm } from '../../../hooks/useAccessForm';
import { mockCerts, mockDomains } from '../../../test/mocks/data';
import { RestrictionPicker } from '../RestrictionPicker';

vi.mock('../../../services/domainService', () => ({
  fetchDomains: () => Promise.resolve(mockDomains),
}));
vi.mock('../../../services/certificateService', () => ({
  fetchCertificates: () => Promise.resolve(mockCerts),
}));

function Harness({
  initial,
}: {
  initial?: { domainIds?: string[]; certIds?: number[] };
}) {
  const form = useAccessForm(initial);
  const { loadCerts, loadDomains } = form;
  useEffect(() => {
    void loadCerts();
    void loadDomains();
  }, [loadCerts, loadDomains]);
  return (
    <>
      <RestrictionPicker form={form} />
      <output data-testid="picked">
        {JSON.stringify({ certs: form.certIds, domains: form.domainIds })}
      </output>
    </>
  );
}

const rowNames = (group: string) =>
  within(screen.getByRole('group', { name: group }))
    .queryAllByRole('checkbox')
    .map((c) => c.closest('label')?.textContent ?? '');

describe('RestrictionPicker', () => {
  it('lists certificates and domains in one list with selection counts', async () => {
    const user = userEvent.setup();
    render(<Harness />);

    await user.click(
      await screen.findByRole('checkbox', { name: /^#1 example\.com/ }),
    );
    await user.click(screen.getByRole('checkbox', { name: /^example\.com/ }));

    expect(screen.getByTestId('picked')).toHaveTextContent(
      '{"certs":[1],"domains":["domain-1"]}',
    );
    const certs = within(screen.getByRole('group', { name: 'Certificates' }));
    expect(certs.getByText('1 of up to 50 selected')).toBeInTheDocument();
    expect(
      screen.getByRole('checkbox', { name: /^unverified\.com Unverified/ }),
    ).toBeInTheDocument();
    // One scrolling list, not one per picker
    expect(screen.getAllByTestId('restriction-list')).toHaveLength(1);
  });

  it('filters both groups by name and keeps Enter from submitting', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn((e: React.FormEvent) => e.preventDefault());
    render(
      <form onSubmit={onSubmit}>
        <Harness />
      </form>,
    );
    await screen.findByRole('checkbox', { name: /^#1 example\.com/ });

    const filter = screen.getByLabelText('Filter certificates and domains');
    await user.type(filter, 'unverified{Enter}');

    expect(onSubmit).not.toHaveBeenCalled();
    expect(rowNames('Domains')).toEqual(['unverified.com Unverified']);
    expect(
      within(screen.getByRole('group', { name: 'Certificates' })).getByText(
        'No certificates match.',
      ),
    ).toBeInTheDocument();

    await user.clear(filter);
    await user.type(filter, 'WWW.EXAMPLE');
    // Matches on any name the certificate covers, not only the first
    expect(rowNames('Certificates')).toEqual([
      expect.stringMatching(/^#1 example\.com \+1/),
    ]);
  });

  it('lists what was already picked first', async () => {
    render(<Harness initial={{ domainIds: ['domain-2'], certIds: [2] }} />);
    await screen.findByRole('checkbox', { name: /^#2 / });

    expect(rowNames('Certificates')[0]).toMatch(/^#2 /);
    expect(rowNames('Domains')[0]).toMatch(/^unverified\.com/);
    expect(screen.getByRole('checkbox', { name: /^#2 / })).toBeChecked();
  });
});
