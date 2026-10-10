export enum RateLimitCategory {
  PUBLIC = 'public',
  /**
   * Unauthenticated credential exchanges (connector enrollment, key
   * exchange and key rotation): tracked by IP like PUBLIC, with a lower
   * limit.
   */
  PUBLIC_STRICT = 'public-strict',
  AUTHENTICATED_READ = 'read',
  AUTHENTICATED_WRITE = 'write',
  EXPENSIVE = 'expensive',
}

/** Categories limited per client IP at the default tier, whatever the token. */
export function isPublicCategory(category: RateLimitCategory): boolean {
  return (
    category === RateLimitCategory.PUBLIC ||
    category === RateLimitCategory.PUBLIC_STRICT
  );
}
