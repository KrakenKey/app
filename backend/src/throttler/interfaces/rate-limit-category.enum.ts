export enum RateLimitCategory {
  PUBLIC = 'public',
  /**
   * Unauthenticated credential exchanges (connector enrollment, key
   * exchange and key rotation): tracked by IP like PUBLIC, with a lower
   * limit.
   */
  PUBLIC_STRICT = 'public-strict',
  /**
   * POST /connectors/token: unauthenticated like PUBLIC_STRICT, but a site
   * with many connectors behind one address needs more room.
   */
  CONNECTOR_TOKEN = 'connector-token',
  /** POST /connectors/report: counted per connector, not per owner. */
  CONNECTOR_REPORT = 'connector-report',
  AUTHENTICATED_READ = 'read',
  AUTHENTICATED_WRITE = 'write',
  EXPENSIVE = 'expensive',
  /**
   * POST /certs/tls/:id/renew. Its own allowance, so routine renewals of a
   * large account (often from daily timers) fit, without raising the limit
   * on new issuance.
   */
  RENEWAL = 'renewal',
}

/** Categories limited per client IP at the default tier, whatever the token. */
export function isPublicCategory(category: RateLimitCategory): boolean {
  return (
    category === RateLimitCategory.PUBLIC ||
    category === RateLimitCategory.PUBLIC_STRICT ||
    category === RateLimitCategory.CONNECTOR_TOKEN
  );
}
