import React, { useState, useEffect } from 'react';
import { Settings as SettingsIcon, AlertTriangle, Pencil } from 'lucide-react';
import { useAuth } from '../hooks/useAuth';
import api from '../services/api';
import { toast } from '../utils/toast';
import type {
  UserProfile,
  NotificationPreferences,
  NotificationType,
} from '@krakenkey/shared';
import { Card, CardHeader } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Input } from '../components/ui/Input';
import { PageHeader } from '../components/ui/PageHeader';
import { Switch } from '../components/ui/Switch';
import AlertChannels from '../components/AlertChannels';

interface NotificationOption {
  type: NotificationType;
  label: string;
  description: string;
}

/** Email notifications a user can turn off, grouped by what they are about. */
const NOTIFICATION_GROUPS: { topic: string; options: NotificationOption[] }[] =
  [
    {
      topic: 'Certificates',
      options: [
        {
          type: 'cert_issued',
          label: 'Certificate issued',
          description: 'A new certificate is issued',
        },
        {
          type: 'cert_renewed',
          label: 'Certificate renewed',
          description: 'A certificate is renewed automatically',
        },
        {
          type: 'cert_failed',
          label: 'Certificate failed',
          description: 'Issuance or renewal fails',
        },
        {
          type: 'cert_expiry_warning',
          label: 'Expiry warning',
          description: 'A certificate expires within 30 days',
        },
        {
          type: 'cert_revoked',
          label: 'Certificate revoked',
          description: 'A certificate is revoked',
        },
      ],
    },
    {
      topic: 'Domains',
      options: [
        {
          type: 'domain_verification_failed',
          label: 'Domain verification failed',
          description: 'A domain loses its DNS verification',
        },
      ],
    },
    {
      topic: 'Connectors',
      options: [
        {
          type: 'deploy_failed',
          label: 'Deployment failed',
          description:
            'A connector fails to install a certificate on a target, or rolls it back',
        },
        {
          type: 'connector_stale',
          label: 'Connector offline',
          description: 'A connector has not checked in for 24 hours',
        },
      ],
    },
  ];

const PAGE_DESCRIPTION =
  'Your profile, email notifications and alert channels.';

function ProfileRow({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="grid gap-1 px-5 py-3 sm:grid-cols-[160px_1fr] sm:items-center sm:gap-4">
      <dt className="text-sm text-text-muted">{label}</dt>
      <dd className="min-w-0 text-sm text-text break-words">{children}</dd>
    </div>
  );
}

const Settings: React.FC = () => {
  const { user, deleteAccount, refreshUser } = useAuth();
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [editingName, setEditingName] = useState(false);
  const [displayName, setDisplayName] = useState('');
  const [saving, setSaving] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleteConfirmText, setDeleteConfirmText] = useState('');
  const [deleting, setDeleting] = useState(false);
  const [savingNotifications, setSavingNotifications] = useState(false);

  useEffect(() => {
    fetchProfile();
  }, []);

  const fetchProfile = async () => {
    try {
      const response = await api.get<UserProfile>('/auth/profile');
      setProfile(response.data);
      setDisplayName(response.data.displayName || '');
    } catch {
      toast.error('Failed to load profile');
    } finally {
      setLoading(false);
    }
  };

  const cancelEditName = () => {
    setDisplayName(profile?.displayName || '');
    setEditingName(false);
  };

  const handleUpdateDisplayName = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      const response = await api.patch<UserProfile>('/auth/profile', {
        displayName: displayName.trim() || undefined,
      });
      setProfile(response.data);
      setDisplayName(response.data.displayName || '');
      setEditingName(false);
      toast.success('Display name updated');
      // The sidebar shows the name from the signed-in user.
      void refreshUser?.().catch(() => {});
    } catch {
      toast.error('Failed to update display name');
    } finally {
      setSaving(false);
    }
  };

  const handleToggleNotification = async (type: NotificationType) => {
    if (!profile) return;
    const current = profile.notificationPreferences?.[type] !== false;
    const updated: NotificationPreferences = { [type]: !current };

    setSavingNotifications(true);
    try {
      const response = await api.patch<UserProfile>('/auth/profile', {
        notificationPreferences: updated,
      });
      setProfile(response.data);
    } catch {
      toast.error('Failed to update notification preferences');
    } finally {
      setSavingNotifications(false);
    }
  };

  const handleDeleteAccount = async () => {
    if (deleteConfirmText !== user?.username) return;
    setDeleting(true);
    try {
      await deleteAccount();
    } catch {
      toast.error('Failed to delete account');
      setDeleting(false);
    }
  };

  const header = (
    <PageHeader
      title="Account Settings"
      description={PAGE_DESCRIPTION}
      icon={<SettingsIcon className="w-6 h-6" />}
    />
  );

  if (loading) {
    return (
      <div>
        {header}
        <p className="text-sm text-text-muted">Loading...</p>
      </div>
    );
  }

  if (!profile || !user) {
    return (
      <div>
        {header}
        <p className="text-sm text-text-muted">Unable to load profile.</p>
      </div>
    );
  }

  return (
    <div>
      {header}

      <div className="max-w-4xl space-y-6">
        {/* Profile */}
        <Card flush>
          <CardHeader title="Profile" />
          <dl className="divide-y divide-border-subtle">
            <ProfileRow label="Display name">
              {editingName ? (
                <form
                  onSubmit={handleUpdateDisplayName}
                  onKeyDown={(e) => {
                    if (e.key === 'Escape') cancelEditName();
                  }}
                  className="flex flex-col gap-2 sm:flex-row sm:items-center"
                  aria-label="Edit display name"
                >
                  <Input
                    value={displayName}
                    onChange={(e) => setDisplayName(e.target.value)}
                    placeholder="Enter display name"
                    aria-label="Display name"
                    maxLength={100}
                    autoFocus
                    className="w-full sm:w-72"
                  />
                  <div className="flex gap-2">
                    <Button
                      type="submit"
                      variant="primary"
                      size="sm"
                      disabled={saving}
                    >
                      {saving ? 'Saving...' : 'Save'}
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={cancelEditName}
                      disabled={saving}
                    >
                      Cancel
                    </Button>
                  </div>
                </form>
              ) : (
                <div className="flex items-center gap-2">
                  {profile.displayName ? (
                    <span>{profile.displayName}</span>
                  ) : (
                    <span className="text-text-muted">Not set</span>
                  )}
                  <Button
                    variant="ghost"
                    size="sm"
                    icon={<Pencil className="w-3.5 h-3.5" />}
                    onClick={() => setEditingName(true)}
                    aria-label="Edit display name"
                  >
                    Edit
                  </Button>
                </div>
              )}
            </ProfileRow>
            <ProfileRow label="Username">{profile.username}</ProfileRow>
            <ProfileRow label="Email">{profile.email}</ProfileRow>
            {profile.groups.length > 0 && (
              <ProfileRow label="Groups">
                {profile.groups.join(', ')}
              </ProfileRow>
            )}
            <ProfileRow label="Member since">
              <span title={new Date(profile.createdAt).toLocaleString()}>
                {new Date(profile.createdAt).toLocaleDateString(undefined, {
                  year: 'numeric',
                  month: 'long',
                  day: 'numeric',
                })}
              </span>
            </ProfileRow>
          </dl>
        </Card>

        {/* Email notifications */}
        <Card flush>
          <CardHeader
            title="Email notifications"
            description={`Sent to ${profile.email}.`}
          />
          {NOTIFICATION_GROUPS.map(({ topic, options }) => (
            <section
              key={topic}
              aria-labelledby={`notify-${topic}`}
              className="border-b border-border-subtle last:border-b-0"
            >
              <h3
                id={`notify-${topic}`}
                className="px-5 pt-3 pb-1 text-[11px] font-semibold uppercase tracking-[0.08em] text-text-faint"
              >
                {topic}
              </h3>
              <ul className="pb-1.5">
                {options.map(({ type, label, description }) => {
                  const enabled =
                    profile.notificationPreferences?.[type] !== false;
                  const id = `notify-${type}`;
                  return (
                    <li
                      key={type}
                      className="flex items-center justify-between gap-4 px-5 py-2 hover:bg-white/[0.02]"
                    >
                      <label htmlFor={id} className="min-w-0 cursor-pointer">
                        <span className="block text-sm text-text">{label}</span>
                        <span
                          id={`${id}-desc`}
                          className="block text-xs text-text-muted"
                        >
                          {description}
                        </span>
                      </label>
                      <Switch
                        id={id}
                        aria-describedby={`${id}-desc`}
                        checked={enabled}
                        disabled={savingNotifications}
                        onChange={() => handleToggleNotification(type)}
                      />
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
        </Card>

        <AlertChannels />

        {/* Danger zone */}
        <Card className="border-red-500/20 p-5">
          <h2 className="text-sm font-semibold text-red-300 mb-2 flex items-center gap-2">
            <AlertTriangle className="w-4 h-4" />
            Danger Zone
          </h2>
          <p className="text-sm text-text-muted mb-4">
            Deleting your account is permanent. All certificates will be
            revoked, and all domains, API keys, and associated data will be
            removed.
          </p>
          {!showDeleteConfirm ? (
            <Button variant="danger" onClick={() => setShowDeleteConfirm(true)}>
              Delete Account
            </Button>
          ) : (
            <div className="space-y-3">
              <p className="text-sm text-zinc-300">
                To confirm, type your username{' '}
                <strong className="text-zinc-100">{user.username}</strong>{' '}
                below:
              </p>
              <Input
                value={deleteConfirmText}
                onChange={(e) => setDeleteConfirmText(e.target.value)}
                placeholder={user.username}
                autoFocus
                className="sm:max-w-xs"
              />
              <div className="flex gap-2">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setShowDeleteConfirm(false);
                    setDeleteConfirmText('');
                  }}
                  disabled={deleting}
                >
                  Cancel
                </Button>
                <Button
                  variant="danger"
                  size="sm"
                  onClick={handleDeleteAccount}
                  disabled={deleteConfirmText !== user.username || deleting}
                >
                  {deleting ? 'Deleting...' : 'Permanently Delete Account'}
                </Button>
              </div>
            </div>
          )}
        </Card>
      </div>
    </div>
  );
};

export default Settings;
