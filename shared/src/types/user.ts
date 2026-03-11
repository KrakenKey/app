export type OrgRole = 'owner' | 'admin' | 'member' | 'viewer';

export interface User {
  id: string;
  username: string;
  email: string;
  groups: string[];
  displayName?: string | null;
  notificationPreferences?: NotificationPreferences;
  plan?: string;
  createdAt?: string;
  role?: OrgRole | null;
  organizationId?: string | null;
}

export interface UserProfile extends User {
  createdAt: string;
  plan?: string;
  autoRenewalConfirmedAt?: string | null;
  resourceCounts: {
    domains: number;
    certificates: number;
    apiKeys: number;
  };
}

export const NotificationType = {
  CERT_ISSUED: 'cert_issued',
  CERT_RENEWED: 'cert_renewed',
  CERT_FAILED: 'cert_failed',
  CERT_EXPIRY_WARNING: 'cert_expiry_warning',
  CERT_REVOKED: 'cert_revoked',
  DOMAIN_VERIFICATION_FAILED: 'domain_verification_failed',
  PLAN_LIMIT_REACHED: 'plan_limit_reached',
  AUTO_RENEWAL_PAUSED: 'auto_renewal_paused',
} as const;

export type NotificationType =
  (typeof NotificationType)[keyof typeof NotificationType];

export type NotificationPreferences = Partial<
  Record<NotificationType, boolean>
>;

export interface UpdateProfileRequest {
  displayName?: string;
  notificationPreferences?: NotificationPreferences;
}
