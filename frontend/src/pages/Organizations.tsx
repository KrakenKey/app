import { useState, useEffect, useCallback } from 'react';
import { Building2, Plus, Trash2, UserPlus, CreditCard } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { toast } from '../utils/toast';
import { useActionSet } from '../hooks/useActionSet';
import * as orgService from '../services/organizationService';
import type { Organization } from '../services/organizationService';
import type { OrgRole } from '@krakenkey/shared';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Input } from '../components/ui/Input';
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

const ROLE_BADGE: Record<
  OrgRole,
  { label: string; variant: 'warning' | 'info' | 'neutral' | 'neutral' }
> = {
  owner: { label: 'Owner', variant: 'warning' },
  admin: { label: 'Admin', variant: 'info' },
  member: { label: 'Member', variant: 'neutral' },
  viewer: { label: 'Viewer', variant: 'neutral' },
};

const ORG_ELIGIBLE_PLANS = new Set(['team', 'business', 'enterprise']);

export default function Organizations() {
  const { user, refreshUser } = useAuth();
  const navigate = useNavigate();

  const [org, setOrg] = useState<Organization | null>(null);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [newOrgName, setNewOrgName] = useState('');
  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviteUserId, setInviteUserId] = useState('');
  const [inviteRole, setInviteRole] =
    useState<Exclude<OrgRole, 'owner'>>('member');
  const [inviting, setInviting] = useState(false);
  const removingIds = useActionSet<string>();

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
    const userId = inviteUserId.trim();
    if (!userId || !org) return;
    try {
      setInviting(true);
      await orgService.inviteMember(org.id, userId, inviteRole);
      toast.success('Member invited');
      setInviteUserId('');
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
    if (!confirm(`Remove ${memberName} from the organization?`)) return;
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

  // Not on an eligible plan and not in an org — show upsell
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

  // Eligible but no org yet — show create form
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

  // In an org — show details and member management
  return (
    <div>
      <PageHeader
        title={org?.name ?? 'Organization'}
        description="Manage your organization members and roles."
        icon={<Building2 className="w-6 h-6" />}
      />

      <Card>
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-medium text-zinc-400">
            Members ({org?.members.length ?? 0})
          </h3>
          {canManage && (
            <Button
              variant="primary"
              size="sm"
              icon={<UserPlus className="w-3.5 h-3.5" />}
              onClick={() => setInviteOpen(true)}
            >
              Invite Member
            </Button>
          )}
        </div>

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
              <TableHead>Actions</TableHead>
            </TableHeader>
            <tbody>
              {org.members.map((member) => {
                const roleBadge = ROLE_BADGE[member.role];
                const isSelf = member.id === user?.id;
                const isOwner = member.role === 'owner';
                const canRemove = canManage && !isOwner;
                const canLeave = isSelf && !isOwner;

                return (
                  <TableRow key={member.id}>
                    <TableCell>
                      <div>
                        <p className="text-sm font-medium text-zinc-200">
                          {member.displayName || member.username}
                          {isSelf && (
                            <span className="ml-2 text-xs text-zinc-500">
                              (you)
                            </span>
                          )}
                        </p>
                        <p className="text-xs text-zinc-500">{member.email}</p>
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge variant={roleBadge.variant}>
                        {roleBadge.label}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      {(canRemove || canLeave) && (
                        <Button
                          size="sm"
                          variant="danger"
                          icon={<Trash2 className="w-3.5 h-3.5" />}
                          onClick={() =>
                            handleRemove(
                              member.id,
                              member.displayName || member.username,
                            )
                          }
                          disabled={removingIds.has(member.id)}
                        >
                          {removingIds.has(member.id)
                            ? 'Removing...'
                            : isSelf
                              ? 'Leave'
                              : 'Remove'}
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </tbody>
          </Table>
        )}
      </Card>

      {/* Invite Modal */}
      <Modal
        open={inviteOpen}
        onClose={() => {
          setInviteOpen(false);
          setInviteUserId('');
          setInviteRole('member');
        }}
        title="Invite Member"
      >
        <form onSubmit={handleInvite} className="flex flex-col gap-4">
          <div>
            <label className="block text-sm text-zinc-400 mb-1.5">
              User ID
            </label>
            <Input
              placeholder="Paste the user's ID"
              value={inviteUserId}
              onChange={(e) => setInviteUserId(e.target.value)}
              disabled={inviting}
            />
            <p className="text-xs text-zinc-500 mt-1.5">
              The user must have signed in at least once. Find their ID in
              Settings.
            </p>
          </div>
          <div>
            <label className="block text-sm text-zinc-400 mb-1.5">Role</label>
            <select
              className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-sm text-zinc-300 focus:border-zinc-600 focus:ring-1 focus:ring-zinc-600 focus:outline-none"
              value={inviteRole}
              onChange={(e) =>
                setInviteRole(e.target.value as Exclude<OrgRole, 'owner'>)
              }
              disabled={inviting}
            >
              <option value="admin">
                Admin — full access except ownership
              </option>
              <option value="member">
                Member — can create and manage resources
              </option>
              <option value="viewer">Viewer — read-only access</option>
            </select>
          </div>
          <div className="flex justify-end gap-2 pt-2">
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
              variant="primary"
              icon={<UserPlus className="w-3.5 h-3.5" />}
              disabled={inviting || !inviteUserId.trim()}
            >
              {inviting ? 'Inviting...' : 'Invite'}
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
