/**
 * External accounts users can sign in with, mapped to the Authentik objects
 * that handle them. These are defined in the Authentik blueprints, so the
 * slugs are fixed:
 *
 * - `loginFlow`: an authentication flow whose only option is this source, so
 *   Authentik goes straight to the provider. Users who already have an
 *   Authentik session skip it and continue to `next`.
 * - `sourceSlug`: the Authentik source. Starting it while signed in links the
 *   external account to the signed-in user.
 */
export const LOGIN_SOURCE_CONFIG = {
  microsoft: {
    loginFlow: 'krakenkey-microsoft-login',
    sourceSlug: 'microsoft',
  },
} as const;

export type LoginSource = keyof typeof LOGIN_SOURCE_CONFIG;

export const LOGIN_SOURCES = Object.keys(LOGIN_SOURCE_CONFIG) as LoginSource[];

/**
 * Password login flow. Connecting an account goes through it first, so the
 * user proves they own the KrakenKey account before anything is linked.
 */
export const AUTHENTIK_LOGIN_FLOW = 'krakenkey-authentication';
