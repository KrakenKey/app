import React, { useState, useEffect } from 'react';
import {
  Settings as SettingsIcon,
  Globe,
  Shield,
  Key,
  AlertTriangle,
  Bell,
} from 'lucide-react';
import { useAuth } from '../hooks/useAuth';
import api from '../services/api';
import { toast } from '../utils/toast';
import type { UserProfile, NotificationPreferences } from '@krakenkey/shared';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Input } from '../components/ui/Input';
import { PageHeader } from '../components/ui/PageHeader';

const NOTIFICATION_OPTIONS = [
  {
    type: 'cert_issued' as const,
    label: 'Certificate Issued',
    description: 'When a new certificate is successfully issued',
  },
  {
    type: 'cert_renewed' as const,
    label: 'Certificate Renewed',
    description: 'When a certificate is automatically renewed',
  },
  {
    type: 'cert_failed' as const,
    label: 'Certificate Failed',
    description: 'When certificate issuance or renewal fails',
  },
  {
    type: 'cert_expiry_warning' as const,
    label: 'Expiry Warning',
    description: 'When a certificate is expiring within 30 days',
  },
  {
    type: 'cert_revoked' as const,
    label: 'Certificate Revoked',
    description: 'When a certificate is revoked',
  },
  {
    type: 'domain_verification_failed' as const,
    label: 'Domain Verification Failed',
    description: 'When a domain loses its DNS verification',
  },
];

const Settings: React.FC = () => {
  const { user, deleteAccount } = useAuth();
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
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

  const handleUpdateDisplayName = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      const response = await api.patch<UserProfile>('/auth/profile', {
        displayName: displayName.trim() || undefined,
      });
      setProfile(response.data);
      toast.success('Display name updated');
    } catch {
      toast.error('Failed to update display name');
    } finally {
      setSaving(false);
    }
  };

  const handleToggleNotification = async (type: string) => {
    if (!profile) return;
    const current =
      profile.notificationPreferences?.[
        type as keyof NotificationPreferences
      ] !== false;
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

  if (loading) {
    return (
      <div>
        <PageHeader
          title="Account Settings"
          icon={<SettingsIcon className="w-6 h-6" />}
        />
        <p className="text-zinc-400">Loading...</p>
      </div>
    );
  }

  if (!profile || !user) {
    return (
      <div>
        <PageHeader
          title="Account Settings"
          icon={<SettingsIcon className="w-6 h-6" />}
        />
        <p className="text-zinc-400">Unable to load profile.</p>
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        title="Account Settings"
        icon={<SettingsIcon className="w-6 h-6" />}
      />

      {/* Profile Info */}
      <Card className="mb-6">
        <h2 className="text-sm font-medium text-zinc-400 mb-4">Profile</h2>
        <div className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-3 text-sm">
          <span className="text-zinc-500">Username</span>
          <span className="text-zinc-200">{profile.username}</span>

          <span className="text-zinc-500">Email</span>
          <span className="text-zinc-200">{profile.email}</span>

          <span className="text-zinc-500">Groups</span>
          <span className="text-zinc-200">
            {profile.groups.length > 0 ? profile.groups.join(', ') : 'None'}
          </span>

          <span className="text-zinc-500">Member Since</span>
          <span className="text-zinc-200">
            {new Date(profile.createdAt).toLocaleDateString()}
          </span>
        </div>
      </Card>

      {/* Display Name */}
      <Card className="mb-6">
        <h2 className="text-sm font-medium text-zinc-400 mb-4">Display Name</h2>
        <form
          onSubmit={handleUpdateDisplayName}
          className="flex flex-col sm:flex-row gap-3"
        >
          <Input
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            placeholder="Enter display name"
            maxLength={100}
            className="flex-1"
          />
          <Button type="submit" variant="secondary" size="sm" disabled={saving}>
            {saving ? 'Saving...' : 'Save'}
          </Button>
        </form>
      </Card>

      {/* Notification Preferences */}
      <Card className="mb-6">
        <h2 className="text-sm font-medium text-zinc-400 mb-4 flex items-center gap-2">
          <Bell className="w-4 h-4" />
          Email Notifications
        </h2>
        <p className="text-xs text-zinc-500 mb-4">
          Choose which email notifications you would like to receive.
        </p>
        <div className="space-y-3">
          {NOTIFICATION_OPTIONS.map(({ type, label, description }) => {
            const enabled =
              profile.notificationPreferences?.[
                type as keyof NotificationPreferences
              ] !== false;
            return (
              <label
                key={type}
                className="flex items-center justify-between p-3 bg-zinc-950 rounded-lg cursor-pointer hover:bg-zinc-900 transition-colors"
              >
                <div>
                  <span className="text-sm text-zinc-200">{label}</span>
                  <p className="text-xs text-zinc-500 mt-0.5">{description}</p>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={enabled}
                  disabled={savingNotifications}
                  onClick={() => handleToggleNotification(type)}
                  className={`relative inline-flex h-5 w-9 shrink-0 rounded-full transition-colors duration-200 ${
                    enabled ? 'bg-cyan-600' : 'bg-zinc-700'
                  } ${savingNotifications ? 'opacity-50' : ''}`}
                >
                  <span
                    className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow-sm transition-transform duration-200 mt-0.5 ${
                      enabled ? 'translate-x-4 ml-0.5' : 'translate-x-0 ml-0.5'
                    }`}
                  />
                </button>
              </label>
            );
          })}
        </div>
      </Card>

      {/* Resource Summary */}
      <Card className="mb-6">
        <h2 className="text-sm font-medium text-zinc-400 mb-4">Resources</h2>
        <div className="grid grid-cols-3 gap-4">
          {[
            {
              count: profile.resourceCounts.domains,
              label: 'Domains',
              icon: Globe,
              color: 'text-cyan-400',
            },
            {
              count: profile.resourceCounts.certificates,
              label: 'Certificates',
              icon: Shield,
              color: 'text-emerald-400',
            },
            {
              count: profile.resourceCounts.apiKeys,
              label: 'API Keys',
              icon: Key,
              color: 'text-amber-400',
            },
          ].map(({ count, label, icon: Icon, color }) => (
            <div key={label} className="bg-zinc-950 rounded-lg p-4 text-center">
              <Icon className={`w-4 h-4 ${color} mx-auto mb-2`} />
              <span className="block text-2xl font-bold text-zinc-100">
                {count}
              </span>
              <span className="text-xs text-zinc-500">{label}</span>
            </div>
          ))}
        </div>
      </Card>

      {/* Danger Zone */}
      <Card className="border-red-500/20">
        <h2 className="text-sm font-medium text-red-400 mb-3 flex items-center gap-2">
          <AlertTriangle className="w-4 h-4" />
          Danger Zone
        </h2>
        <p className="text-sm text-zinc-400 mb-4">
          Deleting your account is permanent. All certificates will be revoked,
          and all domains, API keys, and associated data will be removed.
        </p>
        {!showDeleteConfirm ? (
          <Button variant="danger" onClick={() => setShowDeleteConfirm(true)}>
            Delete Account
          </Button>
        ) : (
          <div className="space-y-3">
            <p className="text-sm text-zinc-300">
              To confirm, type your username{' '}
              <strong className="text-zinc-100">{user.username}</strong> below:
            </p>
            <Input
              value={deleteConfirmText}
              onChange={(e) => setDeleteConfirmText(e.target.value)}
              placeholder={user.username}
              autoFocus
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
  );
};

export default Settings;
