import type { OrgRole } from '@krakenkey/shared';

export interface RequestWithUser extends Request {
  user: {
    userId: string;
    username?: string;
    email?: string;
    groups?: string[];
    role?: OrgRole | null;
    organizationId?: string | null;
  };
}
