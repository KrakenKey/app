import { act, render, renderHook, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import {
  ConfirmProvider,
  type ConfirmOptions,
} from '../../context/ConfirmContext';
import { useConfirm } from '../../hooks/useConfirm';
import { ConfirmDialog } from '../ui/ConfirmDialog';

const revoke: ConfirmOptions = {
  title: 'Revoke API key?',
  body: 'Anything using ci-deploy stops working immediately.',
  confirmLabel: 'Revoke key',
};

/** Button that asks for confirmation and prints the answer. */
function Harness({ options = revoke }: { options?: ConfirmOptions }) {
  const confirm = useConfirm();
  const [answer, setAnswer] = useState('none');
  return (
    <>
      <button onClick={async () => setAnswer(String(await confirm(options)))}>
        Revoke
      </button>
      <output>{answer}</output>
    </>
  );
}

function renderHarness(options?: ConfirmOptions) {
  return render(
    <ConfirmProvider>
      <Harness options={options} />
    </ConfirmProvider>,
  );
}

describe('ConfirmDialog', () => {
  it('shows the title, body and action verb', () => {
    render(
      <ConfirmDialog
        open
        {...revoke}
        onConfirm={() => {}}
        onCancel={() => {}}
      />,
    );

    expect(
      screen.getByRole('heading', { name: 'Revoke API key?' }),
    ).toBeInTheDocument();
    expect(screen.getByText(/stops working immediately/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Revoke key' })).toHaveClass(
      'text-red-300',
    );
    expect(screen.getByRole('button', { name: 'Cancel' })).toHaveFocus();
  });

  it('uses the primary style for non-destructive confirmations', () => {
    render(
      <ConfirmDialog
        open
        title="Send invite?"
        confirmLabel="Send invite"
        tone="primary"
        onConfirm={() => {}}
        onCancel={() => {}}
      />,
    );

    expect(screen.getByRole('button', { name: 'Send invite' })).toHaveClass(
      'bg-accent',
    );
  });

  it('renders nothing when closed', () => {
    render(
      <ConfirmDialog
        open={false}
        {...revoke}
        onConfirm={() => {}}
        onCancel={() => {}}
      />,
    );

    expect(screen.queryByText('Revoke API key?')).not.toBeInTheDocument();
  });
});

describe('useConfirm', () => {
  it('resolves true when the action is confirmed', async () => {
    const user = userEvent.setup();
    renderHarness();

    await user.click(screen.getByRole('button', { name: 'Revoke' }));
    await user.click(screen.getByRole('button', { name: 'Revoke key' }));

    expect(screen.getByRole('status')).toHaveTextContent('true');
    expect(screen.queryByText('Revoke API key?')).not.toBeInTheDocument();
  });

  it('resolves false on Cancel', async () => {
    const user = userEvent.setup();
    renderHarness();

    await user.click(screen.getByRole('button', { name: 'Revoke' }));
    await user.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(screen.getByRole('status')).toHaveTextContent('false');
    expect(screen.queryByText('Revoke API key?')).not.toBeInTheDocument();
  });

  it('resolves false on Escape', async () => {
    const user = userEvent.setup();
    renderHarness();

    await user.click(screen.getByRole('button', { name: 'Revoke' }));
    await user.keyboard('{Escape}');

    expect(screen.getByRole('status')).toHaveTextContent('false');
  });

  it('treats Enter as Cancel until the user moves to the action', async () => {
    const user = userEvent.setup();
    renderHarness();

    await user.click(screen.getByRole('button', { name: 'Revoke' }));
    await user.keyboard('{Enter}');
    expect(screen.getByRole('status')).toHaveTextContent('false');

    await user.click(screen.getByRole('button', { name: 'Revoke' }));
    await user.tab();
    expect(screen.getByRole('button', { name: 'Revoke key' })).toHaveFocus();
    await user.keyboard('{Enter}');
    expect(screen.getByRole('status')).toHaveTextContent('true');
  });

  it('returns focus to the button that opened it', async () => {
    const user = userEvent.setup();
    renderHarness();
    const trigger = screen.getByRole('button', { name: 'Revoke' });

    await user.click(trigger);
    await user.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(trigger).toHaveFocus();
  });

  it('cancels an unanswered request when another one starts', async () => {
    const { result } = renderHook(() => useConfirm(), {
      wrapper: ConfirmProvider,
    });
    const confirm = result.current;

    let first: Promise<boolean> = Promise.resolve(true);
    act(() => {
      first = confirm(revoke);
      void confirm({ ...revoke, title: 'Delete domain?' });
    });

    await expect(first).resolves.toBe(false);
    expect(screen.getByText('Delete domain?')).toBeInTheDocument();
  });

  it('throws outside a ConfirmProvider', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => renderHook(() => useConfirm())).toThrow(
      'useConfirm must be used within a ConfirmProvider',
    );
    vi.restoreAllMocks();
  });
});
