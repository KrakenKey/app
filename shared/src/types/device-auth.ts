/** POST /auth/device/code: starts a CLI browser login. */
export interface DeviceCodeResponse {
  deviceCode: string;
  /** Short code the user confirms in the dashboard, e.g. "BCDF-GHJK". */
  userCode: string;
  verificationUri: string;
  verificationUriComplete: string;
  /** Seconds until the request expires. */
  expiresIn: number;
  /** Minimum seconds between token polls. */
  interval: number;
}

/** POST /auth/device/token: polled by the CLI. */
export type DeviceTokenResponse =
  | { status: 'pending' | 'slow_down' | 'denied' | 'expired' }
  | { status: 'approved'; apiKey: string; id: string; name: string };

/** GET /auth/device/:userCode: shown on the approval page. */
export interface DeviceAuthRequestInfo {
  userCode: string;
  clientName: string;
  ip: string;
  createdAt: string;
}
