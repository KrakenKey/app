export interface User {
  id: string;
  username: string;
  email: string;
  groups: string[];
  displayName?: string | null;
  notificationPreferences?: NotificationPreferences;
  createdAt?: string;
}

export interface UserProfile extends User {
  createdAt: string;
  resourceCounts: {
    domains: number;
    certificates: number;
    apiKeys: number;
  };
}

export enum NotificationType {
  CERT_ISSUED = 'cert_issued',
  CERT_RENEWED = 'cert_renewed',
  CERT_FAILED = 'cert_failed',
  CERT_EXPIRY_WARNING = 'cert_expiry_warning',
  CERT_REVOKED = 'cert_revoked',
  DOMAIN_VERIFICATION_FAILED = 'domain_verification_failed',
}

export type NotificationPreferences = Partial<
  Record<NotificationType, boolean>
>;

export interface UpdateProfileRequest {
  displayName?: string;
  notificationPreferences?: NotificationPreferences;
}
