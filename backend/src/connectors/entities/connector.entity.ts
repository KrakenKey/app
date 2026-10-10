import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import type { ConnectorScope } from '@krakenkey/shared';
import { User } from '../../users/entities/user.entity';

/**
 * A customer-hosted connector. Created in the dashboard with a single-use
 * enrolment token; enrolment stores the connector's Ed25519 public key,
 * which it then signs short-lived key requests with.
 */
@Entity()
@Index('IDX_connector_userId', ['userId'])
export class Connector {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'text' })
  userId: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'userId' })
  user?: User;

  @Column({ type: 'varchar', length: 64 })
  name: string;

  /** Free text naming the customer or site the connector runs for. */
  @Column({ type: 'varchar', length: 64, nullable: true })
  clientLabel: string | null;

  /** Scopes of every key issued to the connector. Never null. */
  @Column({ type: 'text', array: true })
  scopes: ConnectorScope[];

  /** Same meaning as on UserApiKey: null = no limit of this kind. */
  @Column({ type: 'int', array: true, nullable: true })
  allowedCertIds: number[] | null;

  @Column({ type: 'uuid', array: true, nullable: true })
  allowedDomainIds: string[] | null;

  /** Standard base64 of the raw 32-byte Ed25519 key; null until enrolled. */
  @Column({ type: 'text', nullable: true })
  publicKey: string | null;

  /** scrypt hash of the unused enrolment token; cleared when used. */
  @Column({ type: 'text', nullable: true, select: false })
  enrolmentTokenHash?: string | null;

  @Column({ type: 'timestamp', nullable: true })
  enrolmentTokenExpiresAt: Date | null;

  @Column({ type: 'timestamp', nullable: true })
  enrolledAt: Date | null;

  @Column({ type: 'timestamp', nullable: true })
  revokedAt: Date | null;

  /** Last enrolment, key exchange, rotation or status report. */
  @Column({ type: 'timestamp', nullable: true })
  lastSeenAt: Date | null;

  /** Set when a connector.stale alert went out; cleared when it checks in. */
  @Column({ type: 'timestamp', nullable: true })
  staleAlertedAt: Date | null;

  @Column({ type: 'varchar', length: 64, nullable: true })
  version: string | null;

  @Column({ type: 'varchar', length: 32, nullable: true })
  os: string | null;

  @Column({ type: 'varchar', length: 32, nullable: true })
  arch: string | null;

  @CreateDateColumn()
  createdAt: Date;
}
