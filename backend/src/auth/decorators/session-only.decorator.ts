import { SetMetadata } from '@nestjs/common';

export const SESSION_ONLY_KEY = 'sessionOnly';

/**
 * Rejects API keys on this route; only a dashboard (JWT) session passes.
 * For anything that would let a leaked key outlive its own revocation or
 * take the account over: managing keys, account identity and deletion, org
 * ownership and membership, billing.
 *
 * Enforced by JwtOrApiKeyGuard, so it only works on routes behind it.
 */
export const SessionOnly = () => SetMetadata(SESSION_ONLY_KEY, true);
