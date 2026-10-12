import type { ConnectorDeploymentState } from '@krakenkey/shared';
import {
  CONNECTOR_HEALTH_LABEL,
  CONNECTOR_HEALTH_VARIANT,
  DEPLOYMENT_STATE_LABEL,
  DEPLOYMENT_STATE_VARIANT,
  connectorHealth,
  type ConnectorHealthFields,
} from '../../utils/connectors';
import { Badge } from '../ui/Badge';

/** The connector's health: lifecycle, check-in recency and failing targets. */
export function ConnectorStatusBadge({
  connector,
}: {
  connector: ConnectorHealthFields;
}) {
  const health = connectorHealth(connector);
  return (
    <Badge variant={CONNECTOR_HEALTH_VARIANT[health]}>
      {CONNECTOR_HEALTH_LABEL[health]}
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
