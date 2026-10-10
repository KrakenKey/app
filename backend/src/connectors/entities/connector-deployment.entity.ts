import {
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryColumn,
} from 'typeorm';
import type { ConnectorDeploymentState } from '@krakenkey/shared';
import { Connector } from './connector.entity';

/**
 * The latest reported state of one target a connector installs a
 * certificate on. Replaced on every report that includes the certificate.
 */
@Entity()
@Index('IDX_connector_deployment_certificateId', ['certificateId'])
export class ConnectorDeployment {
  @PrimaryColumn({ type: 'uuid' })
  connectorId: string;

  @PrimaryColumn({ type: 'int' })
  certificateId: number;

  @PrimaryColumn({ type: 'varchar', length: 64 })
  label: string;

  @ManyToOne(() => Connector, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'connectorId' })
  connector?: Connector;

  @Column({ type: 'varchar', length: 32 })
  state: ConnectorDeploymentState;

  @Column({ type: 'varchar', length: 64, nullable: true })
  serial: string | null;

  @Column({ type: 'varchar', length: 200, nullable: true })
  error: string | null;

  /** When the target last changed, as reported by the connector. */
  @Column({ type: 'timestamp' })
  updatedAt: Date;

  /** When the report carrying this row arrived. */
  @Column({ type: 'timestamp' })
  reportedAt: Date;
}
