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
@Index('IDX_tls_crt_renewalQueuedAt', ['renewalQueuedAt'], {
  where: '"renewalQueuedAt" IS NOT NULL',
})
@Index('IDX_tls_crt_inFlight', ['inFlightSince'], {
  where: `"status" IN ('pending', 'issuing', 'renewing') AND "renewalQueuedAt" IS NULL`,
})
export class TlsCrt {
  @PrimaryGeneratedColumn()
  id: number;

  /** Null while the certificate is awaiting_csr. */
  @ApiHideProperty()
  @Column({ type: 'varchar', nullable: true })
  rawCsr: string | null;

  /** Null while the certificate is awaiting_csr. */
  @Column('jsonb', { nullable: true })
  parsedCsr: ParsedCsr | null;

  /**
   * The CSR the current certificate was issued with, kept while a renewal
   * with a new CSR (a new key) is in flight. If that renewal fails and the
   * current certificate is kept, rawCsr/parsedCsr go back to these, so the
   * stored CSR always matches the certificate's key. Cleared when the
   * renewal finishes. Never returned by the API.
   */
  @ApiHideProperty()
  @Column({ type: 'varchar', nullable: true })
  previousRawCsr: string | null;

  @ApiHideProperty()
  @Column('jsonb', { nullable: true })
  previousParsedCsr: ParsedCsr | null;

  /**
   * The names a certificate was requested with when created without a CSR
   * (lowercased, deduplicated); a connector's CSR must have exactly these.
   * Null for certificates requested with a CSR.
   */
  @Column('text', { array: true, nullable: true })
  requestedNames: string[] | null;

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

  /**
   * Set while a renewal waits for a free slot under the plan's concurrent
   * pending limit (status 'renewing', nothing sent to the CA yet). Cleared
   * when the renewal starts. See TlsService.startQueuedRenewals.
   */
  @Column({ type: 'timestamp', nullable: true })
  renewalQueuedAt: Date | null;

  /**
   * When the current issuance or renewal was handed to the worker (status
   * pending, issuing, or renewing without renewalQueuedAt); null otherwise.
   * Jobs carry it as a fencing token, and RenewalQueueService recovers
   * requests that stay in flight with no live job (see recoverStuck).
   */
  @Column({ type: 'timestamp', nullable: true })
  inFlightSince: Date | null;

  /**
   * How many times the current request was recovered after losing its job
   * (see TlsService.recoverStuck). Reset when a certificate is issued or a
   * failed one is retried.
   */
  @Column({ type: 'int', default: 0 })
  recoveryCount: number;

  @Column({ type: 'int', nullable: true })
  revocationReason: number | null;

  /**
   * Why the last issuance or renewal attempt failed; cleared when the
   * certificate is issued, retried or renewed again.
   */
  @Column({ type: 'text', nullable: true })
  failureReason: string | null;

  /**
   * When the last renewal failed while the current certificate was still
   * valid. The certificate then stays 'issued' with its PEM, chain and
   * expiry (failureReason says why), and automatic renewal waits until
   * renewalRetryAt before trying again. Cleared when a renewal is
   * requested again.
   */
  @Column({ type: 'timestamp', nullable: true })
  renewalFailedAt: Date | null;

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
