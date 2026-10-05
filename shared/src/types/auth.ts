export interface AuthCallbackResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
  refresh_token?: string;
  id_token?: string;
  scope?: string;
}

/** GET /auth/logout-url: where to send the browser to end the SSO session. */
export interface LogoutUrlResponse {
  /** Authentik end-session endpoint for the KrakenKey provider. */
  url: string;
  /** App origin Authentik returns to after logout. */
  postLogoutRedirectUri: string;
}
