import { Link } from 'react-router-dom';
import { AlertTriangle, FileCog } from 'lucide-react';
import type {
  Connector,
  ConnectorConfigCertificate,
  ConnectorConfigSettings,
  ConnectorDeployment,
} from '@krakenkey/shared';
import {
  CONNECTOR_DOCS_URL,
  PLUGIN_SOURCE_LABEL,
  configDrift,
  formatCheck,
  formatInterval,
  settingPairs,
} from '../../utils/connectors';
import { Card } from '../ui/Card';
import { Badge } from '../ui/Badge';
import {
  Table,
  TableHeader,
  TableRow,
  TableHead,
  TableCell,
} from '../ui/Table';
import { DeploymentStateBadge } from './ConnectorBadges';
import { Field, When } from './DetailField';

const HEADING_ID = 'connector-config-heading';
const DASH = <span className="text-zinc-500">&mdash;</span>;

function DocsLink({ children }: { children: React.ReactNode }) {
  return (
    <a
      href={CONNECTOR_DOCS_URL}
      target="_blank"
      rel="noreferrer"
      className="text-cyan-400 hover:text-cyan-300 underline"
    >
      {children}
    </a>
  );
}

function Settings({ settings }: { settings: ConnectorConfigSettings }) {
  const pairs = settingPairs(settings);
  if (!pairs.length) return DASH;
  return (
    <ul className="space-y-0.5">
      {pairs.map((p) => (
        <li key={p} className="font-mono text-xs text-zinc-300 break-all">
          {p}
        </li>
      ))}
    </ul>
  );
}

function CertificateConfig({
  cert,
  certName,
  deployments,
}: {
  cert: ConnectorConfigCertificate;
  certName: (id: number) => string;
  deployments: Map<string, ConnectorDeployment>;
}) {
  const { keyStore } = cert;
  return (
    <li className="rounded-lg border border-zinc-800 p-4">
      <Link
        to="/dashboard/certificates"
        className="font-mono text-sm font-medium text-zinc-200 hover:text-cyan-400 transition-colors"
      >
        {certName(cert.certificateId)}
      </Link>
      <div className="mt-2 space-y-1.5 text-sm">
        <Field label="Names">
          {cert.names.length ? (
            <span className="font-mono text-xs break-all">
              {cert.names.join(', ')}
            </span>
          ) : (
            DASH
          )}
        </Field>
        <Field label="Key store">
          <span className="font-mono text-xs">{keyStore.plugin}</span>
          {keyStore.keyType && (
            <span className="text-zinc-500">
              {' '}
              (<span className="font-mono text-xs">{keyStore.keyType}</span>)
            </span>
          )}
        </Field>
        {settingPairs(keyStore.settings).length > 0 && (
          <div className="pl-4">
            <Settings settings={keyStore.settings} />
          </div>
        )}
      </div>

      <div className="mt-3">
        {cert.targets.length === 0 ? (
          <p className="text-sm text-zinc-500">No targets in the config.</p>
        ) : (
          <Table aria-label={`Targets for certificate #${cert.certificateId}`}>
            <TableHeader>
              <TableHead>Target</TableHead>
              <TableHead>Plugin</TableHead>
              <TableHead>Settings</TableHead>
              <TableHead>Check</TableHead>
              <TableHead>Last deployment</TableHead>
            </TableHeader>
            <tbody>
              {cert.targets.map((t, i) => {
                const deployed = deployments.get(
                  `${cert.certificateId}\n${t.label}`,
                );
                return (
                  <TableRow key={`${t.label}-${i}`}>
                    <TableCell>
                      <div className="font-mono text-xs text-zinc-200">
                        {t.label}
                      </div>
                      <div className="mt-1 flex flex-col items-start gap-1">
                        {t.implicit && (
                          <Badge variant="neutral" dot={false}>
                            Added automatically
                          </Badge>
                        )}
                        {t.runsCommand && (
                          <Badge variant="info" dot={false}>
                            Runs a command after deploy
                          </Badge>
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="font-mono text-xs">
                      {t.plugin}
                    </TableCell>
                    <TableCell>
                      <Settings settings={t.settings} />
                    </TableCell>
                    <TableCell>
                      {t.verify ? (
                        <div className="flex flex-col items-start gap-1">
                          <span className="font-mono text-xs">
                            {formatCheck(t.verify)}
                          </span>
                          {t.verify.skipChainValidation && (
                            <Badge variant="warning">
                              Chain validation skipped
                            </Badge>
                          )}
                        </div>
                      ) : (
                        <span className="text-xs text-zinc-500">No check</span>
                      )}
                    </TableCell>
                    <TableCell>
                      {deployed ? (
                        <DeploymentStateBadge state={deployed.state} />
                      ) : (
                        <span className="text-xs text-zinc-500">
                          Not reported
                        </span>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </tbody>
          </Table>
        )}
      </div>
    </li>
  );
}

/**
 * What the connector is configured to do, from the read-only summary it
 * shares. Nothing here changes the connector: its config lives on its host.
 */
export function ConnectorConfigSection({
  connector,
  certName,
}: {
  connector: Connector;
  certName: (id: number) => string;
}) {
  const summary = connector.configSummary;

  if (!summary) {
    return (
      <Card className="mt-6" role="region" aria-labelledby={HEADING_ID}>
        <h3 id={HEADING_ID} className="text-sm font-medium text-zinc-400 mb-4">
          Configuration
        </h3>
        <div className="flex gap-3">
          <FileCog className="w-5 h-5 text-zinc-500 shrink-0 mt-0.5" />
          <p className="text-sm text-zinc-400">
            This connector has not shared its configuration. Connectors from
            version 0.3.0 send a read-only summary of their config: the
            certificates they manage, key stores, targets and plugin versions,
            never commands or secrets. Setting{' '}
            <code className="font-mono text-xs text-zinc-200">
              krakenkey.share_config: false
            </code>{' '}
            in the connector config turns it off. See the{' '}
            <DocsLink>connector docs</DocsLink>.
          </p>
        </div>
      </Card>
    );
  }

  const deployments = new Map(
    (connector.deployments ?? []).map((d) => [
      `${d.certificateId}\n${d.label}`,
      d,
    ]),
  );
  const drift = configDrift(summary, connector.allowedCertIds);
  const hash = connector.configHash ?? summary.hash;

  return (
    <Card className="mt-6" role="region" aria-labelledby={HEADING_ID}>
      <div className="flex flex-wrap items-center justify-between gap-2 mb-1">
        <h3 id={HEADING_ID} className="text-sm font-medium text-zinc-400">
          Configuration
        </h3>
        <Badge variant="neutral" dot={false}>
          Read-only
        </Badge>
      </div>
      <p className="text-xs text-zinc-500 mb-4">
        A summary the connector shares after its passes. The config lives on the
        connector's host; change it there. Turn sharing off with{' '}
        <code className="font-mono">krakenkey.share_config: false</code> (
        <DocsLink>docs</DocsLink>).
      </p>

      <div className="grid gap-x-8 gap-y-1.5 text-sm sm:grid-cols-2">
        <Field label="Reported">
          <When iso={connector.configReportedAt ?? null} />
        </Field>
        <Field label="Hash">
          <span className="font-mono text-xs" title={hash}>
            {hash.slice(0, 12)}
          </span>
        </Field>
        <Field label="Check interval">
          {summary.checkIntervalSeconds
            ? formatInterval(summary.checkIntervalSeconds)
            : DASH}
        </Field>
        <Field label="Connector version">
          <span className="font-mono text-xs">{summary.version}</span>
        </Field>
      </div>

      {summary.truncated && (
        <p className="mt-4 text-sm text-amber-400 flex gap-2">
          <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
          The connector shortened this summary to fit the size limits, so some
          certificates or targets are not shown.
        </p>
      )}

      {(drift.notAllowed.length > 0 || drift.missing.length > 0) && (
        <div
          role="note"
          aria-label="Configuration drift"
          className="mt-4 rounded-lg border border-amber-500/20 bg-amber-500/5 p-3 text-sm text-zinc-300 space-y-2"
        >
          {drift.notAllowed.length > 0 && (
            <p className="flex gap-2">
              <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
              <span>
                In the config but outside this connector's restrictions:{' '}
                <span className="font-mono text-xs">
                  {drift.notAllowed.map(certName).join(', ')}
                </span>
                . Its keys can't use these certificates, so it can't renew them
                or report their deployments. Add them to its restrictions, or
                remove them from the config on the host.
              </span>
            </p>
          )}
          {drift.missing.length > 0 && (
            <p className="flex gap-2">
              <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
              <span>
                Allowed but not in the config:{' '}
                <span className="font-mono text-xs">
                  {drift.missing.map(certName).join(', ')}
                </span>
                . The connector doesn't manage these
                {summary.truncated ? ', or they were cut from the summary' : ''}
                . Add them to the config on the host, or remove them from its
                restrictions.
              </span>
            </p>
          )}
        </div>
      )}

      <div className="border-t border-zinc-800 mt-4 pt-4">
        <h4 className="text-sm font-medium text-zinc-400 mb-2">
          Plugins ({summary.plugins.length})
        </h4>
        {summary.plugins.length === 0 ? (
          <p className="text-sm text-zinc-500">No plugins reported.</p>
        ) : (
          <Table aria-label="Plugins">
            <TableHeader>
              <TableHead>Name</TableHead>
              <TableHead>Version</TableHead>
              <TableHead>Source</TableHead>
            </TableHeader>
            <tbody>
              {summary.plugins.map((p, i) => (
                <TableRow key={`${p.name}-${i}`}>
                  <TableCell className="font-mono text-xs text-zinc-200">
                    {p.name}
                  </TableCell>
                  <TableCell className="font-mono text-xs">
                    {p.version ?? DASH}
                  </TableCell>
                  <TableCell className="text-xs">
                    {PLUGIN_SOURCE_LABEL[p.source] ?? p.source}
                  </TableCell>
                </TableRow>
              ))}
            </tbody>
          </Table>
        )}
      </div>

      <div className="border-t border-zinc-800 mt-4 pt-4">
        <h4 className="text-sm font-medium text-zinc-400 mb-2">
          Certificates ({summary.certificates.length})
        </h4>
        {summary.certificates.length === 0 ? (
          <p className="text-sm text-zinc-500">
            The config lists no certificates.
          </p>
        ) : (
          <ul className="space-y-4">
            {summary.certificates.map((c, i) => (
              <CertificateConfig
                key={`${c.certificateId}-${i}`}
                cert={c}
                certName={certName}
                deployments={deployments}
              />
            ))}
          </ul>
        )}
      </div>
    </Card>
  );
}
