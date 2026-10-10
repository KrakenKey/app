import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  ManyToOne,
  JoinColumn,
  CreateDateColumn,
  Index,
} from 'typeorm';
import { ApiHideProperty } from '@nestjs/swagger';
import { User } from '../../../users/entities/user.entity';
import type { CertManagedBy, CertStatus, ParsedCsr } from '@krakenkey/shared';

@Entity()
@Index('IDX_tls_crt_userId', ['userId'])
@Index('IDX_tls_crt_status_autoRenew_expiresAt', [
  'status',
  'autoRenew',
  'expiresAt',
])
export class TlsCrt {
  @PrimaryGeneratedColumn()
  id: number;

  @ApiHideProperty()
  @Column()
  rawCsr: string;

  @Column('jsonb')
  parsedCsr: ParsedCsr;

  @Column({ type: 'text', nullable: true })
  crtPem: string | null;

  @Column({ type: 'text', nullable: true })
  chainPem: string | null;

  @Column({ type: 'text', default: 'pending', nullable: true })
  status: CertStatus;

  @Column({ type: 'timestamp', nullable: true })
  expiresAt: Date | null;

  @Column({ type: 'timestamp', nullable: true })
  lastRenewedAt: Date | null;

  @Column({ default: true })
  autoRenew: boolean;

  @Column({ type: 'int', default: 0 })
  renewalCount: number;

  @Column({ type: 'timestamp', nullable: true })
  lastRenewalAttemptAt: Date | null;

  @Column({ type: 'int', nullable: true })
  revocationReason: number | null;

  /** Why the last issuance or renewal attempt failed; cleared on the next attempt. */
  @Column({ type: 'text', nullable: true })
  failureReason: string | null;

  @Column({ type: 'timestamp', nullable: true })
  revokedAt: Date | null;

  // --- ACME Renewal Information (RFC 9773) ----------------------------------

  /** RFC 9773 identifier of the current leaf; sent as `replaces` on renewal. */
  @Column({ type: 'text', nullable: true })
  ariCertId: string | null;

  /** The CA's suggested renewal window from the last check. */
  @Column({ type: 'timestamp', nullable: true })
  ariWindowStart: Date | null;

  @Column({ type: 'timestamp', nullable: true })
  ariWindowEnd: Date | null;

  /** Set by the CA when it explains why the window moved (e.g. an incident). */
  @Column({ type: 'text', nullable: true })
  ariExplanationUrl: string | null;

  /** When to ask the CA again (from Retry-After). */
  @Column({ type: 'timestamp', nullable: true })
  ariNextCheckAt: Date | null;

  /**
   * Set when the CA asked for early replacement; the certificate is renewed
   * outside its plan window and `renew?ifDue=true` treats it as due.
   * Cleared when a new certificate is issued.
   */
  @Column({ type: 'timestamp', nullable: true })
  ariReplacementRequestedAt: Date | null;

  /**
   * `connector` when a customer-hosted connector renews this certificate with
   * its own keys. The server then never renews it on its own; expiry alerts
   * and ARI checks still run.
   */
  @Column({ type: 'text', nullable: true })
  managedBy: CertManagedBy | null;

  @CreateDateColumn()
  createdAt: Date;

  @Column({ nullable: true })
  userId: string;

  @ManyToOne(() => User, (user) => user.tlsCrts)
  @JoinColumn({ name: 'userId' })
  user: User;
}
