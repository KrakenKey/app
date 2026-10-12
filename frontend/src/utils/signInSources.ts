/**
 * True when this deployment offers Microsoft sign-in. Set at runtime
 * (KK_MICROSOFT_LOGIN_ENABLED) once the identity provider is configured, so
 * the buttons never point at a sign-in option that doesn't work yet.
 */
export function isMicrosoftSignInEnabled(): boolean {
  return window.__env__?.KK_MICROSOFT_LOGIN_ENABLED === 'true';
}
