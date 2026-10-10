import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  ArrowLeft,
  Ban,
  KeyRound,
  Pencil,
  Plug,
  SlidersHorizontal,
} from 'lucide-react';
import type { Connector } from '@krakenkey/shared';
import * as connectorService from '../services/connectorService';
import { useAccessForm } from '../hooks/useAccessForm';
import {
  enrollmentTokenExpired,
  formatRelative,
  isFailedState,
} from '../utils/connectors';
import { getCertDomains } from '../utils/certDomains';
import { toast } from '../utils/toast';
import {
  ConnectorStatusBadge,
  DeploymentStateBadge,
} from '../components/connectors/ConnectorBadges';
import { EnrollmentTokenPanel } from '../components/connectors/EnrollmentTokenPanel';
import { EditLimitsModal } from '../components/connectors/EditLimitsModal';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Badge } from '../components/ui/Badge';
import { Input } from '../components/ui/Input';
import { Modal } from '../components/ui/Modal';
import { EmptyState } from '../components/ui/EmptyState';
import {
  Table,
  TableHeader,
  TableRow,
  TableHead,
  TableCell,
} from '../components/ui/Table';

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex gap-2">
      <span className="text-zinc-500 shrink-0">{label}:</span>
      <span className="text-zinc-300 min-w-0">{children}</span>
    </div>
  );
}

function When({ iso }: { iso: string | null }) {
  if (!iso) return <span className="text-zinc-500">Never</span>;
  return (
    <span title={new Date(iso).toLocaleString()}>
      {new Date(iso).toLocaleDateString()} ({formatRelative(iso)})
    </span>
  );
}

export default function ConnectorDetail() {
  const { id = '' } = useParams();
  const [connector, setConnector] = useState<Connector | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [token, setToken] = useState<{
    value: string;
    expiresAt: string;
  } | null>(null);
  const [issuing, setIssuing] = useState(false);

  const [editOpen, setEditOpen] = useState(false);
  const [editName, setEditName] = useState('');
  const [editLabel, setEditLabel] = useState('');
  const [saving, setSaving] = useState(false);

  const [limitsOpen, setLimitsOpen] = useState(false);
  const [revokeOpen, setRevokeOpen] = useState(false);
  const [revoking, setRevoking] = useState(false);

  const accessForm = useAccessForm();
  const { loadDomains, loadCerts, domainNames, certs } = accessForm;

  const load = useCallback(async () => {
    try {
      const data = await connectorService.fetchConnector(id);
      setConnector(data);
      if (data.allowedDomainIds?.length) void loadDomains();
      if (data.allowedCertIds?.length || data.deployments?.length) {
        void loadCerts();
      }
    } catch {
      setNotFound(true);
    }
  }, [id, loadDomains, loadCerts]);

  useEffect(() => {
    void load();
  }, [load]);

  const certName = (certId: number) => {
    const cert = certs?.find((c) => c.id === certId);
    const name = cert ? getCertDomains(cert)[0] : undefined;
    return name ? `#${certId} ${name}` : `#${certId}`;
  };

  const openEdit = () => {
    if (!connector) return;
    setEditName(connector.name);
    setEditLabel(connector.clientLabel ?? '');
    setEditOpen(true);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!connector) return;
    const name = editName.trim();
    if (!name) return;
    try {
      setSaving(true);
      const updated = await connectorService.updateConnector(connector.id, {
        name,
        clientLabel: editLabel.trim() || null,
      });
      setConnector((prev) =>
        prev
          ? { ...prev, name: updated.name, clientLabel: updated.clientLabel }
          : prev,
      );
      setEditOpen(false);
      toast.success('Connector updated.');
    } catch (error) {
      console.error('Failed to update connector:', error);
    } finally {
      setSaving(false);
    }
  };

  const handleNewToken = async () => {
    if (!connector) return;
    try {
      setIssuing(true);
      const { enrollmentToken, expiresAt } =
        await connectorService.newEnrollmentToken(connector.id);
      setToken({ value: enrollmentToken, expiresAt });
      setConnector((prev) =>
        prev ? { ...prev, enrollmentTokenExpiresAt: expiresAt } : prev,
      );
      toast.success(
        'New enrollment token issued. The previous one no longer works.',
      );
    } catch (error) {
      console.error('Failed to issue an enrollment token:', error);
      // Enrolled or revoked in the meantime: show the current state.
      void load();
    } finally {
      setIssuing(false);
    }
  };

  const handleRevoke = async () => {
    if (!connector) return;
    try {
      setRevoking(true);
      await connectorService.revokeConnector(connector.id);
      toast.success(`Connector "${connector.name}" revoked.`);
      setRevokeOpen(false);
      setToken(null);
      await load();
    } catch (error) {
      console.error('Failed to revoke connector:', error);
    } finally {
      setRevoking(false);
    }
  };

  const back = (
    <Link
      to="/dashboard/connectors"
      className="inline-flex items-center gap-1.5 text-sm text-zinc-400 hover:text-zinc-100 mb-6"
    >
      <ArrowLeft className="w-4 h-4" />
      All connectors
    </Link>
  );

  if (notFound) {
    return (
      <div>
        {back}
        <p className="text-sm text-zinc-400">This connector does not exist.</p>
      </div>
    );
  }
  if (!connector) {
    return <div className="text-sm text-zinc-500">Loading connector...</div>;
  }

  const revoked = connector.revokedAt !== null;
  const waiting = !revoked && !connector.enrolledAt;
  const tokenExpired = enrollmentTokenExpired(connector);
  const deployments = connector.deployments ?? [];
  const failing = deployments.filter((d) => isFailedState(d.state)).length;
  const platform = [connector.os, connector.arch].filter(Boolean).join('/');

  return (
    <div>
      <div>{back}</div>

      <div className="flex flex-wrap items-start justify-between gap-4 mb-8">
        <div className="flex items-center gap-3">
          <Plug className="w-6 h-6 text-zinc-400" />
          <div>
            <div className="flex flex-wrap items-center gap-3">
              <h1 className="text-2xl font-bold text-zinc-100">
                {connector.name}
              </h1>
              <ConnectorStatusBadge connector={connector} />
            </div>
            {connector.clientLabel && (
              <p className="text-sm text-zinc-500 mt-1">
                {connector.clientLabel}
              </p>
            )}
          </div>
        </div>
        {!revoked && (
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="secondary"
              icon={<Pencil className="w-3.5 h-3.5" />}
              onClick={openEdit}
            >
              Edit
            </Button>
            {waiting && (
              <Button
                size="sm"
                variant="secondary"
                icon={<KeyRound className="w-3.5 h-3.5" />}
                onClick={handleNewToken}
                disabled={issuing}
              >
                {issuing ? 'Issuing...' : 'New enrollment token'}
              </Button>
            )}
            <Button
              size="sm"
              variant="danger"
              icon={<Ban className="w-3.5 h-3.5" />}
              onClick={() => setRevokeOpen(true)}
            >
              Revoke
            </Button>
          </div>
        )}
      </div>

      {token && (
        <EnrollmentTokenPanel
          connectorName={connector.name}
          token={token.value}
          expiresAt={token.expiresAt}
          onDismiss={() => setToken(null)}
        />
      )}

      {waiting && !token && (
        <Card className="mb-6 border-amber-500/20 bg-amber-500/5">
          <p className="text-sm text-zinc-300">
            {tokenExpired ? (
              <>
                This connector has not enrolled, and its enrollment token
                expired
                {connector.enrollmentTokenExpiresAt &&
                  ` on ${new Date(connector.enrollmentTokenExpiresAt).toLocaleString()}`}
                . Get a new one with New enrollment token.
              </>
            ) : (
              <>
                This connector has not enrolled yet. Its token works once
                {connector.enrollmentTokenExpiresAt &&
                  ` and expires on ${new Date(connector.enrollmentTokenExpiresAt).toLocaleString()}`}
                . If you no longer have it, get a new one with New enrollment
                token.
              </>
            )}
          </p>
        </Card>
      )}

      <Card className="mb-6">
        <h3 className="text-sm font-medium text-zinc-400 mb-4">Details</h3>
        <div className="grid gap-x-8 gap-y-1.5 text-sm sm:grid-cols-2">
          <Field label="Created">
            <When iso={connector.createdAt} />
          </Field>
          <Field label="Enrolled">
            <When iso={connector.enrolledAt} />
          </Field>
          <Field label="Last seen">
            <When iso={connector.lastSeenAt} />
          </Field>
          {revoked && (
            <Field label="Revoked">
              <span className="text-red-400">
                {new Date(connector.revokedAt!).toLocaleString()}
              </span>
            </Field>
          )}
          <Field label="Version">
            {connector.version ? (
              <span className="font-mono text-xs">{connector.version}</span>
            ) : (
              <span className="text-zinc-500">&mdash;</span>
            )}
          </Field>
          <Field label="Platform">
            {platform ? (
              <span className="font-mono text-xs">{platform}</span>
            ) : (
              <span className="text-zinc-500">&mdash;</span>
            )}
          </Field>
        </div>

        <div className="border-t border-zinc-800 mt-4 pt-4 text-sm space-y-1.5">
          <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
            <h4 className="text-sm font-medium text-zinc-400">
              Access and restrictions
            </h4>
            {!revoked && (
              <Button
                size="sm"
                variant="secondary"
                icon={<SlidersHorizontal className="w-3.5 h-3.5" />}
                onClick={() => setLimitsOpen(true)}
              >
                Edit restrictions
              </Button>
            )}
          </div>
          <Field label="Scopes">
            <span className="font-mono text-xs">
              {connector.scopes.join(', ')}
            </span>
          </Field>
          <Field label="Certificates">
            {connector.allowedCertIds?.length ? (
              <span className="font-mono text-xs">
                {connector.allowedCertIds.map(certName).join(', ')}
              </span>
            ) : (
              <span className="text-zinc-500">Any within its domains</span>
            )}
          </Field>
          <Field label="Domains">
            {connector.allowedDomainIds?.length ? (
              <span className="font-mono text-xs">
                {connector.allowedDomainIds
                  .map((d) => domainNames.get(d) ?? d)
                  .join(', ')}
              </span>
            ) : (
              <span className="text-zinc-500">Any</span>
            )}
          </Field>
          <p className="text-xs text-zinc-500 pt-1">
            A domain restriction covers new certificates for that domain
            automatically. Changing the access or restrictions revokes the
            connector's current short-lived keys, so the new limits apply from
            its next check.
          </p>
        </div>
      </Card>

      <Card>
        <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
          <h3 className="text-sm font-medium text-zinc-400">
            Deployments ({deployments.length})
          </h3>
          {failing > 0 && (
            <Badge variant="danger">
              {failing} failing {failing === 1 ? 'target' : 'targets'}
            </Badge>
          )}
        </div>
        {deployments.length === 0 ? (
          <EmptyState
            icon={<Plug className="w-8 h-8" />}
            title="No deployments reported yet"
            description="After each pass the connector reports where it installed each certificate and how that went."
          />
        ) : (
          <Table aria-label="Deployments">
            <TableHeader>
              <TableHead>Certificate</TableHead>
              <TableHead>Target</TableHead>
              <TableHead>State</TableHead>
              <TableHead>Serial</TableHead>
              <TableHead>Error</TableHead>
              <TableHead>Updated</TableHead>
            </TableHeader>
            <tbody>
              {deployments.map((d) => (
                <TableRow key={`${d.certificateId}-${d.label}`}>
                  <TableCell className="font-mono text-xs text-zinc-200">
                    {certName(d.certificateId)}
                  </TableCell>
                  <TableCell className="font-mono text-xs">{d.label}</TableCell>
                  <TableCell>
                    <DeploymentStateBadge state={d.state} />
                  </TableCell>
                  <TableCell>
                    {d.serial ? (
                      <span
                        className="font-mono text-xs block max-w-[10rem] truncate"
                        title={d.serial}
                      >
                        {d.serial}
                      </span>
                    ) : (
                      <span className="text-zinc-500">&mdash;</span>
                    )}
                  </TableCell>
                  <TableCell>
                    {d.error ? (
                      <span className="text-xs text-red-400 break-words">
                        {d.error}
                      </span>
                    ) : (
                      <span className="text-zinc-500">&mdash;</span>
                    )}
                  </TableCell>
                  <TableCell>
                    <span
                      className="text-xs"
                      title={`Changed ${new Date(d.updatedAt).toLocaleString()}, last reported ${new Date(d.reportedAt).toLocaleString()}`}
                    >
                      {formatRelative(d.updatedAt)}
                    </span>
                  </TableCell>
                </TableRow>
              ))}
            </tbody>
          </Table>
        )}
      </Card>

      {/* Edit Modal */}
      <Modal
        open={editOpen}
        onClose={() => {
          if (!saving) setEditOpen(false);
        }}
        title="Edit Connector"
      >
        <form onSubmit={handleSave} className="flex flex-col gap-4">
          <Input
            id="connector-edit-name"
            label="Name"
            value={editName}
            onChange={(e) => setEditName(e.target.value)}
            disabled={saving}
            maxLength={64}
          />
          <Input
            id="connector-edit-client-label"
            label="Client label (optional)"
            placeholder="e.g., Acme Corp"
            value={editLabel}
            onChange={(e) => setEditLabel(e.target.value)}
            disabled={saving}
            maxLength={64}
            helpText="Leave empty to clear it."
          />
          <div className="flex justify-end gap-2 pt-2">
            <Button
              type="button"
              variant="ghost"
              onClick={() => setEditOpen(false)}
              disabled={saving}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              variant="primary"
              disabled={saving || !editName.trim()}
            >
              {saving ? 'Saving...' : 'Save'}
            </Button>
          </div>
        </form>
      </Modal>

      {limitsOpen && (
        <EditLimitsModal
          connector={connector}
          onClose={() => setLimitsOpen(false)}
          onSaved={() => {
            setLimitsOpen(false);
            // Reload: the deployments shown follow the new limits.
            void load();
          }}
        />
      )}

      {/* Revoke Modal */}
      <Modal
        open={revokeOpen}
        onClose={() => {
          if (!revoking) setRevokeOpen(false);
        }}
        title="Revoke Connector"
      >
        <div className="flex flex-col gap-4">
          <p className="text-sm text-zinc-400">
            Revoke{' '}
            <span className="text-zinc-200 font-medium">{connector.name}</span>?
            Every key it was issued stops working now, and the connector stops
            at its next check. It can't enroll again; to replace it, create a
            new connector.
          </p>
          <p className="text-sm text-zinc-400">
            Certificates already installed stay on its targets. Certificates it
            manages are not renewed until another connector takes them over.
          </p>
          <div className="flex justify-end gap-2 pt-2">
            <Button
              type="button"
              variant="ghost"
              onClick={() => setRevokeOpen(false)}
              disabled={revoking}
            >
              Cancel
            </Button>
            <Button
              type="button"
              variant="danger"
              icon={<Ban className="w-3.5 h-3.5" />}
              onClick={handleRevoke}
              disabled={revoking}
            >
              {revoking ? 'Revoking...' : 'Revoke Connector'}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
