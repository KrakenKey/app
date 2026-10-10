import { useState } from 'react';
import { Link } from 'react-router-dom';
import { ChevronDown, ChevronRight } from 'lucide-react';
import type { ConnectorDeployment } from '@krakenkey/shared';
import * as connectorService from '../../services/connectorService';
import {
  formatRelative,
  groupByConnector,
  isFailedState,
} from '../../utils/connectors';
import { DeploymentStateBadge } from './ConnectorBadges';

/**
 * "Deployed to" for a connector-managed certificate: which connectors
 * install it, on which targets, and how that went. Loaded when opened, so
 * the certificate list doesn't make a request per certificate.
 */
export function CertificateDeployments({
  certificateId,
}: {
  certificateId: number;
}) {
  const [open, setOpen] = useState(false);
  const [deployments, setDeployments] = useState<ConnectorDeployment[] | null>(
    null,
  );
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);

  const load = async () => {
    setLoading(true);
    setFailed(false);
    try {
      setDeployments(
        await connectorService.fetchCertificateDeployments(certificateId),
      );
    } catch {
      setFailed(true);
    } finally {
      setLoading(false);
    }
  };

  const toggle = () => {
    const next = !open;
    setOpen(next);
    if (next && deployments === null && !loading) void load();
  };

  const failing = deployments?.filter((d) => isFailedState(d.state)).length;
  const panelId = `cert-${certificateId}-deployments`;

  return (
    <div className="border-t border-zinc-800 pt-3 mt-3">
      <button
        type="button"
        onClick={toggle}
        aria-expanded={open}
        aria-controls={panelId}
        className="flex items-center gap-1.5 text-sm text-zinc-400 hover:text-zinc-200 transition-colors cursor-pointer bg-transparent border-none p-0"
      >
        {open ? (
          <ChevronDown className="w-4 h-4" />
        ) : (
          <ChevronRight className="w-4 h-4" />
        )}
        Deployed to
        {failing ? (
          <span className="text-xs text-red-400">({failing} failing)</span>
        ) : null}
      </button>
      {open && (
        <div id={panelId} className="mt-3">
          {loading ? (
            <p className="text-sm text-zinc-500">Loading deployments...</p>
          ) : failed ? (
            <p className="text-sm text-zinc-500">
              Could not load deployments.{' '}
              <button
                type="button"
                onClick={() => void load()}
                className="text-cyan-400 hover:text-cyan-300 cursor-pointer bg-transparent border-none p-0"
              >
                Try again
              </button>
            </p>
          ) : deployments && deployments.length > 0 ? (
            <ul className="space-y-3">
              {groupByConnector(deployments).map((group) => (
                <li key={group.connectorId} className="text-sm">
                  <Link
                    to={`/dashboard/connectors/${group.connectorId}`}
                    className="font-medium text-zinc-200 hover:text-cyan-400 transition-colors"
                  >
                    {group.connectorName}
                  </Link>
                  <ul className="mt-1.5 space-y-1">
                    {group.targets.map((t) => (
                      <li
                        key={t.label}
                        className="flex flex-wrap items-center gap-2 pl-3"
                      >
                        <span className="font-mono text-xs text-zinc-300">
                          {t.label}
                        </span>
                        <DeploymentStateBadge state={t.state} />
                        <span
                          className="text-xs text-zinc-500"
                          title={new Date(t.updatedAt).toLocaleString()}
                        >
                          {formatRelative(t.updatedAt)}
                        </span>
                        {t.error && (
                          <span className="text-xs text-red-400 break-words min-w-0">
                            {t.error}
                          </span>
                        )}
                      </li>
                    ))}
                  </ul>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-zinc-500">
              No connector has reported installing this certificate yet.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
