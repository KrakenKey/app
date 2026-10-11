import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Switch } from '../Switch';

describe('Switch', () => {
  it('reports its state and calls onChange with the new value', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Switch checked={false} onChange={onChange} label="Auto-renew" />);

    const toggle = screen.getByRole('switch', { name: 'Auto-renew' });
    expect(toggle).toHaveAttribute('aria-checked', 'false');
    await user.click(toggle);
    expect(onChange).toHaveBeenCalledWith(true);
  });

  it('takes an aria-label when there is no visible label', () => {
    render(<Switch checked onChange={() => {}} aria-label="Enable Ops" />);
    expect(screen.getByRole('switch', { name: 'Enable Ops' })).toBeChecked();
  });

  it('does not toggle while disabled', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <Switch checked onChange={onChange} disabled aria-label="Enable Ops" />,
    );

    await user.click(screen.getByRole('switch'));
    expect(onChange).not.toHaveBeenCalled();
  });
});
