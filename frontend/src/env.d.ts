export {};

declare global {
  interface Window {
    __env__?: {
      KK_API_URL?: string;
      KK_ACME_AUTH_ZONE_DOMAIN?: string;
      /** "true" when the Microsoft sign-in source is set up */
      KK_MICROSOFT_LOGIN_ENABLED?: string;
    };
  }
}
