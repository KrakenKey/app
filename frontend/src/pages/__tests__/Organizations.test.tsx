import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import type { Organization } from '../../services/organizationService';
import Organizations from '../Organizations';
import { ConfirmProvider } from '../../context/ConfirmContext';

const { orgService, authUser } = vi.hoisted(() => ({
  orgService: {
    fetchOrganization: vi.fn(),
    inviteMember: vi.fn(),
    removeMember: vi.fn(),
    updateMemberRole: vi.fn(),
    createOrganization: vi.fn(),
    updateOrganization: vi.fn(),
    transferOwnership: vi.fn(),
    deleteOrganization: vi.fn(),
  },
  authUser: {
    id: 'usr_owner',
    plan: 'team',
    organizationId: 'org_1',
    role: 'owner' as string,
  },
}));

vi.mock('../../services/organizationService', () => orgService);
vi.mock('../../hooks/useAuth', () => ({
  useAuth: () => ({ user: authUser, refreshUser: vi.fn() }),
}));
vi.mock('../../utils/toast', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

const org: Organization = {
  id: 'org_1',
  name: 'Harborline IT',
  ownerId: 'usr_owner',
  plan: 'team',
  createdAt: '2026-01-01T00:00:00.000Z',
  members: [
    {
      id: 'usr_owner',
      username: 'maya',
      email: 'maya@example.com',
      displayName: 'Maya Okafor',
      role: 'owner',
    },
    {
      id: 'usr_devon',
      username: 'devon',
      email: 'devon@example.com',
      displayName: 'Devon Price',
      role: 'admin',
    },
    {
      id: 'usr_alex',
      username: 'alex.chen',
      email: 'alex@example.com',
      displayName: null,
      role: 'viewer',
    },
  ],
};

function renderPage() {
  return render(
    <MemoryRouter>
      <ConfirmProvider>
        <Organizations />
      </ConfirmProvider>
    </MemoryRouter>,
  );
}

describe('Organizations', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authUser.role = 'owner';
    authUser.id = 'usr_owner';
    orgService.fetchOrganization.mockResolvedValue(org);
    orgService.removeMember.mockResolvedValue(undefined);
    orgService.updateMemberRole.mockResolvedValue(undefined);
    orgService.inviteMember.mockResolvedValue(undefined);
  });

  it('shows members with a name and email, and a neutral role for the owner', async () => {
    renderPage();
    await screen.findByText('Maya Okafor');

    expect(screen.getByText('3 members')).toBeInTheDocument();
    // A member without a display name falls back to the username
    const alexRow = screen.getByRole('row', { name: /alex\.chen/ });
    expect(within(alexRow).getByText('alex@example.com')).toBeInTheDocument();
    // The owner's role is a badge, not a picker
    const ownerRow = screen.getByRole('row', { name: /Maya Okafor/ });
    expect(within(ownerRow).getByText('Owner')).toBeInTheDocument();
    expect(within(ownerRow).queryByRole('combobox')).not.toBeInTheDocument();
    expect(
      within(ownerRow).queryByRole('button', { name: /more actions/i }),
    ).not.toBeInTheDocument();
  });

  it('puts Invite member in the page header', async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByText('Maya Okafor');

    await user.click(screen.getByRole('button', { name: 'Invite member' }));
    const dialog = within(screen.getByRole('dialog'));
    await user.type(dialog.getByLabelText('Email address'), 'sam@example.com');
    await user.selectOptions(dialog.getByLabelText('Role'), 'viewer');
    expect(dialog.getByText('Read-only access')).toBeInTheDocument();
    await user.click(dialog.getByRole('button', { name: 'Invite' }));

    expect(orgService.inviteMember).toHaveBeenCalledWith(
      'org_1',
      'sam@example.com',
      'viewer',
    );
  });

  it('changes a role with the role picker', async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByText('Devon Price');

    await user.selectOptions(
      screen.getByRole('combobox', { name: 'Role for Devon Price' }),
      'member',
    );
    expect(orgService.updateMemberRole).toHaveBeenCalledWith(
      'org_1',
      'usr_devon',
      'member',
    );
  });

  it('removes a member from the row menu', async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByText('Devon Price');

    expect(
      screen.queryByRole('button', { name: /^remove/i }),
    ).not.toBeInTheDocument();
    await user.click(
      screen.getByRole('button', { name: 'More actions for Devon Price' }),
    );
    await user.click(
      screen.getByRole('menuitem', { name: 'Remove from organization' }),
    );

    const dialog = await screen.findByRole('dialog', {
      name: 'Remove member?',
    });
    await user.click(
      within(dialog).getByRole('button', { name: 'Remove member' }),
    );
    await waitFor(() =>
      expect(orgService.removeMember).toHaveBeenCalledWith(
        'org_1',
        'usr_devon',
      ),
    );
  });

  it('hides management controls from a viewer, except leaving', async () => {
    authUser.role = 'viewer';
    authUser.id = 'usr_alex';
    renderPage();
    await screen.findByText('Maya Okafor');

    expect(
      screen.queryByRole('button', { name: 'Invite member' }),
    ).not.toBeInTheDocument();
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'More actions for alex.chen' }),
    ).toBeInTheDocument();
  });
});
