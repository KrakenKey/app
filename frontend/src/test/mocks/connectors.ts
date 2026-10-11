import type {
  Connector,
  ConnectorConfigSummary,
  ConnectorDeployment,
} from '@krakenkey/shared';

const HOUR = 60 * 60 * 1000;
const ago = (ms: number) => new Date(Date.now() - ms).toISOString();

export const ACTIVE_ID = '3f1c2b9e-1111-4111-8111-111111111111';
export const WAITING_ID = '3f1c2b9e-2222-4222-8222-222222222222';
export const STALE_ID = '3f1c2b9e-3333-4333-8333-333333333333';
export const REVOKED_ID = '3f1c2b9e-4444-4444-8444-444444444444';

export const mockDeployments: ConnectorDeployment[] = [
  {
    connectorId: ACTIVE_ID,
    connectorName: 'web-01',
    certificateId: 1,
    label: 'haproxy',
    state: 'failed',
    serial: null,
    error: 'reload_failed',
    updatedAt: ago(2 * HOUR),
    reportedAt: ago(HOUR),
  },
  {
    connectorId: ACTIVE_ID,
    connectorName: 'web-01',
    certificateId: 1,
    label: 'nginx-main',
    state: 'verified',
    serial: '04abcdef0123456789',
    error: null,
    updatedAt: ago(3 * HOUR),
    reportedAt: ago(HOUR),
  },
];

export const activeConnector: Connector = {
  id: ACTIVE_ID,
  name: 'web-01',
  clientLabel: 'Acme Corp',
  scopes: ['certs:read', 'certs:renew'],
  allowedCertIds: [1],
  allowedDomainIds: ['domain-1'],
  enrolledAt: ago(48 * HOUR),
  enrollmentTokenExpiresAt: null,
  revokedAt: null,
  lastSeenAt: ago(5 * 60 * 1000),
  version: '0.3.0',
  os: 'linux',
  arch: 'amd64',
  createdAt: ago(49 * HOUR),
  deploymentSummary: { certificates: 1, targets: 2, failing: 1 },
};

export const waitingConnector: Connector = {
  ...activeConnector,
  id: WAITING_ID,
  name: 'db-02',
  clientLabel: null,
  scopes: ['certs:read'],
  allowedDomainIds: null,
  enrolledAt: null,
  enrollmentTokenExpiresAt: new Date(Date.now() + 23 * HOUR).toISOString(),
  lastSeenAt: null,
  version: null,
  os: null,
  arch: null,
  createdAt: ago(HOUR),
  deploymentSummary: { certificates: 0, targets: 0, failing: 0 },
};

export const staleConnector: Connector = {
  ...activeConnector,
  id: STALE_ID,
  name: 'edge-03',
  clientLabel: 'Globex',
  lastSeenAt: ago(30 * HOUR),
  deploymentSummary: { certificates: 3, targets: 4, failing: 0 },
};

export const revokedConnector: Connector = {
  ...activeConnector,
  id: REVOKED_ID,
  name: 'old-04',
  clientLabel: null,
  lastSeenAt: ago(50 * HOUR),
  revokedAt: ago(HOUR),
  deploymentSummary: { certificates: 0, targets: 0, failing: 0 },
};

export const EXPIRED_ID = '3f1c2b9e-6666-4666-8666-666666666666';

export const expiredConnector: Connector = {
  ...waitingConnector,
  id: EXPIRED_ID,
  name: 'mail-05',
  enrollmentTokenExpiresAt: ago(2 * HOUR),
};

export const CONFIG_HASH =
  '3b4c5d6e7f8091a2b3c4d5e6f708192a3b4c5d6e7f8091a2b3c4d5e6f708192a';

/** Certificate 1 is allowed; certificate 2 is not (see activeConnector). */
export const mockConfigSummary: ConnectorConfigSummary = {
  hash: CONFIG_HASH,
  version: '0.3.0',
  checkIntervalSeconds: 3600,
  plugins: [
    { name: 'azure-keyvault', version: '0.3.0', source: 'bundled' },
    { name: 'file', version: null, source: 'builtin' },
  ],
  certificates: [
    {
      certificateId: 1,
      names: ['example.com', 'www.example.com'],
      keyStore: {
        plugin: 'azure-keyvault',
        keyType: 'ecdsa-p256',
        settings: { vault: 'kv-prod', certificate_name: 'www' },
      },
      targets: [
        {
          label: 'azure-keyvault',
          plugin: 'azure-keyvault',
          implicit: true,
          runsCommand: false,
          verify: null,
          settings: { vault: 'kv-prod', certificate_name: 'www' },
        },
        {
          label: 'nginx-main',
          plugin: 'file',
          implicit: false,
          runsCommand: true,
          verify: {
            host: 'www.example.com',
            port: 443,
            skipChainValidation: false,
          },
          settings: { dir: '/etc/nginx/certs', fullchain: 'site.pem' },
        },
        {
          label: 'haproxy',
          plugin: 'file',
          implicit: false,
          runsCommand: false,
          verify: { host: null, port: 8443, skipChainValidation: true },
          settings: { dir: '/etc/haproxy/certs' },
        },
      ],
    },
    {
      certificateId: 2,
      names: ['pending.com'],
      keyStore: { plugin: 'local', keyType: null, settings: {} },
      targets: [],
    },
  ],
  truncated: false,
};
