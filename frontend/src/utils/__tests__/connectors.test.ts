import type { ConnectorDeployment } from '@krakenkey/shared';
import {
  configDrift,
  connectorStatus,
  formatCheck,
  formatInterval,
  settingPairs,
  dockerCommands,
  enrollCommand,
  enrollmentTokenExpired,
  formatRelative,
  groupByConnector,
  isFailedState,
} from '../connectors';

const NOW = Date.parse('2026-10-10T12:00:00Z');
const hoursAgo = (h: number) => new Date(NOW - h * 3600_000).toISOString();

describe('connectorStatus', () => {
  const base = {
    revokedAt: null,
    enrolledAt: null,
    lastSeenAt: null,
    enrollmentTokenExpiresAt: null,
  };

  it('is waiting until the connector enrolls', () => {
    expect(connectorStatus(base, NOW)).toBe('waiting');
    expect(
      connectorStatus({ ...base, enrollmentTokenExpiresAt: hoursAgo(-1) }, NOW),
    ).toBe('waiting');
  });

  it('shows an expired token until the connector enrolls', () => {
    const expired = { ...base, enrollmentTokenExpiresAt: hoursAgo(1) };
    expect(connectorStatus(expired, NOW)).toBe('expired');
    expect(enrollmentTokenExpired(expired, NOW)).toBe(true);
    expect(connectorStatus({ ...expired, revokedAt: hoursAgo(0.5) }, NOW)).toBe(
      'revoked',
    );
    expect(
      enrollmentTokenExpired({ ...expired, enrolledAt: hoursAgo(0.5) }, NOW),
    ).toBe(false);
  });

  it('is active when seen in the last 24 hours', () => {
    expect(
      connectorStatus(
        { ...base, enrolledAt: hoursAgo(100), lastSeenAt: hoursAgo(23.9) },
        NOW,
      ),
    ).toBe('active');
  });

  it('is stale when not seen for more than 24 hours', () => {
    expect(
      connectorStatus(
        { ...base, enrolledAt: hoursAgo(100), lastSeenAt: hoursAgo(24.1) },
        NOW,
      ),
    ).toBe('stale');
  });

  it('falls back to the enrollment time without lastSeenAt', () => {
    expect(connectorStatus({ ...base, enrolledAt: hoursAgo(1) }, NOW)).toBe(
      'active',
    );
  });

  it('is revoked whatever else is set', () => {
    expect(
      connectorStatus(
        {
          revokedAt: hoursAgo(1),
          enrolledAt: hoursAgo(5),
          lastSeenAt: hoursAgo(1),
          enrollmentTokenExpiresAt: null,
        },
        NOW,
      ),
    ).toBe('revoked');
  });
});

describe('formatRelative', () => {
  it.each([
    [hoursAgo(0), 'just now'],
    [new Date(NOW - 59_000).toISOString(), 'just now'],
    [new Date(NOW - 60_000).toISOString(), '1 minute ago'],
    [new Date(NOW - 5 * 60_000).toISOString(), '5 minutes ago'],
    [hoursAgo(1), '1 hour ago'],
    [hoursAgo(23), '23 hours ago'],
    [hoursAgo(24), '1 day ago'],
    [hoursAgo(72), '3 days ago'],
  ])('formats %s as %s', (iso, expected) => {
    expect(formatRelative(iso, NOW)).toBe(expected);
  });
});

describe('isFailedState', () => {
  it('treats failed and rolled_back as failing', () => {
    expect(isFailedState('failed')).toBe(true);
    expect(isFailedState('rolled_back')).toBe(true);
    expect(isFailedState('verified')).toBe(false);
    expect(isFailedState('activated_unverifiable')).toBe(false);
  });
});

describe('groupByConnector', () => {
  const d = (connectorId: string, label: string): ConnectorDeployment => ({
    connectorId,
    connectorName: `name-${connectorId}`,
    certificateId: 1,
    label,
    state: 'verified',
    serial: null,
    error: null,
    updatedAt: hoursAgo(1),
    reportedAt: hoursAgo(1),
  });

  it('groups targets under their connector, keeping order', () => {
    const groups = groupByConnector([d('a', 'x'), d('b', 'y'), d('a', 'z')]);
    expect(groups.map((g) => g.connectorName)).toEqual(['name-a', 'name-b']);
    expect(groups[0].targets.map((t) => t.label)).toEqual(['x', 'z']);
  });
});

describe('setup instructions', () => {
  it('enrolls as the service user with the token file and the config', () => {
    const text = enrollCommand();
    expect(text).toContain(
      'sudo -u krakenkey-connector env KK_ENROLLMENT_TOKEN_FILE=/etc/krakenkey-connector/enrollment-token \\\n  krakenkey-connector enroll --config /etc/krakenkey-connector/config.yaml',
    );
    // readable by the service user's group, never by others
    expect(text).toContain(
      'install -m 0640 -g krakenkey-connector /dev/null /etc/krakenkey-connector/enrollment-token',
    );
  });

  it('gives the token file to the image user before enrolling in Docker', () => {
    const text = dockerCommands();
    const install = text.indexOf(
      'install -m 0600 -o 10001 /dev/null /etc/krakenkey-connector/enrollment-token',
    );
    expect(install).toBeGreaterThan(-1);
    expect(install).toBeLessThan(text.indexOf('docker run --rm'));
  });

  it('mounts the same data volume to enroll and run in Docker', () => {
    const text = dockerCommands();
    expect(text).toContain(
      'ghcr.io/krakenkey/connector:v${VERSION} enroll --config /etc/krakenkey-connector/config.yaml',
    );
    expect(text.startsWith('VERSION=')).toBe(true);
    expect(text).not.toContain('connector:latest');
    expect(
      text.match(/krakenkey-connector-data:\/var\/lib\/krakenkey-connector/g),
    ).toHaveLength(2);
  });
});

describe('formatInterval', () => {
  it('uses the largest whole unit', () => {
    expect(formatInterval(1)).toBe('1 second');
    expect(formatInterval(90)).toBe('90 seconds');
    expect(formatInterval(60)).toBe('1 minute');
    expect(formatInterval(1800)).toBe('30 minutes');
    expect(formatInterval(3600)).toBe('1 hour');
    expect(formatInterval(5400)).toBe('1 hour 30 minutes');
    expect(formatInterval(86400)).toBe('1 day');
    expect(formatInterval(604800)).toBe('7 days');
  });
});

describe('formatCheck', () => {
  const v = (host: string | null, port: number | null) => ({
    host,
    port,
    skipChainValidation: false,
  });
  it('shows what is set', () => {
    expect(formatCheck(v('www.example.com', 443))).toBe('www.example.com:443');
    expect(formatCheck(v('::1', 8443))).toBe('[::1]:8443');
    expect(formatCheck(v('www.example.com', null))).toBe('www.example.com');
    expect(formatCheck(v(null, 8443))).toBe('port 8443');
    expect(formatCheck(v(null, null))).toBe('Default host and port');
  });
});

describe('settingPairs', () => {
  it('formats key: value pairs in order', () => {
    expect(settingPairs({ vault: 'kv', exportable: false, port: 443 })).toEqual(
      ['vault: kv', 'exportable: false', 'port: 443'],
    );
    expect(settingPairs({})).toEqual([]);
  });
});

describe('configDrift', () => {
  const summary = (...ids: number[]) => ({
    certificates: ids.map((certificateId) => ({
      certificateId,
      names: [],
      keyStore: { plugin: 'local', keyType: null, settings: {} },
      targets: [],
    })),
  });
  it('compares the config with allowedCertIds', () => {
    expect(configDrift(summary(1, 2, 4), [1, 3])).toEqual({
      notAllowed: [2, 4],
      missing: [3],
    });
    expect(configDrift(summary(1), [1])).toEqual({
      notAllowed: [],
      missing: [],
    });
    expect(configDrift(summary(), [5])).toEqual({
      notAllowed: [],
      missing: [5],
    });
  });
  it('has nothing to compare with a domain restriction alone', () => {
    expect(configDrift(summary(1, 2), null)).toEqual({
      notAllowed: [],
      missing: [],
    });
  });
});
