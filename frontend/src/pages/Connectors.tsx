import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Plug, Plus } from 'lucide-react';
import { MAX_CONNECTORS_PER_USER } from '@krakenkey/shared';
import type { Connector, CreateConnectorResponse } from '@krakenkey/shared';
import * as connectorService from '../services/connectorService';
import { formatRelative } from '../utils/connectors';
import { plural } from '../utils/apiKeyAccess';
import { toast } from '../utils/toast';
import { ConnectorStatusBadge } from '../components/connectors/ConnectorBadges';
import { CreateConnectorModal } from '../components/connectors/CreateConnectorModal';
import { EnrollmentTokenPanel } from '../components/connectors/EnrollmentTokenPanel';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Badge } from '../components/ui/Badge';
import {
  Table,
  TableHeader,
  TableRow,
  TableHead,
  TableCell,
} from '../components/ui/Table';
import { PageHeader } from '../components/ui/PageHeader';
import { EmptyState } from '../components/ui/EmptyState';

function DeployedCell({ connector }: { connector: Connector }) {
  const summary = connector.deploymentSummary;
  if (!summary || summary.targets === 0) {
    return <span className="text-zinc-500">None yet</span>;
  }
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span title={plural(summary.targets, 'target')}>
        {plural(summary.certificates, 'certificate')}
      </span>
      {summary.failing > 0 && (
        <Badge variant="danger">{summary.failing} failing</Badge>
      )}
    </div>
  );
}

export default function Connectors() {
  const [connectors, setConnectors] = useState<Connector[]>([]);
  const [loading, setLoading] = useState(true);
  const [createOpen, setCreateOpen] = useState(false);
  const [created, setCreated] = useState<{
    name: string;
    token: string;
    issuedAt: number;
  } | null>(null);

  const fetchConnectors = useCallback(async () => {
    try {
      setLoading(true);
      setConnectors(await connectorService.fetchConnectors());
    } catch (error) {
      console.error('Failed to fetch connectors:', error);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchConnectors();
  }, [fetchConnectors]);

  const activeCount = connectors.filter((c) => !c.revokedAt).length;
  const atLimit = activeCount >= MAX_CONNECTORS_PER_USER;

  const handleCreated = ({
    connector,
    enrollmentToken,
  }: CreateConnectorResponse) => {
    setCreateOpen(false);
    setCreated({
      name: connector.name,
      token: enrollmentToken,
      issuedAt: Date.now(),
    });
    setConnectors((prev) => [
      {
        ...connector,
        deploymentSummary: { certificates: 0, targets: 0, failing: 0 },
      },
      ...prev,
    ]);
    toast.success(`Connector "${connector.name}" created!`);
  };

  const header = (
    <PageHeader
      title="Connectors"
      description="Agents on your own servers that keep private keys there, renew certificates and install them."
      icon={<Plug className="w-6 h-6" />}
      actions={
        <Button
          variant="primary"
          icon={<Plus className="w-3.5 h-3.5" />}
          onClick={() => setCreateOpen(true)}
          disabled={loading || atLimit}
        >
          New Connector
        </Button>
      }
    />
  );

  if (loading) {
    return (
      <div>
        {header}
        <p className="text-zinc-400">Loading connectors...</p>
      </div>
    );
  }

  return (
    <div>
      {header}

      {created && (
        <EnrollmentTokenPanel
          connectorName={created.name}
          token={created.token}
          issuedAt={created.issuedAt}
          onDismiss={() => setCreated(null)}
        />
      )}

      <Card>
        <h3 className="text-sm font-medium text-zinc-400 mb-4">
          Your Connectors ({activeCount} of {MAX_CONNECTORS_PER_USER})
        </h3>

        {connectors.length === 0 ? (
          <EmptyState
            icon={<Plug className="w-8 h-8" />}
            title="No connectors yet"
            description="Create one, then enroll it on a server with the token you get. It renews the certificates you give it and installs them there."
            action={
              <Button
                size="sm"
                variant="secondary"
                icon={<Plus className="w-3.5 h-3.5" />}
                onClick={() => setCreateOpen(true)}
              >
                New Connector
              </Button>
            }
          />
        ) : (
          <Table>
            <TableHeader>
              <TableHead>Name</TableHead>
              <TableHead>Client</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Version</TableHead>
              <TableHead>Last seen</TableHead>
              <TableHead>Deployed</TableHead>
            </TableHeader>
            <tbody>
              {connectors.map((connector) => (
                <TableRow
                  key={connector.id}
                  className={connector.revokedAt ? 'opacity-60' : undefined}
                >
                  <TableCell className="font-medium text-zinc-200">
                    <Link
                      to={`/dashboard/connectors/${connector.id}`}
                      className="hover:text-cyan-400 transition-colors"
                    >
                      {connector.name}
                    </Link>
                  </TableCell>
                  <TableCell>
                    {connector.clientLabel ?? (
                      <span className="text-zinc-500">&mdash;</span>
                    )}
                  </TableCell>
                  <TableCell>
                    <ConnectorStatusBadge connector={connector} />
                  </TableCell>
                  <TableCell>
                    {connector.version ? (
                      <span className="font-mono text-xs">
                        {connector.version}
                      </span>
                    ) : (
                      <span className="text-zinc-500">&mdash;</span>
                    )}
                  </TableCell>
                  <TableCell>
                    {connector.lastSeenAt ? (
                      <span
                        title={new Date(connector.lastSeenAt).toLocaleString()}
                      >
                        {formatRelative(connector.lastSeenAt)}
                      </span>
                    ) : (
                      <span className="text-zinc-500">Never</span>
                    )}
                  </TableCell>
                  <TableCell>
                    <DeployedCell connector={connector} />
                  </TableCell>
                </TableRow>
              ))}
            </tbody>
          </Table>
        )}
        {atLimit && (
          <p className="text-xs text-zinc-500 mt-3">
            You have the maximum of {MAX_CONNECTORS_PER_USER} active connectors.
            Revoke one to add another.
          </p>
        )}
        {connectors.length > activeCount && (
          <p className="text-xs text-zinc-500 mt-3">
            Revoked connectors stay listed so you can see what they deployed.
          </p>
        )}
      </Card>

      <CreateConnectorModal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreated={handleCreated}
      />
    </div>
  );
}
