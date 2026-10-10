import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
  Index,
} from 'typeorm';
import { ApiHideProperty } from '@nestjs/swagger';
import type { ApiKeyScope } from '@krakenkey/shared';
import { User } from '../../users/entities/user.entity';

@Entity()
@Index('IDX_user_api_key_userId', ['userId'])
export class UserApiKey {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  name: string;

  @ApiHideProperty()
  @Column({ unique: true })
  hash: string;

  @Column({ nullable: true })
  expiresAt?: Date;

  /** Set when the key is revoked; revoked keys never authenticate. */
  @Column({ type: 'timestamp', nullable: true })
  revokedAt?: Date | null;

  /** Updated on successful auth, at most once a minute unless the IP changes. */
  @Column({ type: 'timestamp', nullable: true })
  lastUsedAt?: Date | null;

  @Column({ type: 'text', nullable: true })
  lastUsedIp?: string | null;

  /**
   * Scopes the key may use; null = full access. Set at creation and never
   * changed, so a key can't widen itself. See ApiKeyScope in @krakenkey/shared.
   */
  @Column({ type: 'text', array: true, nullable: true })
  scopes?: ApiKeyScope[] | null;

  /** Domains the key may act on (certs, domains, endpoints); null = all. */
  @Column({ type: 'uuid', array: true, nullable: true })
  allowedDomainIds?: string[] | null;

  /** Certificates the key may act on; null = all. Blocks new issuance. */
  @Column({ type: 'int', array: true, nullable: true })
  allowedCertIds?: number[] | null;

  /** IPs/CIDRs the key may be used from; null = anywhere. */
  @Column({ type: 'text', array: true, nullable: true })
  allowedIps?: string[] | null;

  /**
   * How the key was created: null for keys made in the dashboard or by CLI
   * login, 'github-oidc' for short-lived keys from a GitHub OIDC exchange,
   * 'connector' for short-lived keys issued to a connector. Short-lived
   * keys are hidden from the key list and not counted toward the plan limit.
   */
  @Column({ type: 'text', nullable: true })
  source?: string | null;

  /**
   * The connector a short-lived key was issued to. Revoking the connector
   * revokes its keys, and only these keys may send connector reports.
   */
  @Column({ type: 'uuid', nullable: true })
  connectorId?: string | null;

  @CreateDateColumn()
  createdAt: Date;

  @ManyToOne(() => User, (user) => user.apiKeys, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'userId' })
  user: User;

  @Column({ type: 'text' }) // Authentik sub is text, not UUID
  userId: string;
}
