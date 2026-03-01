export {};

declare global {
  interface Window {
    __env__?: {
      KK_API_URL?: string;
      KK_ACME_AUTH_ZONE_DOMAIN?: string;
    };
  }
}
