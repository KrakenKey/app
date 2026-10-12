import { useState, useEffect, useCallback } from 'react';
import {
  Building2,
  Plus,
  UserMinus,
  UserPlus,
  CreditCard,
  Settings,
  Crown,
  LogOut,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { toast } from '../utils/toast';
import { useActionSet } from '../hooks/useActionSet';
import { useConfirm } from '../hooks/useConfirm';
import * as orgService from '../services/organizationService';
import type { Organization, OrgMember } from '../services/organizationService';
import type { OrgRole } from '@krakenkey/shared';
import { Card, CardHeader } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Input } from '../components/ui/Input';
import { Select } from '../components/ui/Select';
import { RowMenu } from '../components/ui/Menu';
import { Badge } from '../components/ui/Badge';
import { Modal } from '../components/ui/Modal';
import { PageHeader } from '../components/ui/PageHeader';
import { EmptyState } from '../components/ui/EmptyState';
import {
  Table,
  TableHeader,
  TableRow,
  TableHead,
  TableCell,
} from '../components/ui/Table';

// Roles are not statuses: the owner gets the brand tone, everyone else is
// neutral, so nothing here reads as a warning.
const ROLE_BADGE: Record<
  OrgRole,
  { label: string; variant: 'accent' | 'neutral' }
> = {
  owner: { label: 'Owner', variant: 'accent' },
  admin: { label: 'Admin', variant: 'neutral' },
  member: { label: 'Member', variant: 'neutral' },
  viewer: { label: 'Viewer', variant: 'neutral' },
};

const ASSIGNABLE_ROLES: {
  value: Exclude<OrgRole, 'owner'>;
  label: string;
  description: string;
}[] = [
  {
    value: 'admin',
    label: 'Admin',
    description: 'Full access except ownership',
  },
  {
    value: 'member',
    label: 'Member',
    description: 'Can create and manage resources',
  },
  { value: 'viewer', label: 'Viewer', description: 'Read-only access' },
];

/** The name to show for a member: display name, else username. */
function memberName(member: OrgMember): string {
  return member.displayName?.trim() || member.username;
}

function initials(name: string): string {
  const parts = name.split(/[\s._@-]+/).filter(Boolean);
  const letters =
    parts.length > 1 ? parts[0][0] + parts[1][0] : name.slice(0, 2);
  return letters.toUpperCase();
}

const ORG_ELIGIBLE_PLANS = new Set(['team', 'business', 'enterprise']);

export default function Organizations() {
  const { user, refreshUser } = useAuth();
  const navigate = useNavigate();

  const [org, setOrg] = useState<Organization | null>(null);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [newOrgName, setNewOrgName] = useState('');

  // Invite
  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] =
    useState<Exclude<OrgRole, 'owner'>>('member');
  const [inviting, setInviting] = useState(false);

  // Rename
  const [renameOpen, setRenameOpen] = useState(false);
  const [renameName, setRenameName] = useState('');
  const [renaming, setRenaming] = useState(false);

  // Transfer ownership
  const [transferOpen, setTransferOpen] = useState(false);
  const [transferEmail, setTransferEmail] = useState('');
  const [transferring, setTransferring] = useState(false);

  // Delete org
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState('');
  const [deleting, setDeleting] = useState(false);

  // Per-member actions
  const removingIds = useActionSet<string>();
  const confirm = useConfirm();
  const updatingRoleIds = useActionSet<string>();

  const isOwner = user?.role === 'owner';
  const canManage = user?.role === 'owner' || user?.role === 'admin';

  const loadOrg = useCallback(async () => {
    if (!user?.organizationId) {
      setLoading(false);
      return;
    }
    try {
      const data = await orgService.fetchOrganization(user.organizationId);
      setOrg(data);
    } catch {
      toast.error('Failed to load organization');
    } finally {
      setLoading(false);
    }
  }, [user?.organizationId]);

  useEffect(() => {
    loadOrg();
  }, [loadOrg]);

  async function handleCreate(e: React.SyntheticEvent) {
    e.preventDefault();
    const name = newOrgName.trim();
    if (!name) {
      toast.error('Please enter an organization name');
      return;
    }
    try {
      setCreating(true);
      const created = await orgService.createOrganization(name);
      toast.success(`Organization "${created.name}" created`);
      await refreshUser();
      await loadOrg();
    } catch (err: unknown) {
      const msg =
        (err as { response?: { data?: { message?: string } } })?.response?.data
          ?.message ?? 'Failed to create organization';
      toast.error(msg);
    } finally {
      setCreating(false);
    }
  }

  async function handleInvite(e: React.SyntheticEvent) {
    e.preventDefault();
    const email = inviteEmail.trim();
    if (!email || !org) return;
    try {
      setInviting(true);
      await orgService.inviteMember(org.id, email, inviteRole);
      toast.success('Member invited');
      setInviteEmail('');
      setInviteRole('member');
      setInviteOpen(false);
      await loadOrg();
    } catch (err: unknown) {
      const msg =
        (err as { response?: { data?: { message?: string } } })?.response?.data
          ?.message ?? 'Failed to invite member';
      toast.error(msg);
    } finally {
      setInviting(false);
    }
  }

  async function handleRemove(memberId: string, memberName: string) {
    if (!org) return;
    const leaving = memberId === user?.id;
    const ok = await confirm({
      title: leaving ? 'Leave organization?' : 'Remove member?',
      body: leaving ? (
        <>
          You lose access to <strong className="text-text">{org.name}</strong>.
        </>
      ) : (
        <>
          Remove <strong className="text-text">{memberName}</strong> from{' '}
          <strong className="text-text">{org.name}</strong>?
        </>
      ),
      confirmLabel: leaving ? 'Leave organization' : 'Remove member',
    });
    if (!ok) return;
    try {
      removingIds.add(memberId);
      await orgService.removeMember(org.id, memberId);
      toast.success(`${memberName} removed`);
      if (memberId === user?.id) {
        await refreshUser();
        setOrg(null);
      } else {
        await loadOrg();
      }
    } catch (err: unknown) {
      const msg =
        (err as { response?: { data?: { message?: string } } })?.response?.data
          ?.message ?? 'Failed to remove member';
      toast.error(msg);
    } finally {
      removingIds.remove(memberId);
    }
  }

  async function handleRename(e: React.SyntheticEvent) {
    e.preventDefault();
    const name = renameName.trim();
    if (!name || !org) return;
    try {
      setRenaming(true);
      const updated = await orgService.updateOrganization(org.id, name);
      setOrg(updated);
      toast.success('Organization renamed');
      setRenameOpen(false);
      setRenameName('');
    } catch (err: unknown) {
      const msg =
        (err as { response?: { data?: { message?: string } } })?.response?.data
          ?.message ?? 'Failed to rename organization';
      toast.error(msg);
    } finally {
      setRenaming(false);
    }
  }

  async function handleTransferOwnership(e: React.SyntheticEvent) {
    e.preventDefault();
    const email = transferEmail.trim();
    if (!email || !org) return;
    try {
      setTransferring(true);
      await orgService.transferOwnership(org.id, email);
      toast.success('Ownership transferred');
      setTransferOpen(false);
      setTransferEmail('');
      await refreshUser();
      await loadOrg();
    } catch (err: unknown) {
      const msg =
        (err as { response?: { data?: { message?: string } } })?.response?.data
          ?.message ?? 'Failed to transfer ownership';
      toast.error(msg);
    } finally {
      setTransferring(false);
    }
  }

  async function handleDeleteOrg(e: React.SyntheticEvent) {
    e.preventDefault();
    if (!org || deleteConfirm !== org.name) return;
    try {
      setDeleting(true);
      await orgService.deleteOrganization(org.id);
      toast.success('Organization deleted');
      setDeleteOpen(false);
      setDeleteConfirm('');
      await refreshUser();
      setOrg(null);
    } catch (err: unknown) {
      const msg =
        (err as { response?: { data?: { message?: string } } })?.response?.data
          ?.message ?? 'Failed to delete organization';
      toast.error(msg);
    } finally {
      setDeleting(false);
    }
  }

  async function handleRoleChange(
    memberId: string,
    role: Exclude<OrgRole, 'owner'>,
  ) {
    if (!org) return;
    try {
      updatingRoleIds.add(memberId);
      await orgService.updateMemberRole(org.id, memberId, role);
      toast.success('Role updated');
      await loadOrg();
    } catch (err: unknown) {
      const msg =
        (err as { response?: { data?: { message?: string } } })?.response?.data
          ?.message ?? 'Failed to update role';
      toast.error(msg);
    } finally {
      updatingRoleIds.remove(memberId);
    }
  }

  if (loading) {
    return (
      <div>
        <PageHeader
          title="Organization"
          icon={<Building2 className="w-6 h-6" />}
        />
        <p className="text-zinc-400 text-sm">Loading...</p>
      </div>
    );
  }

  // Not on an eligible plan and not in an org: show upsell
  if (!user?.organizationId && !ORG_ELIGIBLE_PLANS.has(user?.plan ?? '')) {
    return (
      <div>
        <PageHeader
          title="Organization"
          description="Collaborate with your team using shared resources and role-based access."
          icon={<Building2 className="w-6 h-6" />}
        />
        <Card className="max-w-lg">
          <div className="flex flex-col gap-4">
            <p className="text-zinc-300 text-sm">
              Organizations are available on the Team plan and above. Upgrade to
              create an organization, invite members, and manage access with
              owner, admin, member, and viewer roles.
            </p>
            <Button
              variant="primary"
              icon={<CreditCard className="w-4 h-4" />}
              onClick={() => navigate('/dashboard/billing')}
            >
              Upgrade to Team
            </Button>
          </div>
        </Card>
      </div>
    );
  }

  // Eligible but no org yet: show create form
  if (!user?.organizationId) {
    return (
      <div>
        <PageHeader
          title="Organization"
          description="Create an organization to collaborate with your team."
          icon={<Building2 className="w-6 h-6" />}
        />
        <Card className="max-w-lg">
          <h3 className="text-sm font-medium text-zinc-400 mb-4">
            Create Organization
          </h3>
          <form onSubmit={handleCreate} className="flex gap-3">
            <Input
              placeholder="Organization name"
              value={newOrgName}
              onChange={(e) => setNewOrgName(e.target.value)}
              disabled={creating}
              className="flex-1"
            />
            <Button
              type="submit"
              variant="primary"
              icon={<Plus className="w-3.5 h-3.5" />}
              disabled={creating}
            >
              {creating ? 'Creating...' : 'Create'}
            </Button>
          </form>
        </Card>
      </div>
    );
  }

  // In an org: show details and member management
  const memberCount = org?.members.length ?? 0;
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={org?.name ?? 'Organization'}
        description="Manage your organization members and roles."
        icon={<Building2 className="w-6 h-6" />}
        actions={
          canManage && (
            <Button
              variant="primary"
              icon={<UserPlus className="w-4 h-4" />}
              onClick={() => setInviteOpen(true)}
            >
              Invite member
            </Button>
          )
        }
      />

      {/* Members */}
      <Card flush>
        <CardHeader
          title="Members"
          description={`${memberCount} ${memberCount === 1 ? 'member' : 'members'}`}
        />

        {!org?.members.length ? (
          <EmptyState
            icon={<Building2 className="w-8 h-8" />}
            title="No members yet"
            description="Invite your teammates to get started."
          />
        ) : (
          <Table>
            <TableHeader>
              <TableHead>User</TableHead>
              <TableHead>Role</TableHead>
              <TableHead className="w-12">
                <span className="sr-only">Actions</span>
              </TableHead>
            </TableHeader>
            <tbody>
              {org.members.map((member) => {
                const roleBadge = ROLE_BADGE[member.role];
                const name = memberName(member);
                const isSelf = member.id === user?.id;
                const isOwnerMember = member.role === 'owner';
                const canRemove = canManage && !isOwnerMember;
                const canLeave = isSelf && !isOwnerMember;
                const canChangeRole = canManage && !isOwnerMember && !isSelf;
                const removing = removingIds.has(member.id);
                const roleControl = canChangeRole ? (
                  <Select
                    size="sm"
                    aria-label={`Role for ${name}`}
                    value={member.role}
                    disabled={updatingRoleIds.has(member.id)}
                    onChange={(e) =>
                      handleRoleChange(
                        member.id,
                        e.target.value as Exclude<OrgRole, 'owner'>,
                      )
                    }
                    className="w-24 sm:w-28"
                  >
                    {ASSIGNABLE_ROLES.map((r) => (
                      <option key={r.value} value={r.value}>
                        {r.label}
                      </option>
                    ))}
                  </Select>
                ) : (
                  <Badge variant={roleBadge.variant}>{roleBadge.label}</Badge>
                );

                return (
                  <TableRow key={member.id}>
                    <TableCell>
                      <div className="flex items-center gap-3 min-w-0">
                        <span
                          aria-hidden="true"
                          className="hidden min-[420px]:flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-surface-elevated text-[11px] font-semibold text-text-secondary ring-1 ring-inset ring-border-strong"
                        >
                          {initials(name)}
                        </span>
                        <div className="min-w-0 max-w-[9.5rem] min-[420px]:max-w-none">
                          <p className="text-sm font-medium text-text truncate">
                            {name}
                            {isSelf && (
                              <span className="ml-2 text-xs font-normal text-text-muted">
                                (you)
                              </span>
                            )}
                          </p>
                          <p className="text-xs text-text-muted truncate">
                            {member.email}
                          </p>
                        </div>
                      </div>
                    </TableCell>
                    <TableCell>{roleControl}</TableCell>
                    <TableCell className="w-12 pl-0 text-right">
                      {(canRemove || canLeave) && (
                        <RowMenu
                          label={`More actions for ${name}`}
                          items={[
                            {
                              label: removing
                                ? 'Removing...'
                                : isSelf
                                  ? 'Leave organization'
                                  : 'Remove from organization',
                              icon: isSelf ? (
                                <LogOut className="w-4 h-4" />
                              ) : (
                                <UserMinus className="w-4 h-4" />
                              ),
                              danger: true,
                              disabled: removing,
                              onClick: () => handleRemove(member.id, name),
                            },
                          ]}
                        />
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </tbody>
          </Table>
        )}
      </Card>

      {/* Settings (owner/admin only) */}
      {canManage && (
        <Card flush>
          <CardHeader
            title={
              <span className="flex items-center gap-2">
                <Settings className="w-4 h-4 text-text-muted" />
                Settings
              </span>
            }
          />
          <div className="divide-y divide-border-subtle">
            <SettingRow
              title="Rename organization"
              description="Change the display name"
            >
              <Button
                size="sm"
                variant="secondary"
                onClick={() => {
                  setRenameName(org?.name ?? '');
                  setRenameOpen(true);
                }}
              >
                Rename
              </Button>
            </SettingRow>

            {isOwner && (
              <>
                <SettingRow
                  title="Transfer ownership"
                  description="Assign a new owner. You become an admin."
                >
                  <Button
                    size="sm"
                    variant="secondary"
                    icon={<Crown className="w-3.5 h-3.5" />}
                    onClick={() => setTransferOpen(true)}
                  >
                    Transfer
                  </Button>
                </SettingRow>
                <SettingRow
                  title="Delete organization"
                  description="Permanently deletes the organization and removes all members"
                >
                  <Button
                    size="sm"
                    variant="danger"
                    onClick={() => setDeleteOpen(true)}
                  >
                    Delete
                  </Button>
                </SettingRow>
              </>
            )}
          </div>
        </Card>
      )}

      {/* Invite Modal */}
      <Modal
        open={inviteOpen}
        onClose={() => {
          setInviteOpen(false);
          setInviteEmail('');
          setInviteRole('member');
        }}
        title="Invite member"
        description="They join with the role you pick. You can change it later."
        footer={
          <>
            <Button
              type="button"
              variant="ghost"
              onClick={() => setInviteOpen(false)}
              disabled={inviting}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              form="invite-member-form"
              variant="primary"
              icon={<UserPlus className="w-3.5 h-3.5" />}
              disabled={inviting || !inviteEmail.trim()}
            >
              {inviting ? 'Inviting...' : 'Invite'}
            </Button>
          </>
        }
      >
        <form
          id="invite-member-form"
          onSubmit={handleInvite}
          aria-label="Invite member"
          className="flex flex-col gap-4"
        >
          <Input
            id="invite-email"
            label="Email address"
            type="email"
            placeholder="alice@example.com"
            value={inviteEmail}
            onChange={(e) => setInviteEmail(e.target.value)}
            disabled={inviting}
            helpText="The user must have signed in at least once."
          />
          <Select
            id="invite-role"
            label="Role"
            value={inviteRole}
            onChange={(e) =>
              setInviteRole(e.target.value as Exclude<OrgRole, 'owner'>)
            }
            disabled={inviting}
            helpText={
              ASSIGNABLE_ROLES.find((r) => r.value === inviteRole)?.description
            }
          >
            {ASSIGNABLE_ROLES.map((r) => (
              <option key={r.value} value={r.value}>
                {r.label}
              </option>
            ))}
          </Select>
        </form>
      </Modal>

      {/* Rename Modal */}
      <Modal
        open={renameOpen}
        onClose={() => {
          setRenameOpen(false);
          setRenameName('');
        }}
        title="Rename Organization"
      >
        <form onSubmit={handleRename} className="flex flex-col gap-4">
          <div>
            <label className="block text-sm text-zinc-400 mb-1.5">
              New name
            </label>
            <Input
              placeholder="Organization name"
              value={renameName}
              onChange={(e) => setRenameName(e.target.value)}
              disabled={renaming}
            />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button
              type="button"
              variant="ghost"
              onClick={() => setRenameOpen(false)}
              disabled={renaming}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              variant="primary"
              disabled={renaming || !renameName.trim()}
            >
              {renaming ? 'Saving...' : 'Save'}
            </Button>
          </div>
        </form>
      </Modal>

      {/* Transfer Ownership Modal */}
      <Modal
        open={transferOpen}
        onClose={() => {
          setTransferOpen(false);
          setTransferEmail('');
        }}
        title="Transfer Ownership"
      >
        <form
          onSubmit={handleTransferOwnership}
          className="flex flex-col gap-4"
        >
          <p className="text-sm text-zinc-400">
            You will become an admin. This cannot be undone without the new
            owner transferring back.
          </p>
          <div>
            <label className="block text-sm text-zinc-400 mb-1.5">
              New owner's email address
            </label>
            <Input
              type="email"
              placeholder="alice@example.com"
              value={transferEmail}
              onChange={(e) => setTransferEmail(e.target.value)}
              disabled={transferring}
            />
            <p className="text-xs text-zinc-500 mt-1.5">
              Must be an existing member of this organization.
            </p>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button
              type="button"
              variant="ghost"
              onClick={() => setTransferOpen(false)}
              disabled={transferring}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              variant="danger"
              icon={<Crown className="w-3.5 h-3.5" />}
              disabled={transferring || !transferEmail.trim()}
            >
              {transferring ? 'Transferring...' : 'Transfer Ownership'}
            </Button>
          </div>
        </form>
      </Modal>

      {/* Delete Org Modal */}
      <Modal
        open={deleteOpen}
        onClose={() => {
          setDeleteOpen(false);
          setDeleteConfirm('');
        }}
        title="Delete Organization"
      >
        <form onSubmit={handleDeleteOrg} className="flex flex-col gap-4">
          <p className="text-sm text-zinc-400">
            This will permanently delete{' '}
            <span className="text-zinc-200 font-medium">{org?.name}</span> and
            remove all members. This cannot be undone.
          </p>
          <div>
            <label className="block text-sm text-zinc-400 mb-1.5">
              Type{' '}
              <span className="text-zinc-200 font-medium">{org?.name}</span> to
              confirm
            </label>
            <Input
              placeholder={org?.name}
              value={deleteConfirm}
              onChange={(e) => setDeleteConfirm(e.target.value)}
              disabled={deleting}
            />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button
              type="button"
              variant="ghost"
              onClick={() => setDeleteOpen(false)}
              disabled={deleting}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              variant="danger"
              disabled={deleting || deleteConfirm !== org?.name}
            >
              {deleting ? 'Deleting...' : 'Delete Organization'}
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}

function SettingRow({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-4 px-5 py-4">
      <div className="min-w-0">
        <p className="text-sm text-text">{title}</p>
        <p className="text-xs text-text-muted">{description}</p>
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}
