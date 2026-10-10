import type { Connector, ConnectorDeploymentState } from '@krakenkey/shared';
import {
  CONNECTOR_STATUS_LABEL,
  CONNECTOR_STATUS_VARIANT,
  DEPLOYMENT_STATE_LABEL,
  DEPLOYMENT_STATE_VARIANT,
  connectorStatus,
} from '../../utils/connectors';
import { Badge } from '../ui/Badge';

export function ConnectorStatusBadge({
  connector,
}: {
  connector: Pick<Connector, 'revokedAt' | 'enrolledAt' | 'lastSeenAt'>;
}) {
  const status = connectorStatus(connector);
  return (
    <Badge variant={CONNECTOR_STATUS_VARIANT[status]}>
      {CONNECTOR_STATUS_LABEL[status]}
    </Badge>
  );
}

export function DeploymentStateBadge({
  state,
}: {
  state: ConnectorDeploymentState;
}) {
  return (
    <Badge variant={DEPLOYMENT_STATE_VARIANT[state] ?? 'neutral'}>
      {DEPLOYMENT_STATE_LABEL[state] ?? state}
    </Badge>
  );
}
