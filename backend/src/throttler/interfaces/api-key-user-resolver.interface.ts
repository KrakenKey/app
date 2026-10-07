/**
 * Maps a user API key (`kk_...`) to the ID of the user who owns it, so the
 * throttler can track API key requests by user and apply the account's tier.
 *
 * Returns null for anything that would not authenticate (unknown, revoked or
 * expired keys, keys used from outside their IP allowlist). Implementations
 * must never log or persist the raw key.
 */
export interface ApiKeyUserResolver {
  resolve(rawKey: string, ip: string): Promise<string | null>;
}

export const API_KEY_USER_RESOLVER = Symbol('API_KEY_USER_RESOLVER');
