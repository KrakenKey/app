import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import api from '../services/api';
import { toast } from '../utils/toast';
import type { UserProfile } from '@krakenkey/shared';
import './Settings.css';

const Settings: React.FC = () => {
  const { user, deleteAccount } = useAuth();
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [displayName, setDisplayName] = useState('');
  const [saving, setSaving] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleteConfirmText, setDeleteConfirmText] = useState('');
  const [deleting, setDeleting] = useState(false);

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
      <div className="settings-page">
        <p>Loading...</p>
      </div>
    );
  }

  if (!profile || !user) {
    return (
      <div className="settings-page">
        <p>Unable to load profile.</p>
      </div>
    );
  }

  return (
    <div className="settings-page">
      <Link to="/dashboard" className="settings-back">
        &larr; Back to Dashboard
      </Link>
      <h1>Account Settings</h1>

      {/* Profile Info */}
      <div className="settings-section">
        <h2>Profile</h2>
        <div className="profile-grid">
          <span className="profile-label">Username</span>
          <span className="profile-value">{profile.username}</span>

          <span className="profile-label">Email</span>
          <span className="profile-value">{profile.email}</span>

          <span className="profile-label">Groups</span>
          <span className="profile-value">
            {profile.groups.length > 0 ? profile.groups.join(', ') : 'None'}
          </span>

          <span className="profile-label">Member Since</span>
          <span className="profile-value">
            {new Date(profile.createdAt).toLocaleDateString()}
          </span>
        </div>
      </div>

      {/* Display Name */}
      <div className="settings-section">
        <h2>Display Name</h2>
        <form className="display-name-form" onSubmit={handleUpdateDisplayName}>
          <div className="form-group">
            <label htmlFor="displayName">
              Choose a display name (visible to others)
            </label>
            <input
              id="displayName"
              type="text"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder="Enter display name"
              maxLength={100}
            />
          </div>
          <button
            type="submit"
            className="btn-secondary btn-small"
            disabled={saving}
          >
            {saving ? 'Saving...' : 'Save'}
          </button>
        </form>
      </div>

      {/* Resource Summary */}
      <div className="settings-section">
        <h2>Resources</h2>
        <div className="resource-counts">
          <div className="resource-card">
            <span className="count">{profile.resourceCounts.domains}</span>
            <span className="resource-label">Domains</span>
          </div>
          <div className="resource-card">
            <span className="count">{profile.resourceCounts.certificates}</span>
            <span className="resource-label">Certificates</span>
          </div>
          <div className="resource-card">
            <span className="count">{profile.resourceCounts.apiKeys}</span>
            <span className="resource-label">API Keys</span>
          </div>
        </div>
      </div>

      {/* Danger Zone */}
      <div className="settings-section danger-zone">
        <h2>Danger Zone</h2>
        <p>
          Deleting your account is permanent. All certificates will be revoked,
          and all domains, API keys, and associated data will be removed.
        </p>
        {!showDeleteConfirm ? (
          <button
            className="btn-danger"
            onClick={() => setShowDeleteConfirm(true)}
          >
            Delete Account
          </button>
        ) : (
          <div className="delete-confirm">
            <p>
              To confirm, type your username <strong>{user.username}</strong>{' '}
              below:
            </p>
            <input
              type="text"
              value={deleteConfirmText}
              onChange={(e) => setDeleteConfirmText(e.target.value)}
              placeholder={user.username}
              autoFocus
            />
            <div className="delete-confirm-actions">
              <button
                className="btn-small"
                onClick={() => {
                  setShowDeleteConfirm(false);
                  setDeleteConfirmText('');
                }}
                disabled={deleting}
              >
                Cancel
              </button>
              <button
                className="btn-danger btn-small"
                onClick={handleDeleteAccount}
                disabled={deleteConfirmText !== user.username || deleting}
              >
                {deleting ? 'Deleting...' : 'Permanently Delete Account'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default Settings;
