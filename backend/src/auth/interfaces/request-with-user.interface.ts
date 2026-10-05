import type { OrgRole } from '@krakenkey/shared';
import type { ApiKeyContext } from '../api-key-restrictions';

export interface RequestWithUser extends Request {
  user: {
    userId: string;
    username?: string;
    email?: string;
    groups?: string[];
    role?: OrgRole | null;
    organizationId?: string | null;
    /** Set only when the request authenticated with a user API key. */
    apiKeyId?: string;
    apiKey?: ApiKeyContext;
  };
}
